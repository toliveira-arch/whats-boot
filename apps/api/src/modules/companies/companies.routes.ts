import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { tenantContext } from '../../middlewares/tenantContext';
import { requirePermissions } from '../../middlewares/authorize';
import { listCompaniesController } from './companies.controller';

export const companiesRouter = Router();

companiesRouter.use(authenticate, tenantContext);

companiesRouter.get('/', requirePermissions('channels.read'), listCompaniesController);
