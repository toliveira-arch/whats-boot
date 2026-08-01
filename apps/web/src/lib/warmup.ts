import { authFetch } from './api';

export interface WarmupWindow {
  days: number[];
  start: string;
  end: string;
}

export interface WarmupConfig {
  windows: WarmupWindow[];
  minIntervalSec: number;
  maxIntervalSec: number;
  imagePct: number;
  deletePct: number;
  reactPct: number;
  rampUpDays: number;
  baseDailyMessages: number;
  maxDailyMessages: number;
  useAi: boolean;
  personaA?: string;
  personaB?: string;
  phrases?: string[];
  veteranIds?: string[];
  timezone?: string;
}

export interface WarmupChannel {
  id: string;
  name: string;
  connected: boolean;
  phoneNumber: string | null;
  veteran: boolean;
}

export interface WarmupSession {
  id: string;
  companyId: string;
  name: string;
  channelIds: string[];
  channels: WarmupChannel[];
  status: 'RUNNING' | 'PAUSED';
  config: WarmupConfig;
  lastBeatAt: string | null;
  beatsToday: number;
  createdAt: string;
}

export interface WarmupAsset {
  id: string;
  name: string | null;
  companyId: string | null;
  createdAt: string;
  dataUrl: string;
}

function q(companyId?: string | null): string {
  return companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
}

export function listSessions(companyId?: string | null): Promise<WarmupSession[]> {
  return authFetch(`/warmup/sessions${q(companyId)}`);
}

export function createSession(input: {
  companyId: string;
  name?: string;
  channelIds: string[];
  config?: Partial<WarmupConfig>;
}): Promise<WarmupSession> {
  return authFetch('/warmup/sessions', { method: 'POST', body: JSON.stringify(input) });
}

export function updateSession(
  id: string,
  patch: Partial<{
    name: string;
    channelIds: string[];
    config: Partial<WarmupConfig>;
  }>,
): Promise<WarmupSession> {
  return authFetch(`/warmup/sessions/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function setSessionStatus(id: string, status: 'RUNNING' | 'PAUSED'): Promise<WarmupSession> {
  return authFetch(`/warmup/sessions/${id}/status`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
}

export function runSessionNow(id: string): Promise<{ sent: boolean }> {
  return authFetch(`/warmup/sessions/${id}/run`, { method: 'POST' });
}

export function deleteSession(id: string): Promise<{ ok: boolean }> {
  return authFetch(`/warmup/sessions/${id}`, { method: 'DELETE' });
}

export function listAssets(companyId?: string | null): Promise<WarmupAsset[]> {
  return authFetch(`/warmup/assets${q(companyId)}`);
}

export function addAsset(input: {
  companyId?: string | null;
  name?: string;
  mimeType: string;
  dataBase64: string;
}): Promise<{ id: string }> {
  return authFetch('/warmup/assets', { method: 'POST', body: JSON.stringify(input) });
}

export function deleteAsset(id: string): Promise<{ ok: boolean }> {
  return authFetch(`/warmup/assets/${id}`, { method: 'DELETE' });
}
