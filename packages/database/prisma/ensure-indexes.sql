-- ============================================================================
-- ensure-indexes.sql — invariantes de banco que o Prisma NÃO expressa no schema
-- (índice ÚNICO PARCIAL com cláusula WHERE). Executado de forma idempotente no
-- boot da API por apps/api/src/db/ensure-indexes.ts (após `prisma db push`).
--
-- Objetivo (Bloco 1 — dedupe por ESTADO, sem guard por tempo):
--   garantir que exista NO MÁXIMO uma Conversation NÃO-TERMINAL por
--   (companyId, normalizedPhone). A 1ª mensagem do lead passa a ser idempotente
--   por estado (a criação da conversa vence ou colide na constraint), em vez de
--   depender de "janela de X horas".
--
-- Definição de estado NÃO-TERMINAL:
--   deletedAt IS NULL
--   AND status <> 'CLOSED'
--   AND (leadVerdict IS NULL OR leadVerdict = 'IN_PROGRESS')
-- Estados TERMINAIS (QUALIFIED / DISQUALIFIED / CLOSED / deletado) ficam FORA da
-- trava — o lead pode legitimamente reabrir depois.
--
-- Escopo: apenas linhas com normalizedPhone IS NOT NULL. Conversas orgânicas
-- antigas têm normalizedPhone NULL e NÃO entram na constraint.
--
-- ORDEM no boot (ensure-indexes.ts): BACKFILL (TS) → PASSO 1 (colapso) →
-- PASSO 2 (índice). O BACKFILL preenche normalizedPhone das conversas
-- não-terminais legadas usando a MESMA normalizeBrPhone (não reimplementa em
-- SQL), ANTES do colapso — assim o colapso já agrupa por número real e as
-- conversas legadas passam a ser protegidas pelo índice.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PASSO 0 (diagnóstico, não executado — referência para revisão manual):
-- lista os grupos que teriam mais de uma conversa ativa para o mesmo número.
--
--   SELECT "companyId", "normalizedPhone", COUNT(*) AS ativos
--   FROM "Conversation"
--   WHERE "deletedAt" IS NULL
--     AND "status" <> 'CLOSED'
--     AND ("leadVerdict" IS NULL OR "leadVerdict" = 'IN_PROGRESS')
--     AND "normalizedPhone" IS NOT NULL
--   GROUP BY "companyId", "normalizedPhone"
--   HAVING COUNT(*) > 1
--   ORDER BY ativos DESC;
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- PASSO 1 — COLAPSO de duplicatas legadas (idempotente).
-- Sem isto, o CREATE UNIQUE INDEX abaixo falharia se já houvesse duplicatas, e o
-- boot nasceria SEM a proteção.
--
-- Estratégia de merge: por grupo (companyId, normalizedPhone), MANTÉM a conversa
-- MAIS ANTIGA (menor createdAt) — que carrega o histórico original — e FECHA as
-- demais (status = 'CLOSED', closedAt = now). Nenhuma mensagem é apagada: o
-- histórico das conversas fechadas permanece anexado a elas.
-- ----------------------------------------------------------------------------
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "companyId", "normalizedPhone"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS rn
  FROM "Conversation"
  WHERE "deletedAt" IS NULL
    AND "status" <> 'CLOSED'
    AND ("leadVerdict" IS NULL OR "leadVerdict" = 'IN_PROGRESS')
    AND "normalizedPhone" IS NOT NULL
)
UPDATE "Conversation" AS c
SET
  "status"    = 'CLOSED',
  "closedAt"  = NOW(),
  "updatedAt" = NOW()
FROM ranked AS r
WHERE c."id" = r."id"
  AND r.rn > 1;

-- ----------------------------------------------------------------------------
-- PASSO 2 — ÍNDICE ÚNICO PARCIAL (a trava por estado). IF NOT EXISTS = idempotente.
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_active_phone_uq"
  ON "Conversation" ("companyId", "normalizedPhone")
  WHERE "deletedAt" IS NULL
    AND "status" <> 'CLOSED'
    AND ("leadVerdict" IS NULL OR "leadVerdict" = 'IN_PROGRESS')
    AND "normalizedPhone" IS NOT NULL;
