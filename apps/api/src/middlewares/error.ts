import type { NextFunction, Request, Response } from 'express';
import { logger } from '../lib/logger';
import { isProduction } from '../config/env';

/** Erro de aplicação com status HTTP. */
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'not_found', message: 'Recurso não encontrado' });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const statusCode = err instanceof HttpError ? err.statusCode : 500;
  const message = err instanceof Error ? err.message : 'Erro interno';

  if (statusCode >= 500) {
    logger.error({ err }, 'erro não tratado');
  }

  res.status(statusCode).json({
    error: statusCode >= 500 ? 'internal_error' : 'request_error',
    message: statusCode >= 500 && isProduction ? 'Erro interno' : message,
    details: err instanceof HttpError ? err.details : undefined,
  });
}
