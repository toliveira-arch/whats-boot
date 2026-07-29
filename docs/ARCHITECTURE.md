# whats-boot — Arquitetura do SaaS de Atendimento WhatsApp com IA

> **Status:** documento de arquitetura (produção). Nenhum código de aplicação
> ainda. Este documento é a fonte da verdade para as próximas sprints.
>
> **Contexto:** a Sprint 1 validou o fluxo com n8n + Supabase como andaime.
> Para o produto real, a orquestração migra para um **backend próprio**
> (NestJS + BullMQ). O n8n deixa de estar no caminho crítico das mensagens.

---

## 0. Decisões de stack (resumo executivo)

> **Decisões confirmadas pelo time (2026-07):** (1) backend próprio em **NestJS**,
> tirando o n8n do caminho crítico; (2) **PostgreSQL gerenciado** acessado via
> Prisma (RLS + pgvector); (3) **IA multi-provider** (Claude + OpenAI),
> selecionável por tenant.


| Camada | Escolha | Por quê |
|---|---|---|
| Backend | **NestJS (TypeScript)** | Módulos + DI + Guards/Interceptors, WebSocket Gateway nativo, integração BullMQ, testável, escala em times |
| Frontend | **Next.js 15 (App Router) + React 19** | Já iniciado; SSR/streaming, ecossistema maduro |
| ORM | **Prisma** | Migrations versionadas, type-safety, Client Extensions para multi-tenant |
| Banco | **PostgreSQL 16** (+ pgvector) | Relacional forte, RLS, particionamento, embeddings para RAG |
| Fila | **BullMQ** (sobre Redis) | Retries/backoff, rate-limit por número, ordering por conversa |
| Cache/PubSub | **Redis 7** | Cache, sessões, adapter Socket.IO, locks, presença, rate-limit |
| Realtime | **Socket.IO** (+ Redis adapter) | Rooms por org/conversa, escala horizontal |
| Storage | **S3-compatível** (Cloudflare R2 / AWS S3 / MinIO) | Mídia do WhatsApp, presigned URLs |
| IA | **Multi-provider (Claude + OpenAI)**, configurável por tenant | Agente + triagem + RAG + tools, sem lock-in de fornecedor |
| Gateway WhatsApp | **Evolution API** (self-hosted) | Multi-instância, webhooks, envio de mídia |
| Monorepo | **pnpm workspaces + Turborepo** | Código compartilhado tipado entre api/web/worker |

Princípios: **multi-tenant desde o primeiro dia**, **idempotência** em toda
ingestão, **defense-in-depth** (guard na aplicação + RLS no banco), **filas para
tudo que fala com o mundo externo** (Evolution, IA, storage).

---

## 1. Arquitetura completa (visão de componentes)

Blocos e responsabilidades:

- **Web (Next.js)** — painel de atendimento (inbox), configurações, canais, IA,
  equipe, billing. Consome REST + WebSocket. Não fala com Evolution/Redis direto.
- **API (NestJS, modo HTTP)** — REST + WebSocket Gateway + recepção de webhooks
  do Evolution. Autentica, autoriza, valida, persiste, **enfileira** trabalho.
- **Worker (NestJS, modo worker)** — mesmo código-base, processa as filas BullMQ
  (IA, envio, download de mídia, embeddings). Deploy separado e escala sozinho.
- **PostgreSQL** — estado transacional multi-tenant. Prisma + RLS.
- **Redis** — cache, sessões/refresh allowlist, backing do BullMQ, adapter do
  Socket.IO, locks distribuídos, presença, rate-limit.
- **Object Storage (S3)** — mídia (inbound e outbound), documentos de RAG.
- **Evolution API** — uma ou mais instâncias; cada número de WhatsApp de um
  tenant é uma "instance" do Evolution. Emite webhooks; recebe comandos de envio.
- **Provider de IA (Claude / OpenAI)** — chamado apenas pelos workers, atrás de
  uma abstração; o provider/modelo é escolhido por tenant.

Fluxo de dados de alto nível:

```
WhatsApp ⇄ Evolution API ⇄ (webhook) API ⇄ Redis/BullMQ ⇄ Worker ⇄ (IA/Storage)
                                  │                                     │
                                  ├── PostgreSQL (Prisma + RLS) ────────┘
                                  │
                                  └── Socket.IO ⇄ Web (painel do atendente)
```

