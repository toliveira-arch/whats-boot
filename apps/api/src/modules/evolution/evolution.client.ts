import { logger } from '../../lib/logger';

/**
 * Cliente HTTP da Evolution API v2 (documentação oficial).
 * Endpoints usados: instance/create, instance/connect, connectionState,
 * restart, logout, delete, webhook/set, message/sendText, message/sendMedia,
 * chat/markMessageAsRead, chat/sendPresence.
 */
export class EvolutionError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'EvolutionError';
  }
}

export type EvolutionWebhookConfig = {
  enabled: boolean;
  url: string;
  webhookByEvents?: boolean;
  webhookBase64?: boolean;
  events: string[];
};

export type SendTextBody = {
  number: string;
  text: string;
  delay?: number;
  linkPreview?: boolean;
  quoted?: unknown;
};

export type SendMediaBody = {
  number: string;
  mediatype: 'image' | 'video' | 'audio' | 'document';
  media: string; // URL ou base64
  mimetype?: string;
  fileName?: string;
  caption?: string;
  delay?: number;
};

async function request<T = unknown>(
  method: string,
  baseUrl: string,
  path: string,
  apikey: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', apikey },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    // resposta não-JSON
  }

  if (!res.ok) {
    const message =
      (typeof data === 'object' && data && 'message' in data
        ? String((data as Record<string, unknown>).message)
        : undefined) ?? `Evolution API ${res.status}`;
    logger.warn({ status: res.status, path, message }, 'erro Evolution API');
    throw new EvolutionError(res.status, message, data);
  }

  return data as T;
}

/** Cria um client vinculado a um servidor Evolution (baseUrl) e uma apikey. */
export function createEvolutionClient(baseUrl: string, apikey: string) {
  return {
    fetchInstances: () => request('GET', baseUrl, '/instance/fetchInstances', apikey),
    createInstance: (body: Record<string, unknown>) =>
      request('POST', baseUrl, '/instance/create', apikey, body),
    connect: (instance: string) =>
      request<{ code?: string; base64?: string; pairingCode?: string }>(
        'GET',
        baseUrl,
        `/instance/connect/${instance}`,
        apikey,
      ),
    connectionState: (instance: string) =>
      request<{ instance?: { state?: string } }>(
        'GET',
        baseUrl,
        `/instance/connectionState/${instance}`,
        apikey,
      ),
    restart: (instance: string) =>
      request('POST', baseUrl, `/instance/restart/${instance}`, apikey),
    logout: (instance: string) =>
      request('DELETE', baseUrl, `/instance/logout/${instance}`, apikey),
    deleteInstance: (instance: string) =>
      request('DELETE', baseUrl, `/instance/delete/${instance}`, apikey),
    setWebhook: (instance: string, webhook: EvolutionWebhookConfig) =>
      request('POST', baseUrl, `/webhook/set/${instance}`, apikey, { webhook }),
    findWebhook: (instance: string) =>
      request<Record<string, unknown>>('GET', baseUrl, `/webhook/find/${instance}`, apikey),
    sendText: (instance: string, body: SendTextBody) =>
      request<Record<string, unknown>>(
        'POST',
        baseUrl,
        `/message/sendText/${instance}`,
        apikey,
        body,
      ),
    sendMedia: (instance: string, body: SendMediaBody) =>
      request<Record<string, unknown>>(
        'POST',
        baseUrl,
        `/message/sendMedia/${instance}`,
        apikey,
        body,
      ),
    markAsRead: (instance: string, readMessages: unknown[]) =>
      request('POST', baseUrl, `/chat/markMessageAsRead/${instance}`, apikey, { readMessages }),
    sendPresence: (instance: string, body: { number: string; presence: string; delay?: number }) =>
      request('POST', baseUrl, `/chat/sendPresence/${instance}`, apikey, body),
    deleteForEveryone: (
      instance: string,
      key: { id: string; remoteJid: string; fromMe: boolean; participant?: string },
    ) => request('DELETE', baseUrl, `/chat/deleteMessageForEveryone/${instance}`, apikey, key),
    sendReaction: (
      instance: string,
      body: { key: { id: string; remoteJid: string; fromMe: boolean }; reaction: string },
    ) => request('POST', baseUrl, `/message/sendReaction/${instance}`, apikey, body),
  };
}

export type EvolutionClient = ReturnType<typeof createEvolutionClient>;

/** Eventos assinados no webhook (nomes aceitos pela Evolution v2). */
export const WEBHOOK_EVENTS = [
  'QRCODE_UPDATED',
  'CONNECTION_UPDATE',
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'SEND_MESSAGE',
  'CONTACTS_UPSERT',
  'PRESENCE_UPDATE',
];
