# Sprint 1 — Setup, testes por etapa e checklist

Este documento leva você do zero até ver uma mensagem do WhatsApp aparecer no
painel, **validando cada etapa isoladamente** antes de testar o fluxo completo.

Variáveis usadas nos exemplos (ajuste conforme seu `.env`):

- `EVOLUTION_API_KEY` = a chave que você definiu no `.env`
- `INSTANCE` = `sprint1` (nome da instância do WhatsApp)
- `SUPABASE_URL` = `https://xxxx.supabase.co`

---

## Pré-requisitos

- Docker + Docker Compose
- Node.js 18+ (para o painel)
- Uma conta gratuita no [Supabase](https://supabase.com) com um projeto criado
- Um número de WhatsApp para conectar (de teste, de preferência)

---

## Passo 0 — Variáveis de ambiente

```bash
cp .env.example .env
```

Preencha no `.env`:

| Variável                    | Onde obter                                                   |
| --------------------------- | ------------------------------------------------------------ |
| `EVOLUTION_API_KEY`         | invente uma (`openssl rand -hex 16`)                         |
| `SUPABASE_URL`              | Supabase → Project Settings → API → Project URL              |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` (secreta) |

---

## Passo 1 — Supabase (banco)

1. No painel do Supabase, abra **SQL Editor**.
2. Cole o conteúdo de `supabase/migrations/0001_create_messages.sql` e clique **Run**.

**✅ Como testar esta etapa:**

```bash
# Deve retornar [] (lista vazia), provando que a tabela existe e a anon key lê.
curl "$SUPABASE_URL/rest/v1/messages?select=*" \
  -H "apikey: <ANON_KEY>"
```

Retorno esperado: `[]`. Se vier erro de "relation does not exist", o SQL não rodou.

---

## Passo 2 — Subir a infraestrutura (Evolution + n8n)

```bash
docker compose up -d
docker compose ps        # todos "running"/"healthy"
```

**✅ Como testar esta etapa:**

```bash
# Evolution respondendo:
curl http://localhost:8080

# n8n respondendo (abra no navegador):
#   http://localhost:5678
```

---

## Passo 3 — n8n (workflow)

1. Abra `http://localhost:5678` e crie a conta local (owner).
2. **Import from File** → selecione `n8n/workflow-sprint1.json`.
3. Abra o workflow e clique em **Active** (canto superior direito).
   - O nó `Supabase Insert` usa `$env.SUPABASE_URL` e `$env.SUPABASE_SERVICE_ROLE_KEY`,
     já injetadas no container pelo `docker-compose.yml`.

A URL de produção do webhook será:
`http://localhost:5678/webhook/whatsapp-inbound`
(dentro do Docker: `http://n8n:5678/webhook/whatsapp-inbound`)

**✅ Como testar esta etapa (n8n → Supabase, sem WhatsApp ainda):**

Simule um evento do Evolution enviando um POST direto ao webhook do n8n:

```bash
curl -X POST http://localhost:5678/webhook/whatsapp-inbound \
  -H "Content-Type: application/json" \
  -d '{
    "event": "messages.upsert",
    "instance": "sprint1",
    "data": {
      "key": { "remoteJid": "5511999999999@s.whatsapp.net", "fromMe": false, "id": "TESTE-0001" },
      "pushName": "Teste Manual",
      "messageType": "conversation",
      "message": { "conversation": "Olá, Sprint 1!" }
    }
  }'
```

Agora confirme que gravou no Supabase:

```bash
curl "$SUPABASE_URL/rest/v1/messages?select=*&wa_message_id=eq.TESTE-0001" \
  -H "apikey: <ANON_KEY>"
```

Retorno esperado: um objeto com `content: "Olá, Sprint 1!"`. ✅ n8n → Supabase OK.

> Se o workflow estiver **inativo**, use a URL de teste
> `http://localhost:5678/webhook-test/whatsapp-inbound` após clicar em
> "Listen for test event" no nó Webhook.

---

## Passo 4 — Evolution API (WhatsApp)

### 4.1 Criar a instância

```bash
curl -X POST http://localhost:8080/instance/create \
  -H "Content-Type: application/json" \
  -H "apikey: $EVOLUTION_API_KEY" \
  -d '{ "instanceName": "sprint1", "integration": "WHATSAPP-BAILEYS" }'
```

### 4.2 Conectar o WhatsApp (QR Code)

Abra o **Manager**: `http://localhost:8080/manager` → selecione a instância
`sprint1` → **Connect** → escaneie o QR Code com o WhatsApp do celular.
(Ou via API: `GET http://localhost:8080/instance/connect/sprint1`.)

**✅ Como testar:** o status da instância deve ficar `open`/`connected`:

```bash
curl http://localhost:8080/instance/connectionState/sprint1 \
  -H "apikey: $EVOLUTION_API_KEY"
```

### 4.3 Apontar o webhook para o n8n

```bash
curl -X POST http://localhost:8080/webhook/set/sprint1 \
  -H "Content-Type: application/json" \
  -H "apikey: $EVOLUTION_API_KEY" \
  -d '{
    "webhook": {
      "enabled": true,
      "url": "http://n8n:5678/webhook/whatsapp-inbound",
      "webhookByEvents": false,
      "events": ["MESSAGES_UPSERT"]
    }
  }'
```

> Use `http://n8n:5678/...` (nome do serviço no Docker), **não** `localhost`,
> porque a chamada parte de dentro do container do Evolution.

**✅ Como testar:** confirme o webhook salvo:

```bash
curl http://localhost:8080/webhook/find/sprint1 \
  -H "apikey: $EVOLUTION_API_KEY"
```

---

## Passo 5 — Painel Next.js

```bash
cd web
cp .env.local.example .env.local   # NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY
npm install
npm run dev
```

Abra `http://localhost:3000`. Você deve ver a mensagem de teste `TESTE-0001`
gravada no Passo 3.

---

## Passo 6 — Teste ponta-a-ponta (o objetivo da Sprint 1)

1. Deixe o painel aberto em `http://localhost:3000`.
2. De **outro** celular, envie uma mensagem de WhatsApp para o número conectado.
3. Em poucos segundos a mensagem deve aparecer no painel (atualiza a cada 5s).

Fluxo validado: **WhatsApp → Evolution → n8n → Supabase → Painel**. 🎉

---

## ✅ Checklist de testes (Sprint 1)

Marque cada item ao validar:

- [ ] **Supabase** — a migration rodou; `GET /rest/v1/messages` retorna `[]`.
- [ ] **Docker** — `docker compose ps` mostra postgres, redis, evolution-api e n8n saudáveis.
- [ ] **Evolution online** — `curl http://localhost:8080` responde.
- [ ] **n8n online** — `http://localhost:5678` abre e o workflow foi importado e **ativado**.
- [ ] **n8n → Supabase** — o `curl` de POST no webhook (Passo 3) cria a linha `TESTE-0001` no Supabase.
- [ ] **Instância criada** — `instance/create` retornou sucesso.
- [ ] **WhatsApp conectado** — `connectionState/sprint1` = `open`.
- [ ] **Webhook configurado** — `webhook/find/sprint1` mostra a URL do n8n e o evento `MESSAGES_UPSERT`.
- [ ] **Painel lê** — `http://localhost:3000` exibe a mensagem `TESTE-0001`.
- [ ] **Ponta-a-ponta** — mensagem real enviada no WhatsApp aparece no painel em segundos.

Se **todos** os itens estiverem marcados, a infraestrutura da Sprint 1 está validada.

---

## Troubleshooting rápido

| Sintoma                              | Provável causa                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Webhook não chega no n8n             | Usou `localhost` no lugar de `n8n:5678` no `webhook/set`; ou workflow inativo                        |
| n8n recebe mas não grava             | `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` ausentes no container (recrie com `docker compose up -d`) |
| Painel vazio mas Supabase tem dados  | `NEXT_PUBLIC_SUPABASE_*` faltando/errado em `web/.env.local`                                         |
| `relation "messages" does not exist` | A migration do Passo 1 não foi aplicada                                                              |
| Mensagem própria duplicando          | Evolution emite `fromMe:true`; o índice único por `wa_message_id` evita duplicatas                   |