---

## 2. Estrutura de pastas (monorepo)

```
whats-boot/
├── apps/
│   ├── api/                      # NestJS — HTTP + WebSocket + webhooks
│   │   └── src/
│   │       ├── main.ts           # bootstrap (modo HTTP)
│   │       ├── worker.ts         # bootstrap (modo worker / BullMQ)
│   │       ├── app.module.ts
│   │       ├── common/           # guards, interceptors, filters, decorators, pipes
│   │       ├── config/           # ConfigModule + validação de env (zod)
│   │       └── modules/
│   │           ├── auth/         # login, refresh, register, guards
│   │           ├── organizations/# tenants
│   │           ├── memberships/  # usuário ↔ org + role
│   │           ├── users/
│   │           ├── channels/     # instâncias Evolution (conexão WhatsApp)
│   │           ├── contacts/     # clientes finais
│   │           ├── conversations/
│   │           ├── messages/
│   │           ├── realtime/     # Socket.IO gateway
│   │           ├── webhooks/     # POST /webhooks/evolution/:channelId
│   │           ├── ai/           # orquestração do agente
│   │           ├── knowledge/    # RAG (ingestão + retrieval)
│   │           ├── media/        # upload/download S3, presigned URLs
│   │           ├── queues/       # definição de filas + processors
│   │           ├── billing/      # planos, uso, limites
│   │           └── audit/        # logs de auditoria
│   └── web/                      # Next.js (App Router)
│       └── src/
│           ├── app/
│           │   ├── (auth)/       # login, register, forgot-password
│           │   └── (app)/        # área protegida
│           │       ├── inbox/    # lista + conversa [conversationId]
│           │       ├── contacts/
│           │       ├── channels/ # conectar WhatsApp (QR)
│           │       └── settings/ # org, equipe, IA, billing
│           ├── components/
│           ├── hooks/
│           ├── lib/              # apiClient, socketClient, auth, react-query
│           └── stores/           # zustand (estado de UI/realtime)
├── packages/
│   ├── database/                 # Prisma: schema, migrations, client gerado
│   ├── shared/                   # tipos, DTOs, zod schemas, enums, contratos
│   ├── evolution/                # SDK tipado do Evolution API
│   ├── ai/                       # abstração de LLM (provider Claude)
│   ├── config/                   # schema de env compartilhado
│   └── ui/                       # componentes React compartilhados (opcional)
├── infra/
│   ├── docker/                   # Dockerfiles (api, worker, web)
│   ├── compose/                  # docker-compose.{dev,prod}.yml
│   └── evolution/                # config das instâncias Evolution
├── docs/                         # ARCHITECTURE.md, SETUP.md, ...
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

> **Migração da Sprint 1:** o `web/` atual vira `apps/web/`; o `supabase/` e o
> `n8n/` vão para `infra/legacy-sprint1/` (referência). O `docker-compose.yml`
> da raiz é substituído pelos de `infra/compose/`.

---

## 3. Organização do Backend (NestJS)

**Camadas por módulo:** `Controller` (HTTP) / `Gateway` (WS) → `Service` (regra de
negócio) → `Repository` (acesso a dados via Prisma) → `Processor` (BullMQ).

**Cadeia de request (ordem dos Guards):**
`JwtAuthGuard` → `OrgContextGuard` (resolve e valida `organizationId` da
membership) → `RolesGuard`/`PermissionsGuard` (RBAC) → `Controller`.

**Cross-cutting (common/):**
- `HttpExceptionFilter` — formato de erro padronizado (RFC 7807-like).
- `LoggingInterceptor` + `pino` — request-id, org-id, latência.
- `ZodValidationPipe` / `class-validator` — validação de entrada.
- `IdempotencyInterceptor` — chave de idempotência para webhooks e envios.
- `@CurrentUser()`, `@CurrentOrg()`, `@Roles()` — decorators.

**Dois modos de execução (mesmo código):**
- `main.ts` → sobe o servidor HTTP + WebSocket (recebe webhooks, serve o painel).
- `worker.ts` → registra os `Processors` do BullMQ, sem abrir porta HTTP.
- Deploy independente: os workers escalam conforme a carga de IA/envio.

**Módulos de domínio principais:** `auth`, `organizations`, `memberships`,
`channels`, `contacts`, `conversations`, `messages`, `realtime`, `webhooks`,
`ai`, `knowledge`, `media`, `queues`, `billing`, `audit`.

---

## 4. Organização do Frontend (Next.js)

- **Roteamento:** App Router com grupos `(auth)` (público) e `(app)` (protegido
  por middleware que valida o cookie de sessão e injeta o contexto da org).
- **Estado do servidor:** **TanStack Query** (cache, revalidação, mutations).
- **Estado de UI/realtime:** **Zustand** (conversa aberta, digitação, presença,
  fila de mensagens otimista).
- **Realtime:** cliente **Socket.IO** único, autenticado com o access token;
  entra nas rooms `org:{id}` e `conversation:{id}`.
- **Camada de dados:** `lib/apiClient` (fetch com refresh automático de token)
  e `lib/socketClient`. Nenhuma credencial de Evolution/Redis/DB no browser.
- **Inbox (tela principal):** lista de conversas (filtros: fila, status,
  atribuição) + thread da conversa + composer (texto/mídia/áudio) + painel
  lateral do contato. Atualização ao vivo via WebSocket.
- **Multi-org no cliente:** seletor de organização; troca reemite o contexto e
  refaz as queries; o token carrega apenas o usuário, a org é validada no back.

---

## 5. Estratégia Multi-Tenant

**Modelo escolhido: banco único, schema único, isolamento por `organizationId`**
(shared-database / shared-schema) — melhor custo/operação para SaaS B2B com
muitos tenants pequenos/médios, com **defense-in-depth**:

1. **Coluna `organizationId`** obrigatória em toda tabela de domínio, com FK e
   índice composto (`organizationId` sempre como primeira coluna dos índices).
2. **Prisma Client Extension** (`$extends`) que injeta automaticamente o filtro
   `organizationId` em toda query e o preenche em toda escrita, a partir de um
   **AsyncLocalStorage** com o contexto do request. Impossível "esquecer" o filtro.
3. **PostgreSQL Row-Level Security (RLS)** como rede de segurança: policies que
   comparam `organizationId` com `current_setting('app.current_org')`, setado por
   transação. Mesmo com bug na aplicação, o banco recusa cross-tenant.
4. **Contexto de tenant** resolvido no `OrgContextGuard` a partir da membership
   do usuário + org selecionada (header `X-Org-Id` ou subdomínio `org.app.com`).

**Isolamento operacional adicional:**
- Rooms de WebSocket sempre prefixadas por `org:{id}`.
- Chaves de Redis e prefixos de storage sempre com `orgId`.
- Filas com `jobId`/dados carregando `organizationId`; workers reaplicam o
  contexto (ALS) antes de tocar no banco.
- Quotas e rate-limits por organização (plano de billing).

> Evolução futura: tenants enterprise podem migrar para schema dedicado sem
> mudar o código de domínio (só a resolução de conexão), porque o acesso já é
> centralizado no repositório.

---

## 6. Estratégia WebSocket (Socket.IO)

- **Servidor:** `RealtimeGateway` (NestJS) com **Redis adapter** para escalar
  horizontalmente (mensagem emitida em qualquer instância chega a todos os nós).
- **Autenticação no handshake:** access token JWT validado em `handleConnection`;
  conexão recusada se inválido/expirado.
- **Rooms:**
  - `org:{organizationId}` — eventos amplos da organização.
  - `conversation:{conversationId}` — thread específica (só quem tem acesso).
  - `user:{userId}` — notificações direcionadas.
- **Eventos server→client:** `message.created`, `message.status` (sent/delivered/
  read), `conversation.updated` (status/atribuição), `conversation.assigned`,
  `typing`, `presence`, `channel.qrcode`, `channel.status`, `ai.suggestion`.
- **Eventos client→server:** `conversation.subscribe/unsubscribe`, `typing.start/
  stop`, `presence.ping`.
- **Presença:** heartbeat gravado em Redis com TTL; supervisor vê agentes online.
- **Autorização por evento:** ao entrar numa `conversation:{id}`, o gateway
  revalida se o usuário pode ver aquela conversa (mesma policy do REST).
- **Entrega garantida:** o WebSocket é "best-effort" para UX; a verdade está no
  banco. Ao (re)abrir a conversa, o cliente busca via REST e sincroniza.

---

## 7. Estratégia Redis

Um Redis (com réplicas / ou Cluster em produção) para múltiplos papéis, com
**prefixos de chave** e, idealmente, **DBs/namespaces** separados por função:

| Uso | Padrão de chave | Observação |
|---|---|---|
| Cache de leitura | `cache:{org}:{entity}:{id}` | TTL curto; invalidação em escrita |
| Sessão / refresh allowlist | `session:{userId}:{jti}` | Revogação de refresh tokens |
| BullMQ | (gerenciado pela lib) | Instância/DB dedicada recomendada |
| Socket.IO adapter | (gerenciado) | Pub/Sub entre nós |
| Presença | `presence:{org}:{userId}` | TTL + heartbeat |
| Rate-limit | `ratelimit:{scope}:{key}` | Token bucket (API e envio WhatsApp) |
| Locks distribuídos | `lock:conversation:{id}` | Ordenação/atribuição sem corrida |
| Idempotência | `idemp:{hash}` | Dedupe de webhooks e comandos |

- **Locks (Redlock)** para: garantir ordem por conversa, evitar dupla atribuição,
  serializar provisionamento de instância Evolution.
- **Isolamento:** DB dedicada para BullMQ (evita `FLUSHDB` acidental afetar cache)
  e para o adapter do Socket.IO.

---

## 8. Estratégia BullMQ

**Filas (todas com `organizationId` no payload e idempotência):**

| Fila | Produtor | Consumidor faz | Política |
|---|---|---|---|
| `inbound.messages` | Webhook controller | Normaliza, persiste, decide rota (IA vs humano) | FIFO por conversa (lock) |
| `ai.process` | inbound worker | RAG + chamada ao Claude + tools + resposta | retry 3x, backoff exp., timeout |
| `outbound.messages` | api/worker | Envia via Evolution (texto/mídia) | **rate-limit por número** |
| `media.download` | inbound worker | Baixa mídia do WhatsApp → S3 | retry, dedupe por waMessageId |
| `knowledge.embed` | knowledge module | Chunk + embeddings → pgvector | batch, backoff |
| `webhook.status` | Evolution webhook | Atualiza status sent/delivered/read | idempotente |
| `billing.usage` | ai/outbound workers | Contabiliza tokens/mensagens | agregação |

**Regras transversais:**
- **Idempotência:** `jobId = waMessageId` (ou hash) evita processar 2x o mesmo
  webhook (Evolution pode reenviar).
- **Ordenação por conversa:** processa uma mensagem por conversa por vez usando
  lock em `lock:conversation:{id}` (ou BullMQ *groups*), preservando a ordem.
- **Rate-limit anti-ban:** `outbound.messages` limitada por número de WhatsApp
  (ex.: N msgs/segundo) via limiter do BullMQ — proteção contra bloqueio da Meta.
- **Retries + backoff exponencial**; após esgotar, vai para **DLQ** (fila de
  falhas) + alerta.
- **Observabilidade:** Bull Board (protegido) para inspeção; métricas por fila.
- **Escala:** workers stateless, concorrência configurável por fila; deploy
  separado do processo HTTP.

---

## 9. Estratégia Prisma

- **Pacote `packages/database`** dono do `schema.prisma`, migrations e client
  gerado; api, worker e scripts importam o mesmo client.
- **Migrations versionadas** (`prisma migrate`) — nunca `db push` em produção.
- **Multi-tenant no ORM:** Client Extension que (a) filtra por `organizationId`
  em `findMany/findFirst/update/delete` e (b) preenche em `create`, lendo o
  contexto do **AsyncLocalStorage**. Combinado com RLS no Postgres.
- **Pooling:** **PgBouncer** (transaction mode) na frente; Prisma com
  `connection_limit` compatível. Em serverless, usar Prisma Data Proxy/Accelerate
  ou driver adapter — mas aqui o back é long-running (Nest), então PgBouncer basta.
- **Soft delete** onde faz sentido (`deletedAt`) via extension.
- **Convenções:** `cuid()`/`uuid` como PK, `createdAt/updatedAt`, índices
  compostos começando por `organizationId`, enums no banco.
- **pgvector:** campo `vector` para embeddings (via `Unsupported`/SQL raw quando
  necessário) na tabela de chunks de conhecimento.
- **Seed** para planos/roles/permissões base.

---

## 10. Estratégia PostgreSQL

- **Versão 16**, extensões: `pgvector` (RAG), `pg_trgm` (busca textual),
  `uuid-ossp`/`pgcrypto`.
- **RLS habilitado** nas tabelas de domínio (ver §5) — isolamento no nível do SGBD.
- **Particionamento** da tabela `messages` (a que mais cresce): particionar por
  intervalo de tempo (mensal) e/ou por hash de `organizationId` para grandes
  volumes; índices locais por partição.
- **Índices** guiados pelas queries do inbox: `(organizationId, conversationId,
  createdAt)`, `(organizationId, status, assignedToId)`, busca por contato com
  `pg_trgm`.
- **Read replicas** para relatórios/consultas pesadas (roteadas separadamente).
- **Backups:** point-in-time recovery (PITR) + snapshots; testar restore.
- **Segurança:** dados sensíveis (apikey do Evolution, tokens) **criptografados
  na aplicação** antes de persistir (envelope encryption); TLS obrigatório.
- **Migrações sem downtime:** expand/contract, colunas nullable primeiro.

---

## 11. Estratégia de Upload (mídia)

**Storage:** bucket S3-compatível, um prefixo por tenant: `s3://bucket/{orgId}/...`.

