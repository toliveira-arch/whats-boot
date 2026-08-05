import { z } from 'zod';

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, 'Informe um título').max(200),
  notes: z.string().max(4000).optional(),
  dueAt: z.coerce.date(),
  companyId: z.string().trim().min(1).optional().nullable(),
  conversationId: z.string().trim().min(1).optional().nullable(),
  assignedToId: z.string().trim().min(1).optional().nullable(),
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  notes: z.string().max(4000).nullable().optional(),
  dueAt: z.coerce.date().optional(),
  status: z.enum(['PENDING', 'DONE', 'CANCELED']).optional(),
  companyId: z.string().trim().min(1).nullable().optional(),
  conversationId: z.string().trim().min(1).nullable().optional(),
  assignedToId: z.string().trim().min(1).nullable().optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
