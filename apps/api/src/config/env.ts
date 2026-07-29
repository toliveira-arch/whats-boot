import 'dotenv/config';
import { z } from 'zod';

/**
 * Validação centralizada das variáveis de ambiente.
 * A aplicação NÃO sobe se o ambiente estiver inválido (fail-fast).
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  TZ: z.string().default('America/Sao_Paulo'),

  API_PORT: z.coerce.number().int().positive().default(3333),
  API_HOST: z.string().default('0.0.0.0'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  // URL pública da API alcançável pela Evolution API (para os webhooks).
  API_PUBLIC_URL: z.string().url().default('http://localhost:3333'),
  // Chave de criptografia das apikeys das instâncias (32+ chars). Se ausente,
  // é derivada do JWT_ACCESS_SECRET.
  EVOLUTION_ENC_KEY: z.string().optional(),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: z.string().min(1).default('dev-access-secret'),
  JWT_REFRESH_SECRET: z.string().min(1).default('dev-refresh-secret'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Variáveis de ambiente inválidas:', parsed.error.flatten().fieldErrors);
  throw new Error('Ambiente inválido — verifique o .env');
}

export const env = parsed.data;

export const corsOrigins = env.CORS_ORIGINS.split(',')
  .map((o) => o.trim())
  .filter(Boolean);

export const isProduction = env.NODE_ENV === 'production';
