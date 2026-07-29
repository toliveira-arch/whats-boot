import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { corsOrigins } from './config/env';
import { logger } from './lib/logger';
import { globalRateLimit } from './middlewares/rateLimit';
import { errorHandler, notFoundHandler } from './middlewares/error';
import { healthRouter } from './routes/health';
import { authRouter } from './modules/auth/auth.routes';
import { dashboardRouter } from './modules/dashboard/dashboard.routes';
import { channelsRouter } from './modules/evolution/channels.routes';
import { messagesRouter } from './modules/evolution/messages.routes';
import { webhookRouter } from './modules/evolution/webhook.routes';

/** Monta a aplicação Express (infraestrutura — sem rotas de negócio). */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Observabilidade
  app.use(pinoHttp({ logger }));

  // Segurança e performance
  app.use(helmet());
  app.use(cors({ origin: corsOrigins, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Rate limit global
  app.use(globalRateLimit);

  // Health checks (liveness / readiness)
  app.use(healthRouter);

  // Módulos
  app.use('/auth', authRouter);
  app.use('/dashboard', dashboardRouter);
  app.use('/channels', channelsRouter);
  app.use('/messages', messagesRouter);
  app.use('/webhooks', webhookRouter);

  app.get('/', (_req, res) => {
    res.json({ name: 'whats-boot-api', status: 'ok' });
  });

  // 404 + tratador de erros (sempre por último)
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
