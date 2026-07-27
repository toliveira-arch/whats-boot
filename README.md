# whats-boot — Sprint 1

Validação da comunicação entre **Evolution API → n8n → Supabase → Next.js**.

> **Escopo da Sprint 1:** provar que a infraestrutura funciona ponta-a-ponta.
> Sem IA, sem CRM, sem autenticação, sem usuários, sem dashboard, sem
> multiempresa, sem chat. Apenas: mensagem chega no WhatsApp e aparece no painel.

---

## Fluxo

```
📱 WhatsApp
   ▼
🟢 Evolution API        (recebe a mensagem, dispara webhook)
   ▼  HTTP POST
🔵 n8n                  (recebe o webhook, mapeia os campos)
   ▼  HTTP POST (REST)
🟣 Supabase / Postgres  (grava em public.messages)
   ▼  leitura (anon key)
⚫ Painel Next.js       (lista as mensagens)
```

---

## Componentes

| Pasta / arquivo | O que é |
|---|---|
| `docker-compose.yml` | Sobe Evolution API (+ Postgres + Redis) e n8n |
| `.env.example` | Variáveis de ambiente da infraestrutura |
| `supabase/migrations/0001_create_messages.sql` | Cria a tabela `messages` + RLS |
| `n8n/workflow-sprint1.json` | Workflow importável: Webhook → Supabase |
| `web/` | Painel Next.js (somente leitura) |
| `docs/SETUP.md` | **Passo-a-passo de instalação, testes e checklist** |

---

## Início rápido

```bash
# 1. Infra (Evolution + n8n)
cp .env.example .env          # preencha EVOLUTION_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
docker compose up -d

# 2. Supabase: rode o SQL de supabase/migrations/0001_create_messages.sql

# 3. n8n (http://localhost:5678): importe n8n/workflow-sprint1.json e ative

# 4. Evolution (http://localhost:8080/manager): crie a instância, conecte o
#    WhatsApp por QR Code e aponte o webhook para o n8n

# 5. Painel
cd web
cp .env.local.example .env.local   # preencha NEXT_PUBLIC_SUPABASE_URL e ANON_KEY
npm install
npm run dev                        # http://localhost:3000
```

O passo-a-passo detalhado (com os comandos `curl` do Evolution e o checklist de
testes) está em **[`docs/SETUP.md`](docs/SETUP.md)**.

---

## Endpoints

| Serviço | Endpoint | Uso |
|---|---|---|
| Evolution | `POST http://localhost:8080/instance/create` | Cria a instância |
| Evolution | `GET  http://localhost:8080/instance/connect/{instance}` | QR Code / conectar |
| Evolution | `POST http://localhost:8080/webhook/set/{instance}` | Aponta o webhook para o n8n |
| n8n | `POST http://localhost:5678/webhook/whatsapp-inbound` | Recebe o evento do Evolution (produção) |
| n8n | `POST http://localhost:5678/webhook-test/whatsapp-inbound` | Recebe durante o "Listen for test event" |
| Supabase | `POST {SUPABASE_URL}/rest/v1/messages` | Insert feito pelo n8n (service_role) |
| Supabase | `GET  {SUPABASE_URL}/rest/v1/messages` | Leitura feita pelo painel (anon) |
| Painel | `http://localhost:3000` | Lista as mensagens |

> Dentro da rede do Docker, o Evolution alcança o n8n em
> `http://n8n:5678/webhook/whatsapp-inbound` (nome do serviço, não `localhost`).
