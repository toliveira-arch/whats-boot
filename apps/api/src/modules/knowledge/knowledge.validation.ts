import { z } from 'zod';

const entry = z.object({
  q: z.string().max(500),
  a: z.string().max(4000),
});

export const knowledgeSchema = z.object({
  enabled: z.boolean().optional(),
  notes: z.string().max(8000).optional(),
  entries: z.array(entry).max(100).optional(),
});
