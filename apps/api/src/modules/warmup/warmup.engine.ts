import { prisma, runAsSystem, runWithTenant } from '@whats-boot/database';
import { logger } from '../../lib/logger';
import { decryptSecret } from '../../lib/crypto';
import * as messaging from '../evolution/messaging.service';
import { getProvider, type LlmMessage } from '../ai/providers';

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

export interface WarmupWindow {
  days: number[]; // 0=Dom .. 6=Sáb
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

export interface WarmupConfig {
  windows: WarmupWindow[];
  minIntervalSec: number;
  maxIntervalSec: number;
  imagePct: number;
  deletePct: number;
  reactPct: number;
  rampUpDays: number;
  baseDailyMessages: number;
  maxDailyMessages: number;
  useAi: boolean;
  personaA?: string;
  personaB?: string;
  phrases?: string[];
}

export function defaultWarmupConfig(): WarmupConfig {
  return {
    windows: [
      { days: [1, 2, 3, 4, 5], start: '11:00', end: '11:15' },
      { days: [1, 2, 3, 4, 5], start: '16:00', end: '16:10' },
    ],
    minIntervalSec: 40,
    maxIntervalSec: 120,
    imagePct: 15,
    deletePct: 5,
    reactPct: 10,
    rampUpDays: 14,
    baseDailyMessages: 8,
    maxDailyMessages: 40,
    useAi: true,
    personaA: 'Amigável, curioso, fala de forma casual e breve.',
    personaB: 'Descontraído, bem-humorado, responde curto como no WhatsApp.',
    phrases: [
      'Oi, tudo bem?',
      'E aí, como foi o dia?',
      'Vc viu aquilo que te falei?',
      'kkk boa',
      'Bora marcar algo esse fds?',
      'Tô acabando aqui o trampo',
      'Depois te ligo',
      'Manda a foto lá',
      'Que isso, top demais',
      'Bora sim',
    ],
  };
}

export function parseConfig(raw: unknown): WarmupConfig {
  const d = defaultWarmupConfig();
  if (!raw || typeof raw !== 'object') return d;
  const c = raw as Partial<WarmupConfig>;
  return {
    windows: Array.isArray(c.windows) && c.windows.length ? c.windows : d.windows,
    minIntervalSec: c.minIntervalSec ?? d.minIntervalSec,
    maxIntervalSec: c.maxIntervalSec ?? d.maxIntervalSec,
    imagePct: c.imagePct ?? d.imagePct,
    deletePct: c.deletePct ?? d.deletePct,
    reactPct: c.reactPct ?? d.reactPct,
    rampUpDays: c.rampUpDays ?? d.rampUpDays,
    baseDailyMessages: c.baseDailyMessages ?? d.baseDailyMessages,
    maxDailyMessages: c.maxDailyMessages ?? d.maxDailyMessages,
    useAi: c.useAi ?? d.useAi,
    personaA: c.personaA ?? d.personaA,
    personaB: c.personaB ?? d.personaB,
    phrases: Array.isArray(c.phrases) && c.phrases.length ? c.phrases : d.phrases,
  };
}

// ---------------------------------------------------------------------------
// Janelas / limites
// ---------------------------------------------------------------------------

function hhmmNow(now: Date): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

export function isWindowActive(config: WarmupConfig, now: Date): boolean {
  const day = now.getDay();
  const hhmm = hhmmNow(now);
  return config.windows.some((w) => w.days.includes(day) && hhmm >= w.start && hhmm <= w.end);
}

function todayStr(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Teto de mensagens do dia considerando o ramp-up gradual. */
function dailyCap(config: WarmupConfig, ageDays: number): number {
  const ramp = config.rampUpDays > 0 ? Math.min(1, ageDays / config.rampUpDays) : 1;
  return Math.round(
    config.baseDailyMessages + (config.maxDailyMessages - config.baseDailyMessages) * ramp,
  );
}

const REACTIONS = ['👍', '😂', '❤️', '🔥', '👏', '😮', '🙏'];
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)] as T;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Geração da mensagem (IA com reserva de frases prontas)
// ---------------------------------------------------------------------------

