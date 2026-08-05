import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { tenantContext } from '../../middlewares/tenantContext';
import { requirePermissions } from '../../middlewares/authorize';
import { validateBody } from '../../middlewares/validate';
import { createTaskSchema, updateTaskSchema } from './tasks.validation';
import {
  createTaskController,
  deleteTaskController,
  listAssigneesController,
  listTasksController,
  updateTaskController,
} from './tasks.controller';

export const tasksRouter = Router();
tasksRouter.use(authenticate, tenantContext);

const READ = requirePermissions('conversations.read');
const WRITE = requirePermissions('conversations.write');

tasksRouter.get('/', READ, listTasksController);
tasksRouter.get('/assignees', READ, listAssigneesController);
tasksRouter.post('/', WRITE, validateBody(createTaskSchema), createTaskController);
tasksRouter.patch('/:id', WRITE, validateBody(updateTaskSchema), updateTaskController);
tasksRouter.delete('/:id', WRITE, deleteTaskController);
