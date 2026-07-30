import { Router } from 'express';
import { evolutionWebhookController } from './webhook.controller';

// Rota PÚBLICA (autenticada pelo token do canal). Recebe eventos da Evolution.
export const webhookRouter = Router();

// Token no path (preferido) e sem token (fallback via query/header).
webhookRouter.post('/evolution/:channelId/:token', evolutionWebhookController);
webhookRouter.post('/evolution/:channelId', evolutionWebhookController);
