import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { normalizeBrPhone } from '../modules/integrations/dispatch';

/** Resultado do último ensureIndexes do boot — exposto pela rota de verificação. */
export interface EnsureIndexesResult {
  ranAt: string;
  backfill: { scanned: number; updated: number } | { error: string } | null;
  statements: Array<{ statement: string; affected?: number; error?: string }>;
  sqlReadError?: string;
}

let lastResult: EnsureIndexesResult | null = null;

/** Último resultado do ensureIndexes (null se ainda não rodou). */
export function getEnsureIndexesResult(): EnsureIndexesResult | null {
  return lastResult;
}

/**
 * BACKFILL — preenche Conversation.normalizedPhone das conversas NÃO-TERMINAIS
 * legadas (coluna nova, hoje NULL em prod), derivando do Contact via a MESMA
 * normalizeBrPhone (nunca reimplementar em SQL). Idempotente e não-destrutivo:
 * só grava onde está NULL. Sem isto, a conversa legada ficaria fora do índice
 * parcial (que exige normalizedPhone IS NOT NULL) e o bug de duplicidade
 * sobreviveria para as conversas já em andamento no deploy.
 *
 * Roda ANTES do colapso e do índice: assim o colapso passa a agrupar por número
 * REAL (e não arrisca fechar conversas de números diferentes).
 *
 * No boot não há contexto de tenant (ALS vazio) → o guard multi-tenant é no-op
 * e o findMany varre TODAS as empresas, igual ao runner do índice.
 */
async function backfillNormalizedPhone(): Promise<{ scanned: number; updated: number }> {
  const pending = await prisma.conversation.findMany({
    where: {
      normalizedPhone: null,
      deletedAt: null,
      status: { not: 'CLOSED' },
      OR: [{ leadVerdict: null }, { leadVerdict: 'IN_PROGRESS' }],
    },
    select: {
      id: true,
      contact: { select: { waJid: true, phoneNumber: true } },
    },
  });

  let updated = 0;
  for (const c of pending) {
    // waJid ("55...@s.whatsapp.net") é a identidade real de entrega; phoneNumber é fallback.
    const raw = c.contact?.waJid?.split('@')[0] ?? c.contact?.phoneNumber ?? null;
    const normalized = normalizeBrPhone(raw);
    if (!normalized) continue;
    await prisma.conversation.update({
      where: { id: c.id },
      data: { normalizedPhone: normalized },
    });
    updated += 1;
  }
  logger.info(
    { scanned: pending.length, updated },
    'ensureIndexes: backfill de normalizedPhone concluído',
  );
  return { scanned: pending.length, updated };
}

/**
 * Aplica invariantes de banco que o Prisma NÃO expressa no schema (índice ÚNICO
 * PARCIAL com WHERE) — ver packages/database/prisma/ensure-indexes.sql.
 *
 * Rodado no boot, DEPOIS do `prisma db push` (que cria a coluna normalizedPhone).
 * Ordem: BACKFILL (TS) → COLAPSO + ÍNDICE (SQL). Tudo idempotente.
 * Nunca derruba o boot — em erro, loga e segue (o app continua funcional; só a
 * proteção de unicidade fica pendente e o próximo boot tenta de novo).
 */
export async function ensureIndexes(): Promise<void> {
  const result: EnsureIndexesResult = {
    ranAt: new Date().toISOString(),
    backfill: null,
    statements: [],
  };

  // PASSO 0 — backfill das conversas legadas (antes do colapso e do índice).
  try {
    result.backfill = await backfillNormalizedPhone();
  } catch (err) {
    result.backfill = { error: err instanceof Error ? err.message : String(err) };
    logger.error({ err }, 'ensureIndexes: falha no backfill de normalizedPhone — seguindo');
  }

  let sql: string;
  try {
    // Resolve o .sql dentro do pacote @whats-boot/database (workspace/symlink),
    // sem depender de o arquivo ser copiado para o dist da API.
    const dbEntry = require.resolve('@whats-boot/database');
    const sqlPath = join(dirname(dbEntry), 'prisma', 'ensure-indexes.sql');
    sql = readFileSync(sqlPath, 'utf8');
  } catch (err) {
    result.sqlReadError = err instanceof Error ? err.message : String(err);
    lastResult = result;
    logger.error({ err }, 'ensureIndexes: não foi possível ler ensure-indexes.sql — pulando');
    return;
  }

  // Divide em statements: remove comentários de linha (--) e quebra no ';' final.
  // Resultado esperado: PASSO 1 (colapso) e PASSO 2 (índice único parcial).
  const statements = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const statement of statements) {
    const head = statement.slice(0, 60).replace(/\s+/g, ' ');
    try {
      const affected = await prisma.$executeRawUnsafe(statement);
      result.statements.push({ statement: head, affected });
      logger.info({ affected, statement: head }, 'ensureIndexes: statement aplicado');
    } catch (err) {
      result.statements.push({
        statement: head,
        error: err instanceof Error ? err.message : String(err),
      });
      logger.error({ err, statement: head }, 'ensureIndexes: falha ao aplicar statement');
    }
  }

  lastResult = result;
}