**Dois caminhos:**

1. **Outbound (atendente envia mídia):**
   - Browser pede **presigned PUT** à API (`POST /media/presign`), validando
     tipo/tamanho e escopo do tenant.
   - Upload vai **direto do browser para o S3** (não passa pela API).
   - API registra o `Media` e enfileira `outbound.messages`, que instrui o
     Evolution a enviar (URL assinada ou base64, conforme o endpoint).

2. **Inbound (cliente envia mídia no WhatsApp):**
   - Evolution entrega a mídia no webhook (base64/URL temporária).
   - Worker `media.download` baixa, valida (MIME real, tamanho, antivírus
     opcional ClamAV), gera thumbnail (imagem) e grava em `{orgId}/inbound/...`.
   - `message.mediaUrl` aponta para o objeto; o painel acessa via **GET assinado**
     (ou CDN com URLs assinadas).

**Regras:** allowlist de MIME, limite de tamanho por plano, varredura AV, nomes
opacos (sem PII), lifecycle (expiração de mídia antiga conforme retenção do plano),
CDN na frente para leitura.

---

## 12. Estratégia de IA (multi-provider)

**Abstração:** pacote `packages/ai` com interface única `LlmProvider` (chat,
stream, embeddings, tool-calling) e um **registry** de providers. Implementações
para **Anthropic (Claude)** e **OpenAI (GPT)** desde o início; adicionar outro
provider é só implementar a interface. O domínio (agente, RAG, handoff) **não
conhece o fornecedor**.

