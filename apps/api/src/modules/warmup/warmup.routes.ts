import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { tenantContext } from '../../middlewares/tenantContext';
import { requirePermissions } from '../../middlewares/authorize';
import { validateBody } from '../../middlewares/validate';
import {
  assetSchema,
  createSessionSchema,
  statusSchema,
  updateSessionSchema,
} from './warmup.validation';
import {
  addAssetController,
  createSessionController,
  deleteAssetController,
  deleteSessionController,
  listAssetsController,
  listSessionsController,
  runNowController,
  runTimedController,
  setStatusController,
  updateSessionController,
} from './warmup.controller';

export const warmupRouter = Router();
warmupRouter.use(authenticate, tenantContext);

const READ = requirePermissions('channels.read');
const MANAGE = requirePermissions('channels.manage');

// Sessões de aquecimento
warmupRouter.get('/sessions', READ, listSessionsController);
warmupRouter.post('/sessions', MANAGE, validateBody(createSessionSchema), createSessionController);
warmupRouter.patch(
  '/sessions/:id',
  MANAGE,
  validateBody(updateSessionSchema),
  updateSessionController,
);
warmupRouter.post('/sessions/:id/status', MANAGE, validateBody(statusSchema), setStatusController);
warmupRouter.post('/sessions/:id/run', MANAGE, runNowController);
warmupRouter.post('/sessions/:id/run-timed', MANAGE, runTimedController);
warmupRouter.delete('/sessions/:id', MANAGE, deleteSessionController);

// Galeria de imagens
warmupRouter.get('/assets', READ, listAssetsController);
warmupRouter.post('/assets', MANAGE, validateBody(assetSchema), addAssetController);
warmupRouter.delete('/assets/:id', MANAGE, deleteAssetController);