async function generateMessage(
  tenantId: string,
  config: WarmupConfig,
  persona: string,
  history: { fromMe: boolean; content: string }[],
): Promise<string> {
  if (config.useAi) {
    try {
      const credential = await prisma.aiCredential.findFirst({
        where: { isActive: true, deletedAt: null },
      });
      const provider = credential ? getProvider(credential.provider) : null;
      if (credential && provider) {
        const messages: LlmMessage[] = [
          {
            role: 'system',
            content: [
              'Você está simulando uma pessoa comum conversando por WhatsApp com um amigo (aquecimento de número).',
              `Seu estilo: ${persona}`,
              'Regras: escreva UMA mensagem curta (até ~12 palavras), natural, informal, em pt-BR, como no WhatsApp. Pode usar gírias e no máximo 1 emoji. Não repita mensagens anteriores. Responda só a mensagem, sem aspas.',
            ].join(' '),
          },
          ...history.map((h): LlmMessage => ({
            role: h.fromMe ? 'assistant' : 'user',
            content: h.content,
          })),
        ];
        if (!history.length) {
          messages.push({ role: 'user', content: 'Comece um papo casual.' });
        }
        const out = await provider.chat(
          {
            model: credential.provider === 'GOOGLE' ? 'gemini-1.5-flash' : 'gpt-4o-mini',
            temperature: 1,
            maxTokens: 60,
            messages,
          },
          decryptSecret(credential.apiKeyEncrypted),
          credential.baseUrl ?? undefined,
        );
        const text = out.content.trim().replace(/^["']|["']$/g, '');
        if (text) return text.slice(0, 200);
      }
    } catch (err) {
      logger.warn({ err, tenantId }, 'aquecimento: IA falhou, usando frases prontas');
    }
  }
  return pick(config.phrases ?? defaultWarmupConfig().phrases!);
}

// ---------------------------------------------------------------------------
// Um "beat": uma mensagem de um chip para o outro
// ---------------------------------------------------------------------------

type Chan = {
  id: string;
  companyId: string;
  tenantId: string;
  phoneNumber: string | null;
  status: string;
};

async function loadChan(id: string): Promise<Chan | null> {
  return prisma.evolutionInstance.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, companyId: true, tenantId: true, phoneNumber: true, status: true },
  });
}

