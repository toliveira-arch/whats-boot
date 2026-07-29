import type { NextFunction, Request, Response } from 'express';

/** Envolve um handler assíncrono, encaminhando erros ao errorHandler. */
export function asyncHandler(fn: (req: Request, res: Response) => Promise<void> | void) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}
