import { Router } from 'express';
import { evolutionWebhookController } from './webhook.controller';
import { cloudWebhookController, cloudWebhookVerifyController } from './cloud.webhook.controller';

// Rota PÚBLICA (autenticada pelo token do canal). Recebe eventos da Evolution.
export const webhookRouter = Router();

// Token no path (preferido) e sem token (fallback via query/header).
// A variante com :event cobre versões da Evolution que anexam o nome do evento
// (webhookByEvents) à URL, ex.: /evolution/:id/:token/messages-upsert.
webhookRouter.post('/evolution/:channelId/:token/:event', evolutionWebhookController);
webhookRouter.post('/evolution/:channelId/:token', evolutionWebhookController);
webhookRouter.post('/evolution/:channelId', evolutionWebhookController);

// WhatsApp Cloud API (Meta). URL ÚNICA para todos os números do app — o canal
// é descoberto pelo phone_number_id de cada evento, não pelo path.
// GET  = desafio de verificação (só na hora de cadastrar no painel da Meta)
// POST = mensagens e status (autenticado pela assinatura X-Hub-Signature-256)
webhookRouter.get('/whatsapp/cloud', cloudWebhookVerifyController);
webhookRouter.post('/whatsapp/cloud', cloudWebhookController);

// Teste manual de alcance: abra esta URL (túnel) no navegador. Se aparecer o
// JSON, o caminho túnel → API está OK (isola o problema da Evolution).
webhookRouter.get('/evolution/ping', (_req, res) => {
  res.json({ ok: true, message: 'webhook endpoint alcançável', ts: Date.now() });
});
