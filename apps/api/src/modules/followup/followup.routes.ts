import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { tenantContext } from '../../middlewares/tenantContext';
import { requirePermissions } from '../../middlewares/authorize';
import { validateBody } from '../../middlewares/validate';
import { sequenceSchema } from './followup.validation';
import { getSequenceController, upsertSequenceController } from './followup.controller';

export const followupRouter = Router();
followupRouter.use(authenticate, tenantContext);

const READ = requirePermissions('conversations.read');
const MANAGE = requirePermissions('conversations.write');

followupRouter.get('/sequence', READ, getSequenceController);
followupRouter.put('/sequence', MANAGE, validateBody(sequenceSchema), upsertSequenceController);
