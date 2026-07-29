import pino from 'pino';
import { env, isProduction } from '../config/env';

export const logger = pino({
  level: isProduction ? 'info' : 'debug',
  base: undefined,
  transport: isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss' },
      },
});

logger.debug({ env: env.NODE_ENV }, 'logger inicializado');
