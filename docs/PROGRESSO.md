# ZAPmoon — Progresso do Projeto

> Documento-resumo de tudo que foi implementado nesta fase de evolução da
> plataforma. Serve como referência para testes, deploy e continuidade.
>
> Última atualização: 2026-08-10 · Branch: `claude/o-que-temos-conectado-up31yx`

---

## 1. Visão geral

ZAPmoon é um SaaS **multi-tenant** de WhatsApp para **pré-qualificação de leads
por SDR com IA**. Recebe leads de CRMs/mídia paga (RD Station, Kommo, Foresee/4C),
faz o primeiro contato automático no WhatsApp, conduz uma qualificação
consultiva guiada por prompt e devolve o lead qualificado para o closer, além
de sinalizar de volta nos CRMs para evitar atendimento duplicado.

**Stack:** monorepo npm workspaces — `apps/api` (Express + TypeScript, Prisma,
Zod, Pino), `apps/web` (React 18 + Vite + Socket.IO), `packages/database`
(Prisma + PostgreSQL/Neon). Multi-tenant via `AsyncLocalStorage`. WhatsApp via
Evolution API (Baileys). Deploy em serviço único no Render.

---

## 2. O que foi feito nesta fase

### 2.1 CRM (kanban de leads)

- **Removidos os botões de ligar e WhatsApp** dos cards do CRM (não faziam
  sentido no fluxo).
- **Descrição da etapa "Em Andamento"** alterada para **"Em conversa /
  Qualificando"**.
- **Botão "Gerar lead teste"** (`createTestLead`): cria um lead com
  `origin: 'CRM'` e dispara a mensagem para um número informado — usado para
  validar a ponta a ponta sem depender do RD.
- **Botão "Enviar ao closer"** (apenas em leads **QUALIFICADOS**): força o
  encaminhamento manual ao closer quando o envio automático não ocorreu
  (`notifyCloserForConversation`).

### 2.2 Trava do robô (só leads de CRM)

Antes o robô respondia **qualquer** contato. Agora existe uma trava:

- `Conversation.origin` (`INBOUND` por padrão; `CRM` quando o lead entra por
  integração).
- Em `ai.service.ts`, o gate `onlyCrmLeads` (padrão **ligado**) **ignora**
  conversas que não sejam `origin === 'CRM'` e ainda não tenham veredito de
  lead (`not-crm-lead`).
