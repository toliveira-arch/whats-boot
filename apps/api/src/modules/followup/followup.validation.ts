import { z } from 'zod';

const step = z.object({
  afterHours: z.number().min(0).max(8760),
  text: z.string().max(2000),
  active: z.boolean(),
});

export const sequenceSchema = z.object({
  enabled: z.boolean().optional(),
  steps: z.array(step).max(8).optional(),
});