/** Histórico recente entre os dois canais (para dar continuidade ao papo). */
async function recentHistory(
  channelIds: string[],
  senderId: string,
): Promise<{ fromMe: boolean; content: string }[]> {
  const msgs = await prisma.message.findMany({
    where: { evolutionInstanceId: { in: channelIds }, deletedAt: null, content: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: 6,
    select: { content: true, evolutionInstanceId: true },
  });
  return msgs
    .reverse()
    .map((m) => ({ fromMe: m.evolutionInstanceId === senderId, content: m.content ?? '' }));
}

async function maybeDeleteOrReact(config: WarmupConfig, channelIds: string[]): Promise<void> {
  // Best-effort: usa uma mensagem já espelhada (com waMessageId) do webhook.
  if (Math.random() * 100 < config.reactPct) {
    const inbound = await prisma.message.findFirst({
      where: {
        evolutionInstanceId: { in: channelIds },
        direction: 'INBOUND',
        waMessageId: { not: null },
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      include: { conversation: { select: { waRemoteJid: true } } },
    });
    if (inbound?.waMessageId && inbound.evolutionInstanceId && inbound.conversation?.waRemoteJid) {
      await messaging.sendReaction(
        inbound.evolutionInstanceId,
        { id: inbound.waMessageId, remoteJid: inbound.conversation.waRemoteJid, fromMe: false },
        pick(REACTIONS),
      );
    }
  }
  if (Math.random() * 100 < config.deletePct) {
    const outbound = await prisma.message.findFirst({
      where: {
        evolutionInstanceId: { in: channelIds },
        direction: 'OUTBOUND',
        waMessageId: { not: null },
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      include: { conversation: { select: { waRemoteJid: true } } },
    });
    if (
      outbound?.waMessageId &&
      outbound.evolutionInstanceId &&
      outbound.conversation?.waRemoteJid
    ) {
      await messaging.deleteForEveryone(outbound.evolutionInstanceId, {
        id: outbound.waMessageId,
        remoteJid: outbound.conversation.waRemoteJid,
        fromMe: true,
      });
    }
  }
}

interface SessionRow {
  id: string;
  tenantId: string;
  channelAId: string;
  channelBId: string;
  beatsToday: number;
  beatsDate: string | null;
}

/** Executa uma troca de mensagem. Retorna true se enviou. */
export async function runBeat(session: SessionRow, config: WarmupConfig): Promise<boolean> {
  const [a, b] = await Promise.all([loadChan(session.channelAId), loadChan(session.channelBId)]);
  if (!a || !b) {
    logger.warn({ sessionId: session.id }, 'aquecimento: canal inexistente');
    return false;
  }
  if (a.status !== 'CONNECTED' || b.status !== 'CONNECTED') {
    logger.warn({ sessionId: session.id }, 'aquecimento: canais precisam estar conectados');
    return false;
  }
  const aPhone = a.phoneNumber;
  const bPhone = b.phoneNumber;
  if (!aPhone || !bPhone) {
    logger.warn({ sessionId: session.id }, 'aquecimento: canal sem número (conecte primeiro)');
    return false;
  }

  // Alterna o remetente a cada mensagem.
  const senderIsA = session.beatsToday % 2 === 0;
  const sender = senderIsA ? a : b;
  const receiverNumber = senderIsA ? bPhone : aPhone;
  const persona = (senderIsA ? config.personaA : config.personaB) ?? '';

  const history = await recentHistory([a.id, b.id], sender.id);
  const text = await generateMessage(session.tenantId, config, persona, history);

  // "digitando…" antes de mandar (tempo proporcional ao tamanho).
  const typingMs = Math.min(6000, 800 + text.length * 90);
  await messaging.sendPresence(sender.id, receiverNumber, 'composing', typingMs);
  await sleep(typingMs);

  // Às vezes manda imagem da galeria (com o texto de legenda).
  const gallery =
    Math.random() * 100 < config.imagePct
      ? await prisma.warmupAsset.findMany({
          where: { deletedAt: null, OR: [{ companyId: sender.companyId }, { companyId: null }] },
          take: 30,
          select: { mimeType: true, dataBase64: true },
        })
      : [];

  if (gallery.length) {
    const asset = pick(gallery);
    await messaging.sendMedia({
      tenantId: session.tenantId,
      channelId: sender.id,
      number: receiverNumber,
      mediatype: 'image',
      media: asset.dataBase64,
      mimetype: asset.mimeType,
      caption: Math.random() < 0.6 ? text : undefined,
      authorType: 'AI',
    });
  } else {
    await messaging.sendText({
      tenantId: session.tenantId,
      channelId: sender.id,
      number: receiverNumber,
      text,
      authorType: 'AI',
    });
  }

  await maybeDeleteOrReact(config, [a.id, b.id]);
  return true;
}

// ---------------------------------------------------------------------------
// Agendador (ticker em processo — sem Redis)
// ---------------------------------------------------------------------------

let timer: NodeJS.Timeout | null = null;

/** Executa uma passada: para cada sessão RUNNING, envia um beat se estiver na hora. */
export async function tickWarmup(now = new Date()): Promise<void> {
  const sessions = await runAsSystem(() =>
    prisma.warmupSession.findMany({
      where: { status: 'RUNNING', deletedAt: null },
      select: {
        id: true,
        tenantId: true,
        channelAId: true,
        channelBId: true,
        config: true,
        lastBeatAt: true,
        beatsToday: true,
        beatsDate: true,
        createdAt: true,
      },
    }),
  );

  for (const s of sessions) {
    const config = parseConfig(s.config);
    if (!isWindowActive(config, now)) continue;

    const today = todayStr(now);
    const beatsToday = s.beatsDate === today ? s.beatsToday : 0;
    const ageDays = Math.floor((now.getTime() - s.createdAt.getTime()) / 86_400_000);
    if (beatsToday >= dailyCap(config, ageDays)) continue;

    // Espaçamento humano: só envia se passou o intervalo (com jitter).
    const elapsed = s.lastBeatAt ? (now.getTime() - s.lastBeatAt.getTime()) / 1000 : Infinity;
    if (elapsed < config.minIntervalSec) continue;
    if (elapsed < config.maxIntervalSec && Math.random() < 0.5) continue;

    await runWithTenant(s.tenantId, async () => {
      try {
        const sent = await runBeat(
          {
            id: s.id,
            tenantId: s.tenantId,
            channelAId: s.channelAId,
            channelBId: s.channelBId,
            beatsToday,
            beatsDate: today,
          },
          config,
        );
        if (sent) {
          await prisma.warmupSession.update({
            where: { id: s.id },
            data: { lastBeatAt: new Date(), beatsToday: beatsToday + 1, beatsDate: today },
          });
        }
      } catch (err) {
        logger.error({ err, sessionId: s.id }, 'aquecimento: falha no beat');
      }
    });
  }
}

/** Inicia o ticker (checa a cada minuto). Idempotente. */
export function startWarmupScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    void tickWarmup().catch((err) => logger.error({ err }, 'aquecimento: falha no tick'));
  }, 60_000);
  logger.info('🔥 agendador de aquecimento iniciado (checagem a cada 60s)');
}

export function stopWarmupScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
