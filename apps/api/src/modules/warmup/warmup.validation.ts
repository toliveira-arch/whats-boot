import { z } from 'zod';

const window = z.object({
  days: z.array(z.number().int().min(0).max(6)),
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm'),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm'),
});

const config = z
  .object({
    windows: z.array(window).optional(),
    minIntervalSec: z.number().int().min(5).max(3600).optional(),
    maxIntervalSec: z.number().int().min(5).max(7200).optional(),
    imagePct: z.number().min(0).max(100).optional(),
    deletePct: z.number().min(0).max(100).optional(),
    reactPct: z.number().min(0).max(100).optional(),
    rampUpDays: z.number().int().min(0).max(120).optional(),
    baseDailyMessages: z.number().int().min(0).max(1000).optional(),
    maxDailyMessages: z.number().int().min(1).max(2000).optional(),
    useAi: z.boolean().optional(),
    personaA: z.string().max(500).optional(),
    personaB: z.string().max(500).optional(),
    phrases: z.array(z.string().max(300)).max(200).optional(),
    veteranIds: z.array(z.string()).max(50).optional(),
    timezone: z.string().max(64).optional(),
  })
  .optional();

export const createSessionSchema = z.object({
  companyId: z.string().min(1),
  name: z.string().max(120).optional(),
  channelIds: z.array(z.string().min(1)).min(2, 'Selecione ao menos 2 canais'),
  config,
});

export const updateSessionSchema = z.object({
  name: z.string().max(120).optional(),
  companyId: z.string().min(1).optional(),
  channelIds: z.array(z.string().min(1)).min(2).optional(),
  status: z.enum(['RUNNING', 'PAUSED']).optional(),
  config,
});

export const statusSchema = z.object({ status: z.enum(['RUNNING', 'PAUSED']) });

export const assetSchema = z.object({
  companyId: z.string().nullable().optional(),
  name: z.string().max(200).optional(),
  mimeType: z.string().max(100).default('image/jpeg'),
  dataBase64: z.string().min(1),
});
