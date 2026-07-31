import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { tenantContext } from '../../middlewares/tenantContext';
import { requirePermissions } from '../../middlewares/authorize';
import { validateBody } from '../../middlewares/validate';
import { rdConfigSchema } from './rd.validation';
import {
  getRdController,
  rdEventsController,
  rdWebhookController,
  regenerateRdController,
  updateRdController,
} from './rd.controller';

/** Rota PÚBLICA do webhook (autenticada pelo token no path). */
export const rdWebhookRouter = Router();
rdWebhookRouter.post('/rdstation/webhook/:token', rdWebhookController);

/** Rotas de configuração (autenticadas). */
export const integrationsRouter = Router();
integrationsRouter.use(authenticate, tenantContext);

const READ = requirePermissions('channels.read');
const MANAGE = requirePermissions('channels.manage');

integrationsRouter.get('/rdstation', READ, getRdController);
integrationsRouter.put('/rdstation', MANAGE, validateBody(rdConfigSchema), updateRdController);
integrationsRouter.post('/rdstation/regenerate', MANAGE, regenerateRdController);
integrationsRouter.get('/rdstation/events', READ, rdEventsController);
