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

/**
 * Canal WhatsApp Cloud API (Meta / WABA oficial).
 * Não tem QR nem instância: o vínculo é feito pelas credenciais da Meta.
 */
export const createCloudChannelSchema = z.object({
  companyId: z.string().min(1),
  name: z.string().min(2).max(120),
  // Identificação do número de telefone (WhatsApp Manager > Configuração da API).
  phoneNumberId: z.string().regex(/^\d+$/, 'Use apenas dígitos'),
  // Identificação da conta do WhatsApp Business (WABA ID).
  wabaId: z.string().regex(/^\d+$/, 'Use apenas dígitos'),
  // Token PERMANENTE de usuário do sistema (o temporário expira em 24h).
  accessToken: z.string().min(20),
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
export type CreateCloudChannelInput = z.infer<typeof createCloudChannelSchema>;
