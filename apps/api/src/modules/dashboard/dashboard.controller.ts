import type { NextFunction, Request, Response } from 'express';
import { getMetrics } from './dashboard.service';

export function metricsController(req: Request, res: Response, next: NextFunction): void {
  const raw = Number(req.query.days);
  const days = Number.isFinite(raw) && raw > 0 ? raw : 7;
  getMetrics(days)
    .then((metrics) => res.json(metrics))
    .catch(next);
}
