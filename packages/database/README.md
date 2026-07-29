# @whats-boot/database

Schema Prisma + migrations + client compartilhado (PostgreSQL, multi-tenant).

## Modelo de dados (47 tabelas)

| Grupo                                          | Tabelas                                                                                                                    |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Tenancy / Billing**                          | `Tenant`, `Plan`, `Subscription`                                                                                           |
| **Identidade / Auth**                          | `User`, `RefreshToken`, `VerificationToken`, `Invitation`                                                                  |
| **RBAC**                                       | `Role`, `Permission`, `RolePermission`, `Membership`, `AgentProfile`, `MembershipCompany`                                  |
| **Empresas / Times / Config**                  | `Company`, `CompanySettings`, `TenantSettings`, `Setting`, `BusinessHour`, `Team`, `TeamMember`                            |
| **Canais WhatsApp**                            | `EvolutionInstance`                                                                                                        |
| **Contatos / Tags**                            | `Contact`, `Tag`, `ContactTag`, `ConversationTag`                                                                          |
| **Conversas / Mensagens**                      | `Conversation`, `Message`, `MessageStatusEvent`, `ConversationEvent`                                                       |
| **Notas / Follow-up / Agenda**                 | `Note`, `FollowUp`, `Appointment`, `ScheduledMessage`                                                                      |
| **IA / Prompts / RAG**                         | `AiAgent`, `Prompt`, `PromptVersion`, `AiCredential`, `AiUsageLog`, `KnowledgeBase`, `KnowledgeDocument`, `KnowledgeChunk` |
| **Arquivos / Uploads**                         | `File`, `Upload`                                                                                                           |
| **Logs / Auditoria / Webhooks / Notificações** | `AuditLog`, `SystemLog`, `WebhookEvent`, `Notification`                                                                    |

## Convenções

- **Multi-tenant:** toda tabela de domínio carrega `tenantId` (isolamento + RLS).
  `Tenant` = conta/agência (raiz); `Company` = empresa cliente sob o tenant.
- **Soft delete:** coluna `deletedAt` (filtro aplicado por Prisma Client Extension).
- **Timestamps:** `createdAt` + `updatedAt` em toda entidade.
- **Cascade:** filhos caem com o pai; referências de auditoria usam `SetNull`.
- **Prompts versionados:** `Prompt.currentVersionId` → `PromptVersion` (histórico completo).
- **RAG:** `KnowledgeChunk.embedding` usa `vector(1536)` (pgvector).

## Comandos

```bash
# 1. Configure a conexão
echo 'DATABASE_URL="postgresql://user:pass@host:5432/whatsboot?schema=public"' > .env

# 2. Gere o client
npm run generate

# 3. Crie a 1ª migration (cria as tabelas)
npm run migrate:dev -- --name init

# 4. Aplique RLS + índice vetorial (complemento não expressável no schema.prisma)
#    veja: prisma/sql/0001_rls_and_vector.sql
psql "$DATABASE_URL" -f prisma/sql/0001_rls_and_vector.sql
```

> Requer as extensões Postgres: `pgcrypto`, `pg_trgm`, `citext`, `vector`
> (declaradas no `datasource` e criadas pela migration).
