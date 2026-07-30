import { z } from 'zod';

export const sendMessageSchema = z
  .object({
    text: z.string().min(1).max(4096).optional(),
    mediatype: z.enum(['image', 'video', 'audio', 'document']).optional(),
    media: z.string().min(1).optional(),
    mimetype: z.string().optional(),
    fileName: z.string().optional(),
    caption: z.string().max(4096).optional(),
  })
  .refine((v) => Boolean(v.text) || Boolean(v.media), {
    message: 'Informe texto ou mídia',
  });

export const updateConversationSchema = z.object({
  status: z.enum(['OPEN', 'PENDING', 'SNOOZED', 'RESOLVED', 'CLOSED']).optional(),
  isPinned: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  assignedToId: z.string().nullable().optional(),
});

export const createTagSchema = z.object({
  name: z.string().min(1).max(60),
  color: z.string().max(20).optional(),
});

export const addTagSchema = z.object({ tagId: z.string().min(1) });

export const addNoteSchema = z.object({ body: z.string().min(1).max(4000) });
