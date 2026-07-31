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

function companyQuery(companyId?: string | null): string {
  return companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
}

export function getRd(companyId?: string | null): Promise<RdIntegration> {
  return authFetch(`/integrations/rdstation${companyQuery(companyId)}`);
}

export function saveRd(input: RdConfigInput, companyId?: string | null): Promise<RdIntegration> {
  return authFetch(`/integrations/rdstation${companyQuery(companyId)}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function regenerateRd(companyId?: string | null): Promise<RdIntegration> {
  return authFetch(`/integrations/rdstation/regenerate${companyQuery(companyId)}`, {
    method: 'POST',
  });
}

export function rdEvents(companyId?: string | null): Promise<RdEvent[]> {
  return authFetch(`/integrations/rdstation/events${companyQuery(companyId)}`);
}
