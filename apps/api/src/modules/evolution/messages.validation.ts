import { z } from 'zod';

export const sendTextSchema = z.object({
  channelId: z.string().min(1),
  number: z.string().min(5),
  text: z.string().min(1).max(4096),
});

export const sendMediaSchema = z.object({
  channelId: z.string().min(1),
  number: z.string().min(5),
  mediatype: z.enum(['image', 'video', 'audio', 'document']),
  media: z.string().min(1), // URL ou base64
  mimetype: z.string().optional(),
  fileName: z.string().optional(),
  caption: z.string().max(4096).optional(),
});