- Configurável na tela de IA (toggle **"Só atender leads que entraram pelo
  CRM"**).

### 2.3 Anti-duplicidade da 1ª mensagem

Sem Redis, os jobs rodam **inline** (o `jobId` do BullMQ não deduplica). Como o
webhook do CRM chega 2x (add + status) e com retries, a abertura era enviada em
duplicidade.

- **Correção:** `alreadyContacted(companyId, phone)` em `dispatch.ts` — janela
  de **6h** por número. Se já houve envio recente, retorna `skipped`.
- RD, Kommo e Foresee agora usam o **núcleo compartilhado** `dispatchLead`, que
  aplica a deduplicação de forma central.

### 2.4 Fluxo de qualificação guiado por prompt

Antes: qualificação ligada porém com script estruturado vazio → conversa
"fechava" na hora.

- **Correção:** `promptDriven` liga automaticamente quando não há script
  estruturado (`scriptForPrompt.length === 0`), ou pode ser forçado no editor.
- Prompt de sistema com **duas variações** (guiado por prompt × estruturado).
- `mapPromptVerdict`: `ENCAMINHAR → QUALIFIED`, `DISPENSADO → DISQUALIFIED`,
  `CLIENTE_ATIVO → QUALIFIED` (sinalizado), demais → `IN_PROGRESS`.

### 2.5 Atendimento consultivo por campanha (dados do RD Marketing)

O RD Marketing envia no webhook os dados da campanha/formulário. Agora usamos:

- `extractLead` retorna `campaign`, `form`, `source`, `company` e `collected`
  (extraído de `first_conversion`/`last_conversion` e campos custom).
- **Filtro de mídia paga** (`paidMediaOnly`): descarta o que não é anúncio
  (`SKIPPED "fora da mídia paga"`). `DEFAULT_PAID_SOURCES` ampliado (Facebook/
  Instagram/Meta/Google Ads, lead ads, cpc, tráfego pago, etc.).
- **Mapa de campanha** (`classifyCampaign`): classifica o tipo (ex.: `troca`,
  `restaurante`, `bpo`, `generico`) a partir de trechos configuráveis.
- **Aberturas por tipo** (`pickOpening`): mensagem de boas-vindas consultiva
  por tipo de campanha, com variáveis `{{nome}} {{campanha}} {{formulario}}
{{empresa}}`.
- **Pré-preenchimento** (`extractFormFields`): mapeia respostas do formulário
  (faturamento, regime, cnpj, ramo, decisor, dor, funcionários) para o
  `collected`. O robô **não repergunta** o que o formulário já respondeu
  ("DADOS JÁ COLETADOS").
- Todo o contexto de entrada (`entry`) é injetado no prompt: _"NUNCA pergunte de
  qual campanha veio"_ e o tipo direciona o roteiro.

Configurável na aba **RD Station → "Mídia paga & campanhas"** (toggle mídia
paga, origens aceitas, mapa de campanha, JSON de aberturas).

### 2.6 Integração Kommo (entrada)

- Modelos `KommoIntegration` / `KommoLeadEvent`.
- `kommo.service.ts` + `kommo.client.ts`: recebe o webhook, busca o telefone
  via API do Kommo, aplica `sourceFilter` e chama `dispatchLead` (com dedupe).
- Painel `KommoPanel.tsx` na tela de Integrações.

### 2.7 Integração Foresee / 4C (entrada + saída)

- Modelos `WebhookIntegration` / `WebhookLeadEvent` (genéricos).
- **Entrada:** recebe o lead e dispara via `dispatchLead`; guarda o UUID do card
  em `metadata.foreseeCardId`.
- **Saída:** `updateForeseeCardOnQualify` faz `POST /api/v1/cards/update` com
  `Authorization: Bearer <token>` + header `X-User-Uuid`, corpo
  `{ uuid, temperature?, responsible? }` — chamado quando o lead vira
  QUALIFIED. (A REST da Foresee não permite mover de etapa; a sinalização é por
  temperatura/responsável. **Formato exato a confirmar em 1 chamada real** —
  há log da resposta.)
- Painel `WebhookPanel.tsx` (campos de entrada + API de saída).

### 2.8 Sinalização de volta nos CRMs (anti-duplicação de atendimento)

Objetivo: quando o robô assume/qualifica, sinalizar no CRM para que a equipe
veja que o robô está atuando e não faça atendimento duplicado. Implementado na
saída do Foresee (temperatura/responsável). Kommo (mover etapa) e RD dependem de
IDs/confirmação de API — **pendente de inputs**.

### 2.9 Modelo de IA

- Modelo padrão alterado de `gpt-4o-mini` para **`gpt-4o`** (mais avançado).

### 2.10 Menu "Conhecimento" removido

Informação já disponível no menu de IA — menu duplicado retirado.

### 2.11 Aquecimento de chip (warmup)

- Antes enviava só 1 mensagem. Agora os robôs **conversam entre si** em
  diálogos reais (streaks de 3–6 mensagens): `runConversation`,
  `startTestConversation`.
- Botão **"Conversar por X minutos agora"** (`startTimedConversation` /
  `runTimedConversation`).

### 2.12 Alerta de desconexão de instância

- `sendDisconnectAlert` / `testDisconnectAlert`: notifica o número do
  responsável quando um canal cai. Botão **"Testar alerta"** na tela de Canais.

### 2.13 Erros da Evolution mais claros

- `EvolutionError` → middleware retorna **502 com a mensagem real** (antes
  mostrava genérico "Erro interno").
- Timeout de 15s (`AbortController`); falhas de rede viram
  `"Não foi possível alcançar o servidor: …"`.

### 2.14 Materiais de apresentação

- PDF técnico (`ZapMoon-Apresentacao.pdf`).
- PDF comercial voltado ao cliente (`ZapMoon-Apresentacao-Comercial.pdf`).
- Logo real ZAPmoon aplicada (wordmark, "A" formado por dois triângulos).
- Versão **PPTX editável** (`ZAPmoon-Apresentacao-Comercial.pptx`).

---

## 3. Arquitetura de integrações (entrada)

Todas as integrações de entrada compartilham o núcleo `dispatch.ts`:

```
Webhook do CRM ─▶ service específico (rd / kommo / webhook)
                    │  extrai nome/telefone/campanha/collected
                    │  aplica filtros (mídia paga, sourceFilter)
                    ▼
                dispatchLead()
                    │  escolhe canal · dedupe 6h
                    │  envia 1ª mensagem (consultiva)
                    │  origin = 'CRM' · qualification = { entry, collected }
                    │  guarda foreseeCardId (saída)
                    ▼
                CRM ao vivo (Socket.IO crm.updated) ─▶ robô SDR qualifica
```

---

## 4. Como testar (checklist)

1. **Deploy Live** no Render (o build aplica o schema via `db:push:ci`).
2. **RD Station:** colar a URL do webhook; ativar integração; preencher mapa de
   campanha + JSON de aberturas; ligar **"Só atender leads de anúncio"** se
   desejado.
3. **IA:** prompt Neil/Toyoshima ativo; qualificação ligada (guiada por prompt).
4. **Canal WhatsApp** conectado (Evolution ou, futuramente, Cloud API).
5. Gerar lead (real ou "Gerar lead teste").
6. **Observar:** RD "Últimos leads recebidos" (status SENT); card em "Lead Novo"
   no CRM; **1ª mensagem consultiva** (não genérica); robô **não repergunta** o
   que o formulário já respondeu; sem duplicidade (dedupe 6h por número).

---

## 5. Pendências / próximos passos

- **Meta WhatsApp Cloud API (oficial):** migração planejada (um WABA com vários
  números). Faltam do lado do cliente: App Secret, Verify Token, token
  permanente, Phone Number ID e template aprovado. **Ainda não implementado em
  código** (Etapas: tipo de canal → webhook → envio → template).
- **Foresee saída:** confirmar corpo/auth exatos do `/api/v1/cards/update` em 1
  chamada real (há log).
- **Sinalização de volta** no Kommo (mover etapa exige IDs de status) e no RD
  (depende de confirmação da API).

### Rodada Neil — próximos blocos (em ordem)

- **Patch B — remover a casca do BullMQ** (execução inline honesta): tirar
  `enqueueOrRun`/`queues`/`worker.ts` (deploy é serviço único; hoje já roda
  inline). Redis permanece para Socket.IO/health. A remoção do `jobId` do inbound
  só entra aqui, e só porque a garantia por estado (`Message.waMessageId @unique`)
  já existe. **Plano antes de codar.**
- **Follow-up (DEPOIS do Patch B) — normalização de telefone na ENTRADA do
  inbound:** o `resolveContactAndConversation` casa o reply do lead por `waJid`
  **exato**, mas o Baileys às vezes dropa o 9º dígito no JID → o reply não casa
  com a conversa do CRM (13 díg. com 9) e a trava do robô falha. Corrigir com
  **match por conjunto de variantes-OR** (mesma família de `normalizeBrPhone`)
  no lookup de contato/conversa. É o mesmo problema de normalização que o Patch A
  resolveu na ponta de saída — não pode se perder.

### Segurança (ação do cliente)

- **Rotacionar** a senha do banco Neon (foi exposta).
- **Revogar** o token do ngrok exposto.
- **Revogar/rotacionar** os tokens do Meta e da Foresee colados no chat.
- Tokens **nunca** devem ser colados no chat — vão no painel, onde ficam
  **criptografados**.

---

## 6. Principais arquivos

| Área                       | Arquivo                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| Núcleo de entrada + dedupe | `apps/api/src/modules/integrations/dispatch.ts`                                                        |
| RD Station                 | `apps/api/src/modules/integrations/rd.service.ts`                                                      |
| Kommo                      | `apps/api/src/modules/integrations/kommo.service.ts` · `kommo.client.ts`                               |
| Foresee/4C                 | `apps/api/src/modules/integrations/webhook.service.ts`                                                 |
| IA / qualificação          | `apps/api/src/modules/ai/ai.service.ts` · `ai/qualification.ts`                                        |
| Evolution                  | `apps/api/src/modules/evolution/evolution.client.ts` · `channels.service.ts`                           |
| Aquecimento                | `apps/api/src/modules/warmup/warmup.engine.ts`                                                         |
| CRM                        | `apps/api/src/modules/crm/crm.service.ts`                                                              |
| Schema                     | `packages/database/prisma/schema.prisma`                                                               |
| Web — Integrações          | `apps/web/src/pages/Integrations.tsx` · `components/{KommoPanel,WebhookPanel,QualificationEditor}.tsx` |
| Web — CRM / Canais / IA    | `apps/web/src/pages/{Crm,Channels,AiSettings}.tsx`                                                     |
