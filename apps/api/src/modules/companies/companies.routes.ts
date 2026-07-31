import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { tenantContext } from '../../middlewares/tenantContext';
import { requirePermissions } from '../../middlewares/authorize';
import { validateBody } from '../../middlewares/validate';
import { createCompanySchema, updateCompanySchema } from './companies.validation';
import {
  createCompanyController,
  deleteCompanyController,
  listCompaniesController,
  updateCompanyController,
} from './companies.controller';

export const companiesRouter = Router();

companiesRouter.use(authenticate, tenantContext);

const READ = requirePermissions('channels.read');
const MANAGE = requirePermissions('channels.manage');

companiesRouter.get('/', READ, listCompaniesController);
companiesRouter.post('/', MANAGE, validateBody(createCompanySchema), createCompanyController);
companiesRouter.patch('/:id', MANAGE, validateBody(updateCompanySchema), updateCompanyController);
companiesRouter.delete('/:id', MANAGE, deleteCompanyController);
