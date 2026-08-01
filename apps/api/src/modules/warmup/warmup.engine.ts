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
  /** Canais já aquecidos: têm prioridade para iniciar a conversa (puxam os novos). */
  veteranIds?: string[];
  /** Fuso usado para avaliar as janelas de horário (padrão America/Sao_Paulo). */
  timezone?: string;
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
    timezone: 'America/Sao_Paulo',
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
    veteranIds: Array.isArray(c.veteranIds) ? c.veteranIds : [],
    timezone: typeof c.timezone === 'string' && c.timezone ? c.timezone : d.timezone,
  };
}

// ---------------------------------------------------------------------------
// Janelas / limites
// ---------------------------------------------------------------------------

const WEEKDAY: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Data/hora locais no fuso configurado (fallback: hora do servidor). */
function localParts(
  tz: string | undefined,
  now: Date,
): { day: number; hhmm: string; date: string } {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'America/Sao_Paulo',
      hour12: false,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    let hour = get('hour');
    if (hour === '24') hour = '00'; // alguns ambientes retornam 24h
    return {
      day: WEEKDAY[get('weekday')] ?? now.getDay(),
      hhmm: `${hour.padStart(2, '0')}:${get('minute').padStart(2, '0')}`,
      date: `${get('year')}-${get('month')}-${get('day')}`,
    };
  } catch {
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    return { day: now.getDay(), hhmm, date: now.toISOString().slice(0, 10) };
  }
}

export function isWindowActive(config: WarmupConfig, now: Date): boolean {
  const { day, hhmm } = localParts(config.timezone, now);
  return config.windows.some((w) => w.days.includes(day) && hhmm >= w.start && hhmm <= w.end);
}

function todayStr(now: Date, tz?: string): string {
  return localParts(tz, now).date;
}

/** Data local (yyyy-mm-dd) no fuso configurado — usada no contador diário. */
export function currentDateInTz(tz?: string): string {
  return localParts(tz, new Date()).date;
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
  channelIds: string[];
  beatsToday: number;
  beatsDate: string | null;
}

/** Resolve o pool de canais: usa channelIds; cai para o par legado A/B. */
export function resolvePool(session: {
  channelIds: string[];
  channelAId: string | null;
  channelBId: string | null;
}): string[] {
  if (session.channelIds.length) return session.channelIds;
  return [session.channelAId, session.channelBId].filter((x): x is string => Boolean(x));
}

// Anti-repetição: último par sorteado por sessão (em memória, best-effort).
const lastPairKey = new Map<string, string>();
const pairKey = (a: string, b: string) => [a, b].sort().join('|');

/** Sorteia um par (remetente, destinatário) do pool, com viés para veteranos. */
function choosePair(
  connected: Chan[],
  veteranIds: string[],
  lastKey: string | undefined,
): [Chan, Chan] {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const vets = connected.filter((c) => veteranIds.includes(c.id));
    // Veterano puxa a conversa em ~60% das vezes (quando houver veterano).
    const sender = vets.length && Math.random() < 0.6 ? pick(vets) : pick(connected);
    const others = connected.filter((c) => c.id !== sender.id);
    const receiver = pick(others);
    // Evita repetir o último par quando o pool tem 3+ (dá pra variar).
    if (connected.length > 2 && pairKey(sender.id, receiver.id) === lastKey) continue;
    return [sender, receiver];
  }
  return [connected[0] as Chan, connected[1] as Chan];
}

/** Executa uma troca de mensagem entre um par sorteado do pool. Retorna true se enviou. */
export async function runBeat(session: SessionRow, config: WarmupConfig): Promise<boolean> {
  if (session.channelIds.length < 2) {
    logger.warn({ sessionId: session.id }, 'aquecimento: pool precisa de 2+ canais');
    return false;
  }
  const loaded = (await Promise.all(session.channelIds.map(loadChan))).filter((c): c is Chan =>
    Boolean(c),
  );
  const connected = loaded.filter((c) => c.status === 'CONNECTED' && c.phoneNumber);
  if (connected.length < 2) {
    logger.warn({ sessionId: session.id }, 'aquecimento: 2+ canais precisam estar conectados');
    return false;
  }

  const [sender, receiver] = choosePair(
    connected,
    config.veteranIds ?? [],
    lastPairKey.get(session.id),
  );
  lastPairKey.set(session.id, pairKey(sender.id, receiver.id));
  const receiverNumber = receiver.phoneNumber as string;
  // Veterano usa o estilo A; novato usa o estilo B (só para variar o tom).
  const persona =
    ((config.veteranIds ?? []).includes(sender.id) ? config.personaA : config.personaB) ?? '';

  const history = await recentHistory(session.channelIds, sender.id);
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

  await maybeDeleteOrReact(config, session.channelIds);
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
        channelIds: true,
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

    const today = todayStr(now, config.timezone);
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
            channelIds: resolvePool(s),
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
