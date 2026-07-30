import { Router } from 'express';
import { evolutionWebhookController } from './webhook.controller';

// Rota PÚBLICA (autenticada pelo token do canal). Recebe eventos da Evolution.
export const webhookRouter = Router();

// Token no path (preferido) e sem token (fallback via query/header).
// A variante com :event cobre versões da Evolution que anexam o nome do evento
// (webhookByEvents) à URL, ex.: /evolution/:id/:token/messages-upsert.
webhookRouter.post('/evolution/:channelId/:token/:event', evolutionWebhookController);
webhookRouter.post('/evolution/:channelId/:token', evolutionWebhookController);
webhookRouter.post('/evolution/:channelId', evolutionWebhookController);

// Teste manual de alcance: abra esta URL (túnel) no navegador. Se aparecer o
// JSON, o caminho túnel → API está OK (isola o problema da Evolution).
webhookRouter.get('/evolution/ping', (_req, res) => {
  res.json({ ok: true, message: 'webhook endpoint alcançável', ts: Date.now() });
});
