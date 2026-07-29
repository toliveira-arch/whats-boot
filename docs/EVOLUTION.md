# ETAPA 7 — Integração Evolution API (v2)

Integração completa e **sem simulação**, seguindo a documentação oficial da
Evolution API v2. Todo evento é salvo no banco (isolado por tenant).

## Endpoints da nossa API

### Canais (`/channels`) — protegido (auth + tenant + permissão)

| Método | Rota                      | Permissão       | Ação                                                    |
| ------ | ------------------------- | --------------- | ------------------------------------------------------- |
| POST   | `/channels/test`          | channels.manage | Testa URL + API KEY (fetchInstances)                    |
| POST   | `/channels`               | channels.manage | Cadastra: cria instância, configura webhook, retorna QR |
| GET    | `/channels`               | channels.read   | Lista canais                                            |
| GET    | `/channels/:id/qrcode`    | channels.manage | (Re)gera o QR Code                                      |
| GET    | `/channels/:id/state`     | channels.read   | Estado da conexão (sincroniza)                          |
| POST   | `/channels/:id/reconnect` | channels.manage | Reconecta (restart)                                     |
| POST   | `/channels/:id/logout`    | channels.manage | Desconecta                                              |
| DELETE | `/channels/:id`           | channels.manage | Remove (soft delete + delete na Evolution)              |

### Envio (`/messages`) — protegido (permissão conversations.write)

| Método | Rota              | Corpo                                                                     |
| ------ | ----------------- | ------------------------------------------------------------------------- |
| POST   | `/messages/text`  | `{ channelId, number, text }`                                             |
| POST   | `/messages/media` | `{ channelId, number, mediatype, media, mimetype?, fileName?, caption? }` |

`mediatype`: `image` \| `video` \| `audio` \| `document` (documentos = `document`).
`media` aceita URL ou base64.

### Webhook (`/webhooks/evolution/:channelId`) — público (token do canal)

Recebe os eventos da Evolution, valida o token, grava `WebhookEvent`
(idempotência por `id` da mensagem) e **enfileira** para o worker. Responde 200
imediatamente.

## Endpoints oficiais da Evolution usados (v2)

`POST /instance/create` · `GET /instance/connect/{i}` ·
`GET /instance/connectionState/{i}` · `POST /instance/restart/{i}` ·
`DELETE /instance/logout/{i}` · `DELETE /instance/delete/{i}` ·
`POST /webhook/set/{i}` · `POST /message/sendText/{i}` ·
`POST /message/sendMedia/{i}` · `POST /chat/markMessageAsRead/{i}` ·
`POST /chat/sendPresence/{i}`.

Eventos assinados: `QRCODE_UPDATED`, `CONNECTION_UPDATE`, `MESSAGES_UPSERT`,
`MESSAGES_UPDATE`, `SEND_MESSAGE`, `CONTACTS_UPSERT`, `PRESENCE_UPDATE`.

## Fluxo (tudo salvo no banco)

```
Recebimento:
  WhatsApp → Evolution → POST /webhooks/evolution/:id (valida token)
    → grava WebhookEvent → fila inbound.messages
    → worker (ingest): upsert Contact + Conversation + Message
       · MESSAGES_UPSERT  → nova mensagem (entrada/saída)
       · MESSAGES_UPDATE  → status (SENT/DELIVERED/READ) + MessageStatusEvent
       · CONNECTION_UPDATE→ status do canal
       · QRCODE_UPDATED   → novo QR (emite channel.qrcode)
       · PRESENCE_UPDATE  → presença
    → emite em tempo real (Socket.IO) para o tenant

Envio:
  POST /messages/text|media → persiste Message(QUEUED) → fila outbound.messages
    → worker: Evolution sendText/sendMedia → status SENT + waMessageId
    → MESSAGES_UPDATE traz DELIVERED/READ depois
```

## Segurança

- A **apikey** de cada instância é criptografada (AES-256-GCM) em repouso.
- Cada webhook tem um **token secreto por canal** validado a cada chamada.
- Idempotência de eventos por `(instância, id da mensagem)` + `jobId` na fila.
- Emissão em tempo real a partir do worker via **Redis emitter** (`broadcastToTenant`).

## Variáveis novas

- `API_PUBLIC_URL` — URL da API alcançável pela Evolution (monta a URL do webhook).
- `EVOLUTION_ENC_KEY` — chave de criptografia das apikeys (deriva do JWT se ausente).

> A Evolution API roda separadamente (self-hosted). Configure `API_PUBLIC_URL`
> para um endereço que a Evolution consiga alcançar (em Docker, o nome do serviço
> da API; em nuvem, o domínio público).
