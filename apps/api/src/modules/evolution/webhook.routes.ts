import { Router } from 'express';
import { evolutionWebhookController } from './webhook.controller';

// Rota PÚBLICA (autenticada pelo token do canal). Recebe eventos da Evolution.
export const webhookRouter = Router();

webhookRouter.post('/evolution/:channelId', evolutionWebhookController);
