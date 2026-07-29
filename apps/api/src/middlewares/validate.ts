import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';

/**
 * Middleware de validação. Valida `req.body` contra um schema zod e substitui
 * pelo dado já normalizado/tipado. Em erro, responde 422 com os detalhes.
 */
export function validateBody(schema: ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(422).json({
        error: 'validation_error',
        message: 'Dados inválidos',
        details: result.error.flatten().fieldErrors,
      });
      return;
    }
    req.body = result.data;
    next();
  };
}
