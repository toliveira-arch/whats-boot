import type { NextFunction, Request, Response } from 'express';
import { env, isProduction } from '../../config/env';
import { parseDurationToSeconds, type RefreshMeta } from './tokens';
import * as authService from './auth.service';

const REFRESH_COOKIE = 'wb_refresh';

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: parseDurationToSeconds(env.JWT_REFRESH_TTL) * 1000,
  };
}

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, refreshCookieOptions());
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: undefined });
}

function metaFrom(req: Request): RefreshMeta {
  return { userAgent: req.headers['user-agent'], ip: req.ip };
}

/** Envolve handlers async encaminhando erros ao errorHandler. */
function handler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };
}

export const registerController = handler(async (req, res) => {
  const result = await authService.register(req.body, metaFrom(req));
  setRefreshCookie(res, result.refreshToken);
  res.status(201).json({ accessToken: result.accessToken, user: result.user });
});

export const loginController = handler(async (req, res) => {
  const result = await authService.login(req.body, metaFrom(req));
  setRefreshCookie(res, result.refreshToken);
  res.json({ accessToken: result.accessToken, user: result.user });
});

export const refreshController = handler(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (!token) {
    res.status(401).json({ error: 'unauthorized', message: 'Refresh token ausente' });
    return;
  }
  try {
    const result = await authService.refresh(token, metaFrom(req));
    setRefreshCookie(res, result.refreshToken);
    res.json({ accessToken: result.accessToken });
  } catch {
    clearRefreshCookie(res);
    res
      .status(401)
      .json({ error: 'unauthorized', message: 'Sessão inválida, faça login novamente' });
  }
});

export const logoutController = handler(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  await authService.logout(token);
  clearRefreshCookie(res);
  res.json({ ok: true });
});

export const meController = handler(async (req, res) => {
  const profile = await authService.getProfile(req.auth!.userId);
  res.json(profile);
});

export const forgotPasswordController = handler(async (req, res) => {
  const result = await authService.forgotPassword(req.body);
  res.json({
    message: 'Se o e-mail existir, enviaremos as instruções de recuperação.',
    ...result,
  });
});

export const resetPasswordController = handler(async (req, res) => {
  await authService.resetPassword(req.body);
  res.json({ message: 'Senha redefinida com sucesso' });
});
