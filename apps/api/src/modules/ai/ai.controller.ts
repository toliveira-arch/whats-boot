import { asyncHandler } from '../../lib/http';
import * as ai from './ai.service';

/** Lê ?companyId=... da query (empresa selecionada no painel). */
function companyIdOf(req: { query: Record<string, unknown> }): string | null {
  const v = req.query.companyId;
  return typeof v === 'string' && v.trim() ? v : null;
}

export const getAgentController = asyncHandler(async (req, res) => {
  res.json(await ai.getAgent(companyIdOf(req)));
});

export const upsertAgentController = asyncHandler(async (req, res) => {
  res.json(await ai.upsertAgent(companyIdOf(req), req.body));
});

export const listCredentialsController = asyncHandler(async (_req, res) => {
  res.json(await ai.listCredentials());
});

export const setCredentialController = asyncHandler(async (req, res) => {
  res.json(await ai.setCredential(req.body.provider, req.body.apiKey, req.body.baseUrl));
});

export const testController = asyncHandler(async (req, res) => {
  res.json(
    await ai.testGenerate({ userMessage: req.body.userMessage, companyId: companyIdOf(req) }),
  );
});

export const testCloserController = asyncHandler(async (req, res) => {
  res.json(await ai.testCloser(companyIdOf(req)));
});
