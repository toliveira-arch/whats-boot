import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { tenantContext } from '../../middlewares/tenantContext';
import { requirePermissions } from '../../middlewares/authorize';
import { validateBody } from '../../middlewares/validate';
import {
  createChannelSchema,
  setChannelAiSchema,
  testConnectionSchema,
} from './channels.validation';
import {
  createChannelController,
  deleteChannelController,
  listChannelsController,
  logoutChannelController,
  qrCodeController,
  reconnectController,
  setChannelAiController,
  stateController,
  testConnectionController,
} from './channels.controller';

export const channelsRouter = Router();

// Todas as rotas exigem autenticação + contexto de tenant.
channelsRouter.use(authenticate, tenantContext);

channelsRouter.get('/', requirePermissions('channels.read'), listChannelsController);

channelsRouter.post(
  '/test',
  requirePermissions('channels.manage'),
  validateBody(testConnectionSchema),
  testConnectionController,
);

channelsRouter.post(
  '/',
  requirePermissions('channels.manage'),
  validateBody(createChannelSchema),
  createChannelController,
);

channelsRouter.get('/:channelId/qrcode', requirePermissions('channels.manage'), qrCodeController);
channelsRouter.get('/:channelId/state', requirePermissions('channels.read'), stateController);
channelsRouter.post(
  '/:channelId/reconnect',
  requirePermissions('channels.manage'),
  reconnectController,
);
channelsRouter.post(
  '/:channelId/logout',
  requirePermissions('channels.manage'),
  logoutChannelController,
);
channelsRouter.patch(
  '/:channelId/ai',
  requirePermissions('channels.manage'),
  validateBody(setChannelAiSchema),
  setChannelAiController,
);
channelsRouter.delete(
  '/:channelId',
  requirePermissions('channels.manage'),
  deleteChannelController,
);