**Seleção por tenant (config no banco):** cada organização (e cada canal/agente)
define `provider` + `model` + parâmetros (temperatura, system prompt, tools,
limites). Isso permite: preferência do cliente, compliance/residência de dados,
otimização de custo e **failover** entre providers.

**Normalização entre providers:** a abstração unifica formatos de mensagens,
**tool-calling** (function calling do OpenAI ↔ tools do Claude), streaming e
contagem de tokens, expondo um contrato estável ao restante do sistema. Também
padroniza **embeddings** (o provider de embeddings pode ser diferente do de chat).

**Tiers de modelo (custo × capacidade), mapeados por provider:**
- **Triagem/classificação/roteamento:** modelo rápido/barato (ex.: Claude Haiku
  ou GPT-mini) — detecta intenção, idioma, urgência, decide fila/atribuição.
- **Agente conversacional principal:** modelo intermediário (ex.: Claude Sonnet
  ou GPT padrão) — responde ao cliente com RAG e tools.
- **Casos complexos/escalonados:** modelo top (ex.: Claude Opus ou GPT topo)
  quando a confiança é baixa ou o supervisor solicita.

**Resiliência:** se o provider primário do tenant falhar/atingir limite, a
abstração faz **fallback** para um secundário configurado, registrando o desvio.

