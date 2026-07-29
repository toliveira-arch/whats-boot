import type { NextFunction, Request, Response } from 'express';
import { getMetrics } from './dashboard.service';

export function metricsController(_req: Request, res: Response, next: NextFunction): void {
  getMetrics()
    .then((metrics) => res.json(metrics))
    .catch(next);
}
