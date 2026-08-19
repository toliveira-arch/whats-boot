import { prisma, runAsSystem, runWithTenant } from '@whats-boot/database';
import { logger } from '../../lib/logger';
import * as messaging from '../evolution/messaging.service';
import { recordEvent } from '../events/events.service';
import { parseSteps, type FollowUpStep } from './followup.service';

const HOUR_MS = 3_600_000;

function renderTemplate(tpl: string, ctx: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => ctx[k] ?? '');
}

/** Passos ativos, com texto, ordenados pelo tempo (asc). */
function activeSteps(raw: unknown): FollowUpStep[] {
  return parseSteps(raw)
    .filter((s) => s.active && s.text.trim() && s.afterHours >= 0)
    .sort((a, b) => a.afterHours - b.afterHours);
}

let timer: NodeJS.Timeout | null = null;
let running = false;

/**
 * Verifica as conversas "silenciosas" de cada empresa com sequência ativa e
 * dispara o próximo passo do follow-up quando o tempo sem resposta é atingido.
 * O tempo é medido a partir da última mensagem do cliente (ou da criação, se
 * ele nunca respondeu); uma nova resposta reinicia a sequência.
 */
export async function tickFollowUps(now = new Date()): Promise<void> {
  const seqs = await runAsSystem(() =>
    prisma.followUpSequence.findMany({ where: { enabled: true, deletedAt: null } }),
  );

  for (const seq of seqs) {
    const steps = activeSteps(seq.steps);
    if (!steps.length) continue;
    const minHours = steps[0]!.afterHours;
    const threshold = new Date(now.getTime() - minHours * HOUR_MS);

    await runWithTenant(seq.tenantId, async () => {
      // Números internos (chips da própria empresa) — nunca receber follow-up.
      const insts = await prisma.evolutionInstance.findMany({
        where: { companyId: seq.companyId, deletedAt: null },
        select: { phoneNumber: true },
      });
      const internal = new Set(
        insts.map((i) => (i.phoneNumber ?? '').replace(/\D/g, '')).filter(Boolean),
      );

      const convs = await prisma.conversation.findMany({
        where: {
          companyId: seq.companyId,
          deletedAt: null,
          isArchived: false,
          // SÓ leads de campanha (RD/CRM) — nunca contatos orgânicos de outros canais.
          origin: 'CRM',
          // Respeita o desligamento do robô: por conversa e pelo toggle do canal.
          aiEnabled: { not: false },
          evolutionInstance: { aiEnabled: true },
          status: { in: ['OPEN', 'PENDING'] },
          OR: [
            { lastInboundAt: { lte: threshold } },
            { AND: [{ lastInboundAt: null }, { createdAt: { lte: threshold } }] },
          ],
        },
        orderBy: { lastMessageAt: 'asc' },
        take: 300,
        select: {
          id: true,
          evolutionInstanceId: true,
          lastInboundAt: true,
          createdAt: true,
          contact: { select: { name: true, pushName: true, waJid: true, phoneNumber: true } },
        },
      });

      for (const c of convs) {
        const number = c.contact.waJid ?? c.contact.phoneNumber ?? '';
        const digits = number.replace(/\D/g, '');
        if (!digits || internal.has(digits)) continue;

        const base = c.lastInboundAt ?? c.createdAt;
        const sentCount = await prisma.conversationEvent.count({
          where: { conversationId: c.id, type: 'FOLLOWUP_SENT', createdAt: { gt: base } },
        });
        if (sentCount >= steps.length) continue;

        const step = steps[sentCount]!;
        const hoursSince = (now.getTime() - base.getTime()) / HOUR_MS;
        if (hoursSince < step.afterHours) continue;

        const text = renderTemplate(step.text, {
          nome: c.contact.name ?? c.contact.pushName ?? '',
        });
        try {
          await messaging.sendText({
            tenantId: seq.tenantId,
            channelId: c.evolutionInstanceId,
            number,
            text,
            authorType: 'AI',
          });
          await recordEvent({
            tenantId: seq.tenantId,
            conversationId: c.id,
            type: 'FOLLOWUP_SENT',
            data: { step: sentCount + 1 },
          });
        } catch (err) {
          logger.error({ err, conversationId: c.id }, 'follow-up: falha ao enviar');
        }
      }
    });
  }
}

/** Inicia o agendador de follow-up (checa a cada 5 min). Idempotente. */
export function startFollowUpScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    if (running) return; // evita sobreposição
    running = true;
    void tickFollowUps()
      .catch((err) => logger.error({ err }, 'follow-up: falha no tick'))
      .finally(() => {
        running = false;
      });
  }, 300_000);
  logger.info('⏰ agendador de follow-up iniciado (checagem a cada 5 min)');
}

export function stopFollowUpScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