**RAG (base de conhecimento por tenant):**
- Ingestão: documento → chunking → **embeddings** → `pgvector` (isolado por org).
- Runtime: embed da pergunta → retrieval top-k (filtro `organizationId`) → injeta
  no system prompt como contexto citável.

**Tool-calling (ações reais, não fictícias):** ferramentas registradas por tenant,
ex.: `consultar_pedido`, `abrir_ticket`, `agendar`, `transferir_para_humano`,
`buscar_conhecimento`. Cada tool é um handler no backend com validação e permissão.

**Modos de operação (config por org/canal):**
- **Autopilot:** IA responde sozinha até um gatilho de handoff.
- **Copiloto:** IA sugere resposta; atendente revisa/edita/envia (`ai.suggestion`).
- **Off:** só humano.

**Handoff humano:** gatilhos por baixa confiança, intenção sensível (jurídico/
financeiro), pedido explícito do cliente, ou limite de turnos. Ao transferir,
muda `conversation.status`, atribui à fila/agente e notifica via WebSocket.

**Gestão de contexto e custo:** janela = resumo da conversa + últimas N mensagens;
**prompt caching** para system prompt/knowledge estáveis; **metering** de tokens
por org (fila `billing.usage`); orçamento por plano com corte gracioso.

**Guardrails:** validação de saída (sem vazar PII/segredos), limites de tamanho,
moderação, e sempre um caminho de fallback para humano.

