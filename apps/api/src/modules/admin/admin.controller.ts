import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { getEnsureIndexesResult } from '../../db/ensure-indexes';
import { cleanupOrganic } from '../conversations/conversations.service';

/** POST /api/admin/cleanup/organic — remove (soft-delete) conversas não-CRM. */
export async function cleanupOrganicController(_req: Request, res: Response): Promise<void> {
  res.json(await cleanupOrganic());
}

/** Compara dois segredos em tempo constante (evita timing attack). */
function secretMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * GET /api/admin/health/patch-a — verificação do Patch A sem tocar no Neon/logs.
 *
 * Escopo (isolamento multi-tenant):
 *  - indiceExiste / ensureIndexesBoot: GLOBAIS (nível de schema / info de boot,
 *    sem dados de tenant).
 *  - ativasSemNormalized / gruposDuplicados: escopados ao tenant do admin (o
 *    guard multi-tenant injeta tenantId em count/groupBy) — não vaza dados de
 *    outras contas.
 *  - global.*: bloco CROSS-TENANT (SQL cru, sem filtro de tenant) para validar o
 *    backfill/colapso que rodaram globais no boot. Só é retornado quando o
 *    chamador envia X-Admin-Secret batendo com ADMIN_HEALTH_SECRET — admin de
 *    tenant comum não recebe (não vaza PII cross-tenant).
 */
export async function patchAHealthController(req: Request, res: Response): Promise<void> {
  // (1) O índice único parcial existe? (pg_indexes — nível de schema, global.)
  const idx = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'Conversation'
      AND indexname = 'conversation_active_phone_uq'
  `;
  const indiceExiste = idx.length > 0;

  // (2) Leads de CRM ativos ainda sem normalizedPhone (tenant-scoped). Filtra
  //     origin='CRM' porque só o dispatch escreve normalizedPhone — conversas
  //     orgânicas (INBOUND) não entram na trava e não devem contar aqui.
  const ativasSemNormalized = await prisma.conversation.count({
    where: {
      origin: 'CRM',
      deletedAt: null,
      status: { not: 'CLOSED' },
      normalizedPhone: null,
    },
  });

  // (3) Grupos com >1 conversa ativa no mesmo (companyId, normalizedPhone) —
  //     prova que o colapso não colou números diferentes (tenant-scoped).
  const grupos = await prisma.conversation.groupBy({
    by: ['companyId', 'normalizedPhone'],
    where: {
      origin: 'CRM',
      deletedAt: null,
      status: { not: 'CLOSED' },
      normalizedPhone: { not: null },
    },
    _count: { companyId: true },
    having: { companyId: { _count: { gt: 1 } } },
  });
  const gruposDuplicados = grupos.map((g) => ({
    companyId: g.companyId,
    normalizedPhone: g.normalizedPhone,
    ativas: g._count.companyId,
  }));

  // Bloco GLOBAL (cross-tenant) — gated por secret. Necessário porque backfill e
  // colapso rodaram globais no boot: tenant-scoped pode dar falso "zero".
  const secretConfigured = Boolean(env.ADMIN_HEALTH_SECRET);
  const authorizedGlobal =
    secretConfigured &&
    secretMatches(req.header('x-admin-secret') ?? undefined, env.ADMIN_HEALTH_SECRET as string);

  let global: Record<string, unknown>;
  if (authorizedGlobal) {
    // SQL cru = ignora o guard de tenant → visão global de todo o deploy.
    const semNorm = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n
      FROM "Conversation"
      WHERE "deletedAt" IS NULL AND status <> 'CLOSED'
        AND "origin" = 'CRM' AND "normalizedPhone" IS NULL
    `;
    const n = semNorm[0]?.n ?? 0;
    const gruposGlobal = await prisma.$queryRaw<
      Array<{ companyId: string; normalizedPhone: string; ativas: number }>
    >`
      SELECT "companyId", "normalizedPhone", count(*)::int AS ativas
      FROM "Conversation"
      WHERE "deletedAt" IS NULL AND status <> 'CLOSED'
        AND "origin" = 'CRM' AND "normalizedPhone" IS NOT NULL
      GROUP BY "companyId", "normalizedPhone"
      HAVING count(*) > 1
    `;
    global = {
      enabled: true,
      ativasSemNormalizedGlobal: n,
      gruposDuplicadosGlobal: gruposGlobal,
    };
  } else {
    global = {
      enabled: false,
      reason: secretConfigured
        ? 'X-Admin-Secret ausente ou incorreto'
        : 'ADMIN_HEALTH_SECRET não configurado no ambiente',
    };
  }

  res.json({
    indiceExiste,
    indiceDef: idx[0]?.indexdef ?? null,
    ativasSemNormalized,
    gruposDuplicados,
    ensureIndexesBoot: getEnsureIndexesResult(),
    global,
    escopo: {
      indiceExiste: 'global',
      ativasSemNormalized: 'tenant',
      gruposDuplicados: 'tenant',
      ensureIndexesBoot: 'global',
      global: 'cross-tenant (gated por X-Admin-Secret)',
      tenantId: req.auth?.tenantId ?? null,
    },
  });
}
