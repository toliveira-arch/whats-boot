import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { tenantContext } from '../../middlewares/tenantContext';
import { requirePermissions } from '../../middlewares/authorize';
import { validateBody } from '../../middlewares/validate';
import { rdConfigSchema } from './rd.validation';
import { kommoConfigSchema } from './kommo.validation';
import {
  getRdController,
  rdEventsController,
  rdWebhookController,
  regenerateRdController,
  updateRdController,
} from './rd.controller';
import {
  getKommoController,
  kommoEventsController,
  kommoWebhookController,
  regenerateKommoController,
  updateKommoController,
} from './kommo.controller';

/** Rota PÚBLICA do webhook (autenticada pelo token no path). */
export const rdWebhookRouter = Router();
rdWebhookRouter.post('/rdstation/webhook/:token', rdWebhookController);
rdWebhookRouter.post('/kommo/webhook/:token', kommoWebhookController);

/** Rotas de configuração (autenticadas). */
export const integrationsRouter = Router();
integrationsRouter.use(authenticate, tenantContext);

const READ = requirePermissions('channels.read');
const MANAGE = requirePermissions('channels.manage');

integrationsRouter.get('/rdstation', READ, getRdController);
integrationsRouter.put('/rdstation', MANAGE, validateBody(rdConfigSchema), updateRdController);
integrationsRouter.post('/rdstation/regenerate', MANAGE, regenerateRdController);
integrationsRouter.get('/rdstation/events', READ, rdEventsController);

integrationsRouter.get('/kommo', READ, getKommoController);
integrationsRouter.put('/kommo', MANAGE, validateBody(kommoConfigSchema), updateKommoController);
integrationsRouter.post('/kommo/regenerate', MANAGE, regenerateKommoController);
integrationsRouter.get('/kommo/events', READ, kommoEventsController);