---

## 13. Estratégia Evolution API

- **Topologia:** um (ou mais) contêiner Evolution; **cada número de WhatsApp de um
  tenant = uma "instance"** nomeada de forma determinística (`org_{orgId}_{n}`).
  Metadados e `apikey` da instância ficam na tabela `Channel` (apikey criptografada).
- **Provisionamento (self-service):** ao conectar um canal, o backend:
  1. cria a instance via API do Evolution;
  2. registra o **webhook** apontando para
     `POST /webhooks/evolution/:channelId` com um **token/segredo** próprio do canal;
  3. assina os eventos: `MESSAGES_UPSERT`, `MESSAGES_UPDATE`, `SEND_MESSAGE`,
     `CONNECTION_UPDATE`, `QRCODE_UPDATED`, `CONTACTS_UPSERT`.
- **Conexão (QR):** o evento `QRCODE_UPDATED` é repassado ao painel via WebSocket
  (`channel.qrcode`); `CONNECTION_UPDATE` atualiza o status (`channel.status`).
- **Recepção:** o webhook **valida o segredo do canal**, responde 200 rápido e
  **enfileira** (`inbound.messages` / `webhook.status`) — nunca processa síncrono.
- **Envio:** apenas via fila `outbound.messages` → chamadas `sendText`,
  `sendMedia`, `sendWhatsAppAudio`, `markMessageAsRead`, presença/"digitando".
- **Anti-ban:** rate-limit por número (BullMQ limiter), respeito a janelas, uso de
  presença/typing, backoff em erros de conexão.
- **Isolamento:** um canal nunca acessa instance de outro tenant (resolução via
  `Channel.organizationId`); segredos por canal.
- **Resiliência:** reconexão automática, detecção de `logout`, alerta ao tenant
  quando o número cai.

---

## 14. Fluxo completo de mensagens

### 14.1 Inbound (cliente → atendente/IA)
```
1. Cliente envia msg no WhatsApp
2. Evolution API captura → POST /webhooks/evolution/:channelId  (com segredo)
3. API: valida segredo → responde 200 → enfileira em `inbound.messages`
        (jobId = waMessageId  → idempotência)
4. Worker inbound:
   a. resolve tenant (Channel.organizationId) e seta contexto (ALS/RLS)
   b. upsert Contact + Conversation (cria se nova; reabre se resolvida)
   c. persiste Message (direction=inbound, status=received)
   d. se houver mídia → enfileira `media.download`
   e. emite `message.created` + `conversation.updated` via Socket.IO
   f. decide rota:
        - canal em Autopilot/Copiloto e sem agente ativo → `ai.process`
        - senão → fica na fila humana (atribuição por regra/round-robin)
5. Worker ai.process (se aplicável):
   a. monta contexto (resumo + últimas N msgs) + RAG (pgvector)
   b. chama Claude (com tools); executa tools no backend se pedidas
   c. Autopilot → cria Message(outbound, author=AI) e enfileira `outbound.messages`
      Copiloto → emite `ai.suggestion` para o atendente (não envia)
   d. avalia handoff (confiança/intenção) → se preciso, transfere para humano
   e. registra uso em `billing.usage`
6. Worker outbound: envia via Evolution → Message.status=sent
7. Evolution retorna MESSAGES_UPDATE (delivered/read) → `webhook.status`
   → atualiza status → emite `message.status` para o painel
```

