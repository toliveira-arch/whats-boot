'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

/**
 * Isolamento multi-tenant no nível do ORM.
 *
 * Um `AsyncLocalStorage` carrega o `tenantId` do request/job atual. A extensão
 * do Prisma injeta automaticamente o filtro `tenantId` em TODA operação sobre
 * tabelas de domínio (leitura, escrita, update, delete). Assim é impossível
 * "esquecer" o filtro e vazar dados entre clientes.
 *
 * Contextos:
 *  - runWithTenant(tenantId, fn): escopo de um tenant (requests autenticados).
 *  - runAsSystem(fn): sem isolamento (auth global, registro, workers, webhooks
 *    que ainda vão resolver o tenant). Use com consciência.
 *  - Sem contexto definido: comporta-se como sistema (boot/CLI). Todo handler de
 *    request autenticado DEVE passar pelo middleware de contexto de tenant.
 */
const als = new AsyncLocalStorage();

/** Modelos que possuem a coluna `tenantId` (isolados por tenant). */
const TENANT_MODELS = new Set([
  'Subscription',
  'Invitation',
  'Role',
  'Membership',
  'MembershipCompany',
  'Company',
  'CompanySettings',
  'TenantSettings',
  'Setting',
  'BusinessHour',
  'Team',
  'TeamMember',
  'EvolutionInstance',
  'Contact',
  'Tag',
  'ContactTag',
  'ConversationTag',
  'Conversation',
  'Message',
  'MessageStatusEvent',
  'ConversationEvent',
  'Note',
  'FollowUp',
  'Appointment',
  'ScheduledMessage',
  'AiAgent',
  'Prompt',
  'PromptVersion',
  'AiCredential',
  'AiUsageLog',
  'KnowledgeBase',
  'KnowledgeDocument',
  'KnowledgeChunk',
  'File',
  'Upload',
  'AuditLog',
  'SystemLog',
  'WebhookEvent',
  'Notification',
]);

function runWithTenant(tenantId, fn) {
  return als.run({ tenantId }, fn);
}

function runAsSystem(fn) {
  return als.run({ system: true }, fn);
}

function getTenantContext() {
  return als.getStore();
}

/**
 * Injeta `tenantId` nos argumentos de uma operação Prisma (função pura).
 * Escritas forçam o tenantId do contexto (impede escrever em outro tenant);
 * leituras/updates/deletes filtram por tenantId (Prisma 5+ aceita campo
 * não-único no `where` de findUnique/update/delete junto de um campo único).
 */
function applyTenantToArgs(operation, args, tenantId) {
  const a = args ? { ...args } : {};

  switch (operation) {
    case 'findUnique':
    case 'findUniqueOrThrow':
    case 'findFirst':
    case 'findFirstOrThrow':
    case 'findMany':
    case 'count':
    case 'aggregate':
    case 'groupBy':
    case 'update':
    case 'updateMany':
    case 'updateManyAndReturn':
    case 'delete':
    case 'deleteMany':
      a.where = { ...(a.where || {}), tenantId };
      break;
    case 'create':
      a.data = { ...(a.data || {}), tenantId };
      break;
    case 'createMany':
    case 'createManyAndReturn':
      a.data = Array.isArray(a.data)
        ? a.data.map((d) => ({ ...d, tenantId }))
        : { ...(a.data || {}), tenantId };
      break;
    case 'upsert':
      a.where = { ...(a.where || {}), tenantId };
      a.create = { ...(a.create || {}), tenantId };
      break;
    default:
      break;
  }

  return a;
}

/** Aplica o guard de tenant a um PrismaClient, retornando o client estendido. */
function applyTenantGuard(prisma) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_MODELS.has(model)) {
            return query(args);
          }

          const store = als.getStore();
          // Sem contexto ou contexto de sistema → sem isolamento.
          if (!store || store.system || !store.tenantId) {
            return query(args);
          }

          return query(applyTenantToArgs(operation, args, store.tenantId));
        },
      },
    },
  });
}

module.exports = {
  als,
  TENANT_MODELS,
  runWithTenant,
  runAsSystem,
  getTenantContext,
  applyTenantToArgs,
  applyTenantGuard,
};
