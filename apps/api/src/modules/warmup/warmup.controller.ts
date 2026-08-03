import { asyncHandler } from '../../lib/http';
import * as svc from './warmup.service';

function companyIdOf(req: { query: Record<string, unknown> }): string | null {
  const v = req.query.companyId;
  return typeof v === 'string' && v.trim() ? v : null;
}

export const listSessionsController = asyncHandler(async (req, res) => {
  res.json(await svc.listSessions(companyIdOf(req)));
});

export const createSessionController = asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createSession(req.body));
});

export const updateSessionController = asyncHandler(async (req, res) => {
  res.json(await svc.updateSession(req.params.id!, req.body));
});

export const setStatusController = asyncHandler(async (req, res) => {
  res.json(await svc.setStatus(req.params.id!, req.body.status));
});

export const deleteSessionController = asyncHandler(async (req, res) => {
  res.json(await svc.deleteSession(req.params.id!));
});

export const runNowController = asyncHandler(async (req, res) => {
  res.json(await svc.runNow(req.params.id!));
});

export const runTimedController = asyncHandler(async (req, res) => {
  const minutes = Number((req.body as { minutes?: unknown })?.minutes ?? 10);
  res.json(await svc.runTimed(req.params.id!, minutes));
});

export const listAssetsController = asyncHandler(async (req, res) => {
  res.json(await svc.listAssets(companyIdOf(req)));
});

export const addAssetController = asyncHandler(async (req, res) => {
  res.status(201).json(await svc.addAsset(req.body));
});

export const deleteAssetController = asyncHandler(async (req, res) => {
  res.json(await svc.deleteAsset(req.params.id!));
});