### 14.2 Outbound (atendente → cliente)
```
1. Atendente escreve no painel → POST /conversations/:id/messages (ou evento WS)
2. API valida permissão (pode atuar nesta conversa?) → persiste Message(outbound,
   status=queued) → emite `message.created` (otimista) → enfileira `outbound.messages`
3. Worker outbound → Evolution sendText/sendMedia (rate-limited por número)
   → status=sent
4. MESSAGES_UPDATE (delivered/read) → `webhook.status` → `message.status`
```

**Garantias:** idempotência (dedupe por `waMessageId`), ordem por conversa (lock),
a verdade final está no Postgres; o WebSocket é aceleração de UX.

---

## 15. Fluxo de autenticação

- **Cadastro:** cria `User` + `Organization` + `Membership(role=OWNER)`;
  e-mail de verificação. Convites geram `Membership` para orgs existentes.
- **Senha:** hash **argon2id**. E-mail de verificação e reset por token de uso único.
- **Login:** valida credenciais → emite **access token JWT** (curto, ~15 min) +
  **refresh token** rotativo (opaco), guardado em **cookie httpOnly + Secure +
  SameSite** e **allowlisted no Redis** (`session:{userId}:{jti}`).
- **Refresh:** rotação de refresh (o antigo é revogado); detecção de reuso →
  revoga toda a sessão (proteção contra roubo de token).
- **Logout:** remove o refresh do allowlist (revogação imediata).
- **Contexto de org:** o access token identifica o **usuário**; a **organização**
  vem da membership + seleção (header `X-Org-Id`/subdomínio), sempre validada no
  `OrgContextGuard` (nunca confiar só no claim).
- **WebSocket:** handshake autenticado pelo access token; reconexão renova.
- **Opcionais previstos:** OAuth (Google), **2FA TOTP**, sessões por dispositivo.

---

## 16. Fluxo de permissões (RBAC multi-tenant)

**Papéis (por organização):** `OWNER` > `ADMIN` > `SUPERVISOR` > `AGENT` > `VIEWER`.

| Recurso / ação | OWNER | ADMIN | SUPERVISOR | AGENT | VIEWER |
|---|:-:|:-:|:-:|:-:|:-:|
| Billing / plano | ✅ | ➖ | — | — | — |
| Gerenciar equipe/roles | ✅ | ✅ | — | — | — |
| Configurar canais (WhatsApp) | ✅ | ✅ | — | — | — |
| Configurar IA / base de conhecimento | ✅ | ✅ | ➖ | — | — |
| Ver todas as conversas da org | ✅ | ✅ | ✅ | — | 👁️ |
| Atender (responder) conversas | ✅ | ✅ | ✅ | ✅(atribuídas/fila) | — |
| Reatribuir / transferir | ✅ | ✅ | ✅ | ➖ | — |
| Relatórios | ✅ | ✅ | ✅ | ➖ | 👁️ |

(✅ total · ➖ parcial/configurável · 👁️ somente leitura · — sem acesso)

**Aplicação:**
- **Nível de rota:** `RolesGuard`/`PermissionsGuard` com decorator `@Roles()`/
  `@Permissions()`.
- **Nível de recurso (policies):** ex. `AGENT` só acessa conversas atribuídas a ele
  ou às suas filas/departamentos; `SUPERVISOR`+ acessam tudo da org. Verificado
  também ao entrar na room `conversation:{id}` do WebSocket.
- **Nível de dados:** scoping por `organizationId` (Prisma extension) + **RLS** —
  garante que nenhuma query cruze tenants mesmo com falha de guard.
- **Auditoria:** ações sensíveis (mudança de role, config de IA/canal, exclusões)
  gravam em `AuditLog` com ator, org, antes/depois.

---

## 17. Diagrama textual da arquitetura

