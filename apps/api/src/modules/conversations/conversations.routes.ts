import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { tenantContext } from '../../middlewares/tenantContext';
import { requirePermissions } from '../../middlewares/authorize';
import { validateBody } from '../../middlewares/validate';
import {
  addNoteSchema,
  addTagSchema,
  createTagSchema,
  sendMessageSchema,
  updateConversationSchema,
} from './conversations.validation';
import {
  addNoteController,
  addTagController,
  createTagController,
  getConversationController,
  listConversationsController,
  listMessagesController,
  listNotesController,
  listTagsController,
  markReadController,
  removeTagController,
  sendMessageController,
  updateConversationController,
} from './conversations.controller';

const READ = requirePermissions('conversations.read');
const WRITE = requirePermissions('conversations.write');

// --- Etiquetas (tags) ---
export const tagsRouter = Router();
tagsRouter.use(authenticate, tenantContext);
tagsRouter.get('/', READ, listTagsController);
tagsRouter.post('/', WRITE, validateBody(createTagSchema), createTagController);

// --- Conversas ---
export const conversationsRouter = Router();
conversationsRouter.use(authenticate, tenantContext);

conversationsRouter.get('/', READ, listConversationsController);
conversationsRouter.get('/:id', READ, getConversationController);
conversationsRouter.get('/:id/messages', READ, listMessagesController);
conversationsRouter.post(
  '/:id/messages',
  WRITE,
  validateBody(sendMessageSchema),
  sendMessageController,
);
conversationsRouter.post('/:id/read', WRITE, markReadController);
conversationsRouter.patch(
  '/:id',
  WRITE,
  validateBody(updateConversationSchema),
  updateConversationController,
);

conversationsRouter.post('/:id/tags', WRITE, validateBody(addTagSchema), addTagController);
conversationsRouter.delete('/:id/tags/:tagId', WRITE, removeTagController);

conversationsRouter.get('/:id/notes', READ, listNotesController);
conversationsRouter.post('/:id/notes', WRITE, validateBody(addNoteSchema), addNoteController);
