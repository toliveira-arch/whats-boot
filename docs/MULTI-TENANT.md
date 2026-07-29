# ETAPA 5 — Multi-Tenant (isolamento completo)

Isolamento por `tenantId` aplicado automaticamente a **todas as consultas**, de
forma que nenhum cliente acessa dados de outro.

## Como funciona

```
Request autenticado
  → authenticate      (valida JWT, preenche req.auth com tenantId)
  → tenantContext     (runWithTenant(tenantId) — AsyncLocalStorage)
      → controllers / services
          → prisma.*  (Prisma Client Extension injeta tenantId em TODA query)
```

### 1. Contexto de tenant (`AsyncLocalStorage`)

`packages/database/tenant-context.js` mantém o `tenantId` do request/job atual.
Ele atravessa `await`s sem precisar passar o tenant manualmente.

- `runWithTenant(tenantId, fn)` — escopo de um tenant.
- `runAsSystem(fn)` — sem isolamento (auth global, registro, workers, webhooks).
- Sem contexto → comporta-se como sistema (boot/CLI).

### 2. Prisma Client Extension (o guard)

O `prisma` exportado por `@whats-boot/database` já vem estendido. Para os ~40
modelos que possuem `tenantId` (`TENANT_MODELS`), a extensão:

- **Leituras / update / delete:** injeta `where.tenantId = <contexto>`
  (Prisma 5+ aceita `tenantId` no `where` de `findUnique`/`update`/`delete`
  junto do campo único).
- **Escritas** (`create`/`createMany`/`upsert`): **força** `data.tenantId =
<contexto>` — impede gravar em outro tenant, mesmo que o payload tente.

Como o filtro é aplicado no ORM, é impossível um service "esquecer" o `tenantId`.
Modelos globais (`User`, `Plan`, `Permission`, …) não são filtrados.

### 3. Autenticação

- O access token carrega `tid` (tenantId). O `authenticate` popula `req.auth`.
- Fluxos globais (login por e-mail, registro, refresh, reset) rodam em
  `runAsSystem` — não pertencem a um tenant.
- Rotas protegidas (`/auth/me`, …) rodam sob `tenantContext`.

### 4. WebSocket

- Handshake exige JWT válido (senão a conexão é recusada).
- Cada socket entra nas rooms `tenant:{id}` e `user:{id}` → só recebe eventos
  do seu tenant. Use `emitToTenant(io, tenantId, event, payload)`.
- Handlers que tocam o banco usam `withSocketTenant(socket, fn)`.

### 5. Defesa em profundidade (RLS)

Além do guard na aplicação, o Postgres tem **Row-Level Security** por tenant
(`packages/database/prisma/sql/0001_rls_and_vector.sql`). Mesmo com um bug na
aplicação, o banco recusa acesso cross-tenant quando o `app.current_tenant`
estiver setado por transação.

## Regras para os próximos módulos

1. Toda rota autenticada usa `authenticate` **+** `tenantContext`.
2. Services só usam o `prisma` compartilhado (nunca instanciam outro client).
3. Operações realmente globais/entre-tenants usam `runAsSystem` explicitamente.
4. Emissões em tempo real sempre via `emitToTenant` (ou rooms `tenant:{id}`).

## Verificação (runtime, sem banco)

O núcleo do isolamento foi testado: propagação do contexto por `await`,
injeção de `tenantId` em leitura/escrita/upsert, **override** do tenant em
escrita (anti-spoofing) e o conjunto de modelos isolados vs. globais.
