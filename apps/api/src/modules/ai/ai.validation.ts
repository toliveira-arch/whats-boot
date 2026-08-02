import { z } from 'zod';

const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm')
  .nullable()
  .optional();

const qualField = z.object({
  key: z.string().min(1).max(40),
  label: z.string().min(1).max(120),
  question: z.string().min(1).max(500),
  required: z.boolean(),
});

const qualCampaign = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  triggers: z.array(z.string()).default([]),
  description: z.string().max(500).optional(),
  revenueFloor: z.number().nonnegative().nullable().optional(),
  requireDecisionMaker: z.boolean().optional(),
  requireCnpj: z.boolean().optional(),
  acceptedIndustries: z.array(z.string()).optional(),
  excludedIndustries: z.array(z.string()).optional(),
  script: z.array(qualField).optional(),
  disqualifyMessage: z.string().max(2000).optional(),
  handoffMessage: z.string().max(2000).optional(),
});

const qualification = z
  .object({
    enabled: z.boolean(),
    detection: z.enum(['ai+keywords', 'keywords']).default('ai+keywords'),
    onQualified: z.enum(['pause+assign', 'mark']).default('pause+assign'),
    defaultScript: z.array(qualField).default([]),
    defaultRevenueFloor: z.number().nonnegative().nullable().optional(),
    defaultRequireDecisionMaker: z.boolean().optional(),
    defaultRequireCnpj: z.boolean().optional(),
    defaultAcceptedIndustries: z.array(z.string()).optional(),
    defaultExcludedIndustries: z.array(z.string()).optional(),
    defaultDisqualifyMessage: z.string().max(2000).default(''),
    defaultHandoffMessage: z.string().max(2000).default(''),
    campaigns: z.array(qualCampaign).default([]),
    notifyCloser: z.boolean().optional(),
    closerTemplate: z.string().max(2000).optional(),
  })
  .optional();

export const agentSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  provider: z.enum(['OPENAI', 'GOOGLE']).optional(),
  model: z.string().min(1).max(80).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(32000).optional(),
  mode: z.enum(['OFF', 'COPILOT', 'AUTOPILOT']).optional(),
  systemPrompt: z.string().max(8000).optional(),
  forbiddenWords: z.array(z.string()).optional(),
  requiredWords: z.array(z.string()).optional(),
  activeFrom: time,
  activeTo: time,
  maxMessagesPerConversation: z.number().int().min(1).max(1000).nullable().optional(),
  minResponseSeconds: z.number().int().min(0).max(600).optional(),
  maxResponseSeconds: z.number().int().min(0).max(600).optional(),
  isActive: z.boolean().optional(),
  qualification,
});

export const credentialSchema = z.object({
  provider: z.enum(['OPENAI', 'GOOGLE']),
  apiKey: z.string().min(1),
  baseUrl: z.string().url().optional(),
});

export const testSchema = z.object({
  userMessage: z.string().min(1).max(2000),
});
