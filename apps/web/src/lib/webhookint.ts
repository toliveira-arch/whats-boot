import { authFetch } from './api';

export interface WebhookIntegration {
  id: string;
  label: string;
  enabled: boolean;
  channelId: string | null;
  openingMessage: string;
  handoffToSdr: boolean;
  sourceFilter: string;
  apiBaseUrl: string;
  apiUserUuid: string;
  hasToken: boolean;
  cardIdField: string;
  qualifiedRespUuid: string;
  qualifiedTemp: string;
  webhookUrl: string;
}

export interface WebhookEvent {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  detail: string | null;
  createdAt: string;
}

export interface WebhookConfigInput {
  enabled?: boolean;
  channelId?: string | null;
  openingMessage?: string;
  handoffToSdr?: boolean;
  sourceFilter?: string | null;
  label?: string;
  apiBaseUrl?: string | null;
  apiUserUuid?: string | null;
  apiToken?: string | null;
  cardIdField?: string | null;
  qualifiedRespUuid?: string | null;
  qualifiedTemp?: string | null;
}

function companyQuery(companyId?: string | null): string {
  return companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
}

export function getWebhook(companyId?: string | null): Promise<WebhookIntegration> {
  return authFetch(`/integrations/webhook${companyQuery(companyId)}`);
}

export function saveWebhook(
  input: WebhookConfigInput,
  companyId?: string | null,
): Promise<WebhookIntegration> {
  return authFetch(`/integrations/webhook${companyQuery(companyId)}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function regenerateWebhook(companyId?: string | null): Promise<WebhookIntegration> {
  return authFetch(`/integrations/webhook/regenerate${companyQuery(companyId)}`, {
    method: 'POST',
  });
}

export function webhookEvents(companyId?: string | null): Promise<WebhookEvent[]> {
  return authFetch(`/integrations/webhook/events${companyQuery(companyId)}`);
}
