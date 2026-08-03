import { authFetch } from './api';

export interface KommoIntegration {
  id: string;
  enabled: boolean;
  channelId: string | null;
  openingMessage: string;
  handoffToSdr: boolean;
  subdomain: string;
  hasToken: boolean;
  sourceFilter: string;
  webhookUrl: string;
}

export interface KommoEvent {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  detail: string | null;
  createdAt: string;
}

export interface KommoConfigInput {
  enabled?: boolean;
  channelId?: string | null;
  openingMessage?: string;
  handoffToSdr?: boolean;
  subdomain?: string | null;
  accessToken?: string | null;
  sourceFilter?: string | null;
}

function companyQuery(companyId?: string | null): string {
  return companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
}

export function getKommo(companyId?: string | null): Promise<KommoIntegration> {
  return authFetch(`/integrations/kommo${companyQuery(companyId)}`);
}

export function saveKommo(
  input: KommoConfigInput,
  companyId?: string | null,
): Promise<KommoIntegration> {
  return authFetch(`/integrations/kommo${companyQuery(companyId)}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function regenerateKommo(companyId?: string | null): Promise<KommoIntegration> {
  return authFetch(`/integrations/kommo/regenerate${companyQuery(companyId)}`, {
    method: 'POST',
  });
}

export function kommoEvents(companyId?: string | null): Promise<KommoEvent[]> {
  return authFetch(`/integrations/kommo/events${companyQuery(companyId)}`);
}
