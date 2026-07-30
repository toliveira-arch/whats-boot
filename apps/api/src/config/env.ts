import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Carrega o `.env` mais próximo, subindo do cwd até a raiz do monorepo.
 * Assim um único `.env` na raiz abastece a API mesmo quando executada de
 * `apps/api` (npm workspaces). Variáveis já presentes no ambiente (ex.: Docker)
 * têm prioridade — o dotenv não sobrescreve.
 */
(function loadEnvFile() {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dotenv.config();
})();

/**
 * Validação centralizada das variáveis de ambiente.
 * A aplicação NÃO sobe se o ambiente estiver inválido (fail-fast).
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  TZ: z.string().default('America/Sao_Paulo'),

  API_PORT: z.coerce.number().int().positive().default(3333),
  API_HOST: z.string().default('0.0.0.0'),
  // Inclui 5174/5175 porque o Vite pula de porta quando a 5173 está ocupada.
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173,http://localhost:5174,http://localhost:5175'),

  // URL pública da API alcançável pela Evolution API (para os webhooks).
  API_PUBLIC_URL: z.string().url().default('http://localhost:3333'),
  // Chave de criptografia das apikeys das instâncias (32+ chars). Se ausente,
  // é derivada do JWT_ACCESS_SECRET.
  EVOLUTION_ENC_KEY: z.string().optional(),

  DATABASE_URL: z.string().url(),
  // Redis é OPT-IN. Por padrão o sistema roda TUDO em processo (filas inline +
  // Socket.IO local) — ideal para dev e single-node. Só usa Redis/BullMQ quando
  // REDIS_ENABLED=true E REDIS_URL apontam para um Redis >= 5. Assim, ter um
  // REDIS_URL sobrando (ou um Redis local antigo) NÃO quebra nada.
  REDIS_URL: z.string().url().optional(),
  REDIS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

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
