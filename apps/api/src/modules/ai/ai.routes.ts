import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { tenantContext } from '../../middlewares/tenantContext';
import { requirePermissions } from '../../middlewares/authorize';
import { validateBody } from '../../middlewares/validate';
import { agentSchema, credentialSchema, testSchema } from './ai.validation';
import {
  diagnosticsController,
  getAgentController,
  listCredentialsController,
  setCredentialController,
  testController,
  testCloserController,
  upsertAgentController,
} from './ai.controller';

export const aiRouter = Router();
aiRouter.use(authenticate, tenantContext);

const READ = requirePermissions('ai.read');
const MANAGE = requirePermissions('ai.manage');

aiRouter.get('/agent', READ, getAgentController);
aiRouter.put('/agent', MANAGE, validateBody(agentSchema), upsertAgentController);

aiRouter.get('/credentials', MANAGE, listCredentialsController);
aiRouter.put('/credentials', MANAGE, validateBody(credentialSchema), setCredentialController);

aiRouter.post('/test', MANAGE, validateBody(testSchema), testController);
aiRouter.post('/test-closer', MANAGE, testCloserController);

// Diagnóstico do atendimento: leads aguardando + o motivo exato de cada um.
aiRouter.get('/diagnostics', READ, diagnosticsController);
