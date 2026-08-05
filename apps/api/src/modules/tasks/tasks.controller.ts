import { asyncHandler } from '../../lib/http';
import { HttpError } from '../../middlewares/error';
import * as tasks from './tasks.service';
import type { CreateTaskInput, UpdateTaskInput } from './tasks.validation';

function strParam(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

export const listTasksController = asyncHandler(async (req, res) => {
  res.json(
    await tasks.listTasks({
      companyId: strParam(req.query.companyId) ?? null,
      assignedToId: strParam(req.query.assignedToId) ?? null,
      status: strParam(req.query.status) ?? null,
      q: strParam(req.query.q),
    }),
  );
});

export const listAssigneesController = asyncHandler(async (_req, res) => {
  res.json(await tasks.listAssignees());
});

export const createTaskController = asyncHandler(async (req, res) => {
  const membershipId = req.auth?.membershipId;
  if (!membershipId) throw new HttpError(401, 'Não autenticado');
  res.status(201).json(await tasks.createTask(req.body as CreateTaskInput, membershipId));
});

export const updateTaskController = asyncHandler(async (req, res) => {
  res.json(await tasks.updateTask(req.params.id!, req.body as UpdateTaskInput));
});

export const deleteTaskController = asyncHandler(async (req, res) => {
  res.json(await tasks.deleteTask(req.params.id!));
});
