import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { tenantContext } from '../../middlewares/tenantContext';
import { requirePermissions } from '../../middlewares/authorize';
import { validateBody } from '../../middlewares/validate';
import { sendMediaSchema, sendTextSchema } from './messages.validation';
import { sendMediaController, sendTextController } from './messages.controller';

export const messagesRouter = Router();

messagesRouter.use(authenticate, tenantContext);

messagesRouter.post(
  '/text',
  requirePermissions('conversations.write'),
  validateBody(sendTextSchema),
  sendTextController,
);

messagesRouter.post(
  '/media',
  requirePermissions('conversations.write'),
  validateBody(sendMediaSchema),
  sendMediaController,
);
