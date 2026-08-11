import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { tenantContext } from '../../middlewares/tenantContext';
import { requireRoles } from '../../middlewares/authorize';
import { asyncHandler } from '../../lib/http';
import { ROLE_KEYS } from '../auth/rbac';
import { patchAHealthController } from './admin.controller';

export const adminRouter = Router();

// Verificação do Patch A — protegida (autenticado + tenant + papel admin).
adminRouter.get(
  '/health/patch-a',
  authenticate,
  tenantContext,
  requireRoles(ROLE_KEYS.ADMIN),
  asyncHandler(patchAHealthController),
);
