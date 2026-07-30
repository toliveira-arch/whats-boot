import { z } from 'zod';

export const createChannelSchema = z.object({
  companyId: z.string().min(1),
  name: z.string().min(2).max(120),
  instanceName: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Use apenas letras, números, _ ou -'),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  phoneNumber: z.string().min(8).max(20).optional(),
});

export const testConnectionSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
});

export const setChannelAiSchema = z.object({
  enabled: z.boolean(),
});

export const setWebhookUrlSchema = z.object({
  publicUrl: z.string().url(),
});

export type CreateChannelInput = z.infer<typeof createChannelSchema>;
