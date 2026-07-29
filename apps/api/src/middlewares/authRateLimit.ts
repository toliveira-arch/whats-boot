import rateLimit from 'express-rate-limit';

/**
 * Rate limit estrito para endpoints sensíveis (login, esqueci/reset de senha):
 * defesa contra força bruta. Mais restritivo que o limite global.
 */
export const authRateLimit = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'rate_limited',
    message: 'Muitas tentativas. Aguarde um minuto e tente novamente.',
  },
});
