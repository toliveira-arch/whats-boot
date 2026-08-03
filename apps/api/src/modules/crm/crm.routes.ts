import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { tenantContext } from '../../middlewares/tenantContext';
import { requirePermissions } from '../../middlewares/authorize';
import {
  exportController,
  listLeadsController,
  setStageController,
  stagesController,
  testLeadController,
} from './crm.controller';

export const crmRouter = Router();
crmRouter.use(authenticate, tenantContext);

const READ = requirePermissions('conversations.read');
const WRITE = requirePermissions('conversations.write');

crmRouter.get('/stages', READ, stagesController);
crmRouter.get('/leads', READ, listLeadsController);
crmRouter.get('/export', READ, exportController);
crmRouter.post('/test-lead', WRITE, testLeadController);
crmRouter.patch('/leads/:id/stage', WRITE, setStageController);
