import { z } from 'zod';

export const rdConfigSchema = z.object({
  enabled: z.boolean().optional(),
  channelId: z.string().nullable().optional(),
  openingMessage: z.string().min(1).max(2000).optional(),
  handoffToSdr: z.boolean().optional(),
  paidMediaOnly: z.boolean().optional(),
  allowedSources: z.string().max(500).nullable().optional(),
  campaignMap: z.string().max(2000).nullable().optional(),
  openingsJson: z.string().max(8000).nullable().optional(),
});
