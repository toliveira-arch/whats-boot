import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { tenantContext } from '../../middlewares/tenantContext';
import { requirePermissions } from '../../middlewares/authorize';
import { validateBody } from '../../middlewares/validate';
import { knowledgeSchema } from './knowledge.validation';
import { getKnowledgeController, upsertKnowledgeController } from './knowledge.controller';

export const knowledgeRouter = Router();
knowledgeRouter.use(authenticate, tenantContext);

knowledgeRouter.get('/', requirePermissions('ai.read'), getKnowledgeController);
knowledgeRouter.put(
  '/',
  requirePermissions('ai.manage'),
  validateBody(knowledgeSchema),
  upsertKnowledgeController,
);
