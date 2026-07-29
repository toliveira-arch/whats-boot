import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { tenantContext } from '../../middlewares/tenantContext';
import { requirePermissions } from '../../middlewares/authorize';
import { metricsController } from './dashboard.controller';

export const dashboardRouter = Router();

// Protegida: autenticado + contexto de tenant + permissão de leitura.
dashboardRouter.get(
  '/metrics',
  authenticate,
  tenantContext,
  requirePermissions('conversations.read'),
  metricsController,
);
