import { authFetch } from './api';

export interface RdIntegration {
  id: string;
  enabled: boolean;
  channelId: string | null;
  openingMessage: string;
  handoffToSdr: boolean;
  webhookUrl: string;
}

export interface RdEvent {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  detail: string | null;
  createdAt: string;
}

export type RdConfigInput = Partial<
  Pick<RdIntegration, 'enabled' | 'channelId' | 'openingMessage' | 'handoffToSdr'>
>;

export function getRd(): Promise<RdIntegration> {
  return authFetch('/integrations/rdstation');
}

export function saveRd(input: RdConfigInput): Promise<RdIntegration> {
  return authFetch('/integrations/rdstation', { method: 'PUT', body: JSON.stringify(input) });
}

export function regenerateRd(): Promise<RdIntegration> {
  return authFetch('/integrations/rdstation/regenerate', { method: 'POST' });
}

export function rdEvents(): Promise<RdEvent[]> {
  return authFetch('/integrations/rdstation/events');
}
