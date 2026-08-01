import { asyncHandler } from '../../lib/http';
import * as svc from './followup.service';

function companyIdOf(req: { query: Record<string, unknown> }): string | null {
  const v = req.query.companyId;
  return typeof v === 'string' && v.trim() ? v : null;
}

export const getSequenceController = asyncHandler(async (req, res) => {
  res.json(await svc.getSequence(companyIdOf(req)));
});

export const upsertSequenceController = asyncHandler(async (req, res) => {
  res.json(await svc.upsertSequence(companyIdOf(req), req.body));
});
