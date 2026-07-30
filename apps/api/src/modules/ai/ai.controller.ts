import { asyncHandler } from '../../lib/http';
import * as ai from './ai.service';

export const getAgentController = asyncHandler(async (_req, res) => {
  res.json(await ai.getAgent());
});

export const upsertAgentController = asyncHandler(async (req, res) => {
  res.json(await ai.upsertAgent(req.body));
});

export const listCredentialsController = asyncHandler(async (_req, res) => {
  res.json(await ai.listCredentials());
});

export const setCredentialController = asyncHandler(async (req, res) => {
  res.json(await ai.setCredential(req.body.provider, req.body.apiKey, req.body.baseUrl));
});

export const testController = asyncHandler(async (req, res) => {
  res.json(await ai.testGenerate({ userMessage: req.body.userMessage }));
});
