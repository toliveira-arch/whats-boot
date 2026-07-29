-- =============================================================================
-- Complemento da 1ª migration — o que NÃO é expressável no schema.prisma:
--   (1) Row-Level Security (RLS) por tenant  (defense-in-depth)
--   (2) Índice vetorial pgvector para o RAG
--
-- Como usar: rode `prisma migrate dev` para criar as tabelas e, em seguida,
-- inclua este SQL no diretório da migration gerada (ou aplique como migration
-- própria). A aplicação seta o tenant corrente por transação com:
--   SELECT set_config('app.current_tenant', '<tenantId>', true);
-- =============================================================================

-- ------------------------------------------------------------------------------
-- (1) RLS por tenant
-- Padrão aplicado a TODA tabela de domínio que possui a coluna "tenantId".
-- Abaixo o template; repita o bloco para cada tabela tenant-scoped.
-- O papel da aplicação NÃO deve ter BYPASSRLS. Migrations rodam com role
-- separada (owner) que ignora RLS para DDL.
-- ------------------------------------------------------------------------------

-- Exemplo para a tabela "Conversation" (repetir para as demais):
ALTER TABLE "Conversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Conversation" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "Conversation"
  USING ("tenantId" = current_setting('app.current_tenant', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant', true));

-- Tabelas tenant-scoped às quais o MESMO bloco acima deve ser aplicado
-- (troque o nome da tabela em ENABLE/FORCE/CREATE POLICY):
--   Company, CompanySettings, TenantSettings, Setting, BusinessHour,
--   Membership, MembershipCompany, Role, Invitation, Team, TeamMember,
--   EvolutionInstance, Contact, Tag, ContactTag, ConversationTag,
--   Conversation, Message, MessageStatusEvent, ConversationEvent, Note,
--   FollowUp, Appointment, ScheduledMessage, AiAgent, Prompt, PromptVersion,
--   AiCredential, AiUsageLog, KnowledgeBase, KnowledgeDocument, KnowledgeChunk,
--   File, Upload, Notification, Subscription
--
-- Tabelas com "tenantId" OPCIONAL (podem ter registros globais) — usar policy
-- que também permite linhas de tenant nulo quando fizer sentido:
--   AuditLog, SystemLog, WebhookEvent
--   Ex.: USING ("tenantId" IS NULL
--               OR "tenantId" = current_setting('app.current_tenant', true))
--
-- Tabelas GLOBAIS (sem tenantId) — SEM RLS de tenant:
--   User, RefreshToken, VerificationToken, Plan, Permission, RolePermission

-- ------------------------------------------------------------------------------
-- (2) Índice vetorial (pgvector) para KnowledgeChunk.embedding
-- Use HNSW (melhor recall/latência) ou IVFFlat. Ajuste a métrica conforme o
-- modelo de embedding (cosine é o mais comum).
-- ------------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS knowledge_chunk_embedding_hnsw
  ON "KnowledgeChunk"
  USING hnsw ("embedding" vector_cosine_ops);

-- Índice auxiliar por tenant para acelerar o filtro antes do ANN:
CREATE INDEX IF NOT EXISTS knowledge_chunk_tenant_idx
  ON "KnowledgeChunk" ("tenantId");
