import fs from 'node:fs';
import path from 'node:path';
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
import { companiesRouter } from './modules/companies/companies.routes';
import { messagesRouter } from './modules/evolution/messages.routes';
import { webhookRouter } from './modules/evolution/webhook.routes';
import { conversationsRouter, tagsRouter } from './modules/conversations/conversations.routes';
import { aiRouter } from './modules/ai/ai.routes';
import { integrationsRouter, rdWebhookRouter } from './modules/integrations/rd.routes';
import { warmupRouter } from './modules/warmup/warmup.routes';
import { followupRouter } from './modules/followup/followup.routes';
import { knowledgeRouter } from './modules/knowledge/knowledge.routes';
import { crmRouter } from './modules/crm/crm.routes';
import { adminRouter } from './modules/admin/admin.routes';

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
  // Guarda o corpo CRU: a validação da assinatura do webhook da Meta
  // (X-Hub-Signature-256) é HMAC sobre os bytes exatos recebidos — reserializar
  // o JSON muda o hash e invalida toda requisição legítima.
  app.use(
    express.json({
      limit: '10mb',
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Rate limit global
  app.use(globalRateLimit);

  // Health checks (liveness / readiness)
  app.use(healthRouter);

  // Módulos — TODOS sob /api para não colidir com as rotas do site (SPA).
  app.use('/api/auth', authRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/companies', companiesRouter);
  app.use('/api/channels', channelsRouter);
  app.use('/api/messages', messagesRouter);
  app.use('/api/webhooks', webhookRouter);
  app.use('/api/conversations', conversationsRouter);
  app.use('/api/tags', tagsRouter);
  app.use('/api/ai', aiRouter);
  // Webhook público do RD Station ANTES do router autenticado (mesmo base path).
  app.use('/api/integrations', rdWebhookRouter);
  app.use('/api/integrations', integrationsRouter);
  app.use('/api/warmup', warmupRouter);
  app.use('/api/followup', followupRouter);
  app.use('/api/knowledge', knowledgeRouter);
  app.use('/api/crm', crmRouter);
  app.use('/api/admin', adminRouter);

  // Servir o site compilado (deploy single-service). Em dev, a pasta não existe
  // e o Vite serve a web separadamente.
  const webDist = process.env.WEB_DIST_PATH ?? path.resolve(process.cwd(), 'apps/web/dist');
  const indexHtml = path.join(webDist, 'index.html');

  if (fs.existsSync(indexHtml)) {
    app.use(express.static(webDist));
    // SPA fallback: rotas do navegador → index.html; deixa /api, /socket.io e
    // /health seguirem para os handlers/404 corretos.
    app.get('*', (req, res, next) => {
      if (/^\/(api|socket\.io|health)(\/|$)/.test(req.path)) return next();
      res.sendFile(indexHtml);
    });
  } else {
    app.get('/', (_req, res) => {
      res.json({ name: 'whats-boot-api', status: 'ok' });
    });
  }

  // 404 + tratador de erros (sempre por último)
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
