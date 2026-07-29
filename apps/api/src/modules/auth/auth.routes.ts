import { Router } from 'express';
import { validateBody } from '../../middlewares/validate';
import { authenticate } from '../../middlewares/authenticate';
import { requireRoles } from '../../middlewares/authorize';
import { authRateLimit } from '../../middlewares/authRateLimit';
import { ROLE_KEYS } from './rbac';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from './auth.validation';
import {
  forgotPasswordController,
  loginController,
  logoutController,
  meController,
  refreshController,
  registerController,
  resetPasswordController,
} from './auth.controller';

export const authRouter = Router();

// --- Públicas (com rate limit estrito) ---
authRouter.post('/register', authRateLimit, validateBody(registerSchema), registerController);
authRouter.post('/login', authRateLimit, validateBody(loginSchema), loginController);
authRouter.post('/refresh', refreshController);
authRouter.post('/logout', logoutController);
authRouter.post(
  '/forgot-password',
  authRateLimit,
  validateBody(forgotPasswordSchema),
  forgotPasswordController,
);
authRouter.post(
  '/reset-password',
  authRateLimit,
  validateBody(resetPasswordSchema),
  resetPasswordController,
);

// --- Protegidas ---
authRouter.get('/me', authenticate, meController);

// Exemplo de rota protegida por papel (demonstra o guard de RBAC).
authRouter.get('/admin/ping', authenticate, requireRoles(ROLE_KEYS.ADMIN), (_req, res) => {
  res.json({ ok: true, scope: 'admin-only' });
});
