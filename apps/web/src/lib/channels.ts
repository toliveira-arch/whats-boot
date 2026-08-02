import { authFetch } from './api';

export type ChannelStatus =
  'CREATED' | 'QRCODE' | 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'FAILED';

export interface Channel {
  id: string;
  companyId: string;
  name: string;
  instanceName: string;
  baseUrl: string;
  phoneNumber: string | null;
  profileName: string | null;
  status: ChannelStatus;
  aiEnabled: boolean;
  createdAt: string;
  connectedAt: string | null;
}

export interface Company {
  id: string;
  name: string;
  legalName: string | null;
  document: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  createdAt: string;
}

export interface CreateChannelInput {
  companyId: string;
  name: string;
  instanceName: string;
  baseUrl: string;
  apiKey: string;
  phoneNumber?: string;
}

export interface QrResult {
  qrcode: string | null;
  pairingCode: string | null;
}

export function listCompanies(): Promise<Company[]> {
  return authFetch('/companies');
}

export function listChannels(): Promise<Channel[]> {
  return authFetch('/channels');
}

export function getAlertPhone(): Promise<{ phone: string }> {
  return authFetch('/channels/alerts');
}

export function setAlertPhone(phone: string): Promise<{ phone: string }> {
  return authFetch('/channels/alerts', { method: 'PUT', body: JSON.stringify({ phone }) });
}

export function testAlert(): Promise<{ ok: boolean; message: string }> {
  return authFetch('/channels/alerts/test', { method: 'POST' });
}

export function testConnection(baseUrl: string, apiKey: string): Promise<{ ok: boolean }> {
  return authFetch('/channels/test', {
    method: 'POST',
    body: JSON.stringify({ baseUrl, apiKey }),
  });
}

export function createChannel(
  input: CreateChannelInput,
): Promise<{ channel: Channel; qrcode: string | null; pairingCode: string | null }> {
  return authFetch('/channels', { method: 'POST', body: JSON.stringify(input) });
}

export function getQrCode(channelId: string): Promise<QrResult> {
  return authFetch(`/channels/${channelId}/qrcode`);
}

export function getState(
  channelId: string,
): Promise<{ status: ChannelStatus; raw: string | null }> {
  return authFetch(`/channels/${channelId}/state`);
}

export function reconnect(channelId: string): Promise<{ ok: boolean }> {
  return authFetch(`/channels/${channelId}/reconnect`, { method: 'POST' });
}

export function logout(channelId: string): Promise<{ ok: boolean }> {
  return authFetch(`/channels/${channelId}/logout`, { method: 'POST' });
}

export function setAiEnabled(
  channelId: string,
  enabled: boolean,
): Promise<{ id: string; aiEnabled: boolean }> {
  return authFetch(`/channels/${channelId}/ai`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
}

export function removeChannel(channelId: string): Promise<{ ok: boolean }> {
  return authFetch(`/channels/${channelId}`, { method: 'DELETE' });
}

export interface Diagnostics {
  instanceName: string;
  status: ChannelStatus;
  apiPublicUrl: string;
  expectedWebhookUrl: string;
  storedWebhookUrl: string | null;
  evolutionWebhook: unknown;
  evolutionError: string | null;
  webhookEventsReceived: number;
  recentEvents: { event: string; status: string; externalId: string | null; createdAt: string }[];
}

export function getDiagnostics(channelId: string): Promise<Diagnostics> {
  return authFetch(`/channels/${channelId}/diagnostics`);
}

export function setWebhookUrl(
  channelId: string,
  publicUrl: string,
): Promise<{ webhookUrl: string }> {
  return authFetch(`/channels/${channelId}/webhook`, {
    method: 'POST',
    body: JSON.stringify({ publicUrl }),
  });
}

export const STATUS_LABEL: Record<ChannelStatus, string> = {
  CREATED: 'Criada',
  QRCODE: 'Aguardando QR',
  CONNECTING: 'Conectando',
  CONNECTED: 'Conectada',
  DISCONNECTED: 'Desconectada',
  FAILED: 'Falha',
};
