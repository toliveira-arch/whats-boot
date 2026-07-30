import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';

export const healthRouter = Router();

/** Liveness — o processo está vivo? (não checa dependências) */
healthRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), ts: Date.now() });
});

healthRouter.get('/health/live', (_req, res) => {
  res.json({ status: 'alive' });
});

/** Readiness — as dependências (Postgres e Redis) estão prontas? */
healthRouter.get('/health/ready', async (_req, res) => {
  const checks: Record<string, 'ok' | 'error' | 'disabled'> = {};

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
  }

  if (!redis) {
    checks.redis = 'disabled'; // modo inline (sem Redis) — não afeta readiness
  } else {
    try {
      const pong = await redis.ping();
      checks.redis = pong === 'PONG' ? 'ok' : 'error';
    } catch {
      checks.redis = 'error';
    }
  }

  const ready = Object.values(checks).every((v) => v === 'ok' || v === 'disabled');
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', checks });
});
