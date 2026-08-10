import { z } from 'zod';

export const webhookConfigSchema = z.object({
  enabled: z.boolean().optional(),
  channelId: z.string().nullable().optional(),
  openingMessage: z.string().min(1).max(2000).optional(),
  handoffToSdr: z.boolean().optional(),
  sourceFilter: z.string().max(200).nullable().optional(),
  label: z.string().max(80).optional(),
  apiBaseUrl: z.string().max(300).nullable().optional(),
  apiUserUuid: z.string().max(120).nullable().optional(),
  apiToken: z.string().max(4000).nullable().optional(),
  cardIdField: z.string().max(80).nullable().optional(),
  qualifiedRespUuid: z.string().max(120).nullable().optional(),
  qualifiedTemp: z.string().max(80).nullable().optional(),
});
