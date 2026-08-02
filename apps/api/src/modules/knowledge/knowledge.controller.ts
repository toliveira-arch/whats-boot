import { asyncHandler } from '../../lib/http';
import * as svc from './knowledge.service';

function companyIdOf(req: { query: Record<string, unknown> }): string | null {
  const v = req.query.companyId;
  return typeof v === 'string' && v.trim() ? v : null;
}

export const getKnowledgeController = asyncHandler(async (req, res) => {
  res.json(await svc.getKnowledge(companyIdOf(req)));
});

export const upsertKnowledgeController = asyncHandler(async (req, res) => {
  res.json(await svc.upsertKnowledge(companyIdOf(req), req.body));
});
