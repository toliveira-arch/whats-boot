import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

/** Rate limit global (base de infraestrutura; limites por rota virão depois). */
export const globalRateLimit = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Muitas requisições, tente novamente em instantes.' },
});
