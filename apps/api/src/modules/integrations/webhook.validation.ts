import { z } from 'zod';

export const webhookConfigSchema = z.object({
  enabled: z.boolean().optional(),
  channelId: z.string().nullable().optional(),
  openingMessage: z.string().min(1).max(2000).optional(),
  handoffToSdr: z.boolean().optional(),
  sourceFilter: z.string().max(200).nullable().optional(),
  label: z.string().max(80).optional(),
});
