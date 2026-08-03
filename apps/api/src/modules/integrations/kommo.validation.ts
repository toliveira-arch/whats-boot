import { z } from 'zod';

export const kommoConfigSchema = z.object({
  enabled: z.boolean().optional(),
  channelId: z.string().nullable().optional(),
  openingMessage: z.string().min(1).max(2000).optional(),
  handoffToSdr: z.boolean().optional(),
  subdomain: z.string().max(200).nullable().optional(),
  accessToken: z.string().max(4000).nullable().optional(),
});
