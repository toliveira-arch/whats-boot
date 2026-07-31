import { z } from 'zod';

export const rdConfigSchema = z.object({
  enabled: z.boolean().optional(),
  channelId: z.string().nullable().optional(),
  openingMessage: z.string().min(1).max(2000).optional(),
  handoffToSdr: z.boolean().optional(),
});
