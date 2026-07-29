import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../modules/auth/tokens';

/**
 * Autentica a requisição pelo header `Authorization: Bearer <accessToken>`.
 * Preenche `req.auth`. Responde 401 se ausente/ inválido.
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized', message: 'Token de acesso ausente' });
    return;
  }

  const token = header.slice('Bearer '.length).trim();
  try {
    const payload = verifyAccessToken(token);
    req.auth = {
      userId: payload.sub,
      tenantId: payload.tid,
      membershipId: payload.mid,
      role: payload.role,
      permissions: payload.perms ?? [],
    };
    next();
  } catch {
    res.status(401).json({ error: 'unauthorized', message: 'Token inválido ou expirado' });
  }
}
