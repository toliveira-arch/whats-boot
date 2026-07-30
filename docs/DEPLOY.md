# Deploy na nuvem (Render) — URL fixa, sem túnel

Arquitetura **single-service**: a API serve o site compilado e os webhooks na
**mesma URL HTTPS fixa**. Isso elimina túnel (cloudflared/ngrok), CORS e
coordenação de URLs. O WhatsApp (Evolution) passa a alcançar a API de forma
estável.

```
Navegador ─┐
Evolution ─┼─▶ https://whats-boot.onrender.com
           │      ├── /            → site (React)
           │      ├── /api/...     → API (Express)
           │      ├── /api/webhooks/evolution/... → webhooks
           │      └── /socket.io   → tempo real
```

## Pré-requisitos

- Conta no **Render** (render.com), grátis.
- Banco **Neon** já existente (a `DATABASE_URL` que você usa hoje).
- O repositório no GitHub (já está).

## Passos

1. No Render: **New → Blueprint** e conecte este repositório. Ele lê o
   `render.yaml` e cria o serviço `whats-boot`.
2. Em **Environment**, defina **`DATABASE_URL`** = a URL do Neon
   (use a **direta**, sem `-pooler`, para o `db:push` do build funcionar).
3. **Create** — o Render vai: instalar, gerar o Prisma Client, rodar `db:push`
   no Neon, compilar API + site e subir.
4. Ao terminar, você recebe uma URL fixa: `https://whats-boot.onrender.com`
   (o nome pode variar). **Essa URL não muda mais.**

O que é automático:

- **`API_PUBLIC_URL`** = a própria URL do Render (via `RENDER_EXTERNAL_URL`).
- **Webhooks** já apontam para `.../api/webhooks/...` — ao subir, o boot
  re-sincroniza os webhooks das instâncias com a URL nova.
- **JWT secrets** e **EVOLUTION_ENC_KEY** são gerados pelo Render.
- **Redis** fica desligado (modo inline) — nada a configurar.

## Depois do deploy

1. Acesse a URL do Render, faça login (crie a conta em `/register` ou rode o
   seed).
2. Em **Canais**, cadastre a instância da Evolution (URL + API key). O webhook
   já será configurado com a URL pública fixa.
3. Mande uma mensagem no WhatsApp → espelha no Chat/Monitor. Em
   **Canais → Diagnóstico** deve aparecer "Webhooks recebidos ✅".

## Observações

- **Seed de admin:** rode `npm run seed` uma vez (localmente apontando para o
  Neon, ou como um Job no Render) para criar o usuário admin, ou use `/register`.
- **Plano free do Render:** o serviço "dorme" após inatividade e acorda no
  primeiro acesso (alguns segundos). Para produção de verdade, use um plano pago
  (sem sleep).
- **Trocar de branch:** o `render.yaml` está fixado na branch de
  desenvolvimento; ao mesclar para a principal, ajuste `branch:` no
  `render.yaml`.
- **Escalar depois:** para vários processos/worker, habilite Redis (≥ 5) com
  `REDIS_ENABLED=true` + `REDIS_URL`, e suba um serviço de worker
  (`node apps/api/dist/worker.js`).