```
                         ┌──────────────────────────┐
        Cliente final    │        WhatsApp          │
        (celular)  ───▶  │       (rede Meta)        │
                         └────────────┬─────────────┘
                                      │  mensagens / status
                                      ▼
                         ┌──────────────────────────┐
                         │      EVOLUTION API        │  (self-hosted)
                         │  1 instance por número    │
                         └───┬───────────────────▲───┘
             webhook (POST)  │                   │  sendText/sendMedia
       /webhooks/evolution/:id│                   │  (rate-limited)
                             ▼                   │
   ┌───────────────────────────────────────────────────────────────────┐
   │                        BACKEND (NestJS)                             │
   │                                                                     │
   │   ┌───────────────┐   ┌──────────────┐   ┌───────────────────┐     │
   │   │  API (HTTP)   │   │  WebSocket    │   │  Webhooks Ctrl    │     │
   │   │ REST + Guards │   │ Socket.IO GW  │   │ valida segredo    │     │
   │   └──────┬────────┘   └──────┬────────┘   └─────────┬─────────┘     │
   │          │  Auth/RBAC/       │  rooms:              │ enfileira     │
   │          │  OrgContext       │  org/conv/user       ▼               │
   │          │                   │            ┌────────────────────┐    │
   │          ▼                   │            │    Redis + BullMQ   │    │
   │   ┌──────────────┐           │            │  inbound / ai /     │    │
   │   │  Services /  │◀──────────┘            │  outbound / media / │    │
   │   │ Repositories │                        │  embed / status     │    │
   │   └──────┬───────┘                        └─────────┬──────────┘    │
   │          │ Prisma (+ RLS, tenant ext.)              │ consume       │
   │          ▼                                          ▼               │
   │   ┌──────────────┐                        ┌────────────────────┐    │
   │   │ PostgreSQL 16│                        │  WORKERS (NestJS)   │    │
   │   │ pgvector/RLS │◀───────────────────────│  IA · envio · mídia │    │
   │   │ particionado │                        │  embeddings · status│    │
   │   └──────────────┘                        └───┬───────────┬─────┘    │
   └───────────────────────────────────────────────┼───────────┼──────────┘
                                                    │           │
                          ┌─────────────────────────┘           │
                          ▼                                      ▼
              ┌────────────────────┐               ┌────────────────────────┐
              │  IA — Claude        │               │  Object Storage (S3)   │
              │ triagem/agente/RAG  │               │  mídia + docs RAG      │
              │ tools · streaming   │               │  presigned URLs        │
              └────────────────────┘               └────────────────────────┘

   ┌───────────────────────────────────────────────────────────────────┐
   │                        FRONTEND (Next.js)                          │
   │   Inbox · Contatos · Canais(QR) · Config(IA/Equipe/Billing)        │
   │   REST (TanStack Query)  +  WebSocket (Socket.IO)                  │
   └───────────────────────────────────────────────────────────────────┘

   Redis também serve: cache · sessões/refresh · adapter Socket.IO ·
   locks · presença · rate-limit · idempotência.
```

---

## 18. Temas transversais (produção)

- **Observabilidade:** logs estruturados (`pino`) com request-id/org-id; métricas
  Prometheus (filas, latência, uso de IA); tracing OpenTelemetry; erros no Sentry;
  Bull Board protegido para filas.
- **Segurança:** Helmet, CORS restrito, validação de entrada, verificação de
  segredo em webhooks, rate-limit, segredos em secret manager, criptografia de
  campos sensíveis, RLS, auditoria, LGPD (retenção/expurgo de dados por tenant).
- **Deploy:** contêineres separados (api, worker, web); Postgres gerenciado +
  PgBouncer; Redis gerenciado/cluster; storage S3/R2 + CDN; Evolution em host
  próprio; CI/CD com migrations automatizadas (expand/contract).
- **Escala:** api e worker stateless e horizontais; Socket.IO com Redis adapter;
  filas com concorrência ajustável; particionamento e réplicas no Postgres.

---

## 19. Roadmap de sprints (proposto)

1. **Sprint 1 (feito):** validação do fluxo (Evolution→n8n→Supabase→painel).
2. **Sprint 2 — Fundação:** monorepo, Prisma+Postgres+RLS, Auth (JWT+refresh),
   multi-tenant (extension+ALS), CI. *Sem WhatsApp ainda.*
3. **Sprint 3 — Canais + Ingestão:** provisionamento Evolution, webhooks,
   BullMQ inbound/outbound, persistência de conversas/mensagens, WebSocket, inbox.
4. **Sprint 4 — Mídia + Envio:** upload S3, download de mídia, envio texto/mídia,
   status delivered/read, rate-limit anti-ban.
5. **Sprint 5 — IA:** abstração LLM, triagem, agente conversacional, RAG (pgvector),
   tools, handoff humano, copiloto, metering.
6. **Sprint 6 — RBAC completo + Billing + Observabilidade + Hardening.**
```
