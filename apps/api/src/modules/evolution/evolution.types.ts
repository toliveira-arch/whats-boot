/** Tipos e normalizadores dos payloads de webhook da Evolution API v2. */

export interface EvolutionWebhookPayload {
  event: string;
  instance?: string;
  data?: EvolutionData;
  sender?: string;
  server_url?: string;
  apikey?: string;
}

export interface EvolutionKey {
  remoteJid?: string;
  fromMe?: boolean;
  id?: string;
}

export interface EvolutionData {
  key?: EvolutionKey;
  keyId?: string;
  remoteJid?: string;
  pushName?: string;
  message?: Record<string, unknown>;
  messageType?: string;
  messageTimestamp?: number;
  status?: string;
  state?: string;
  qrcode?: { code?: string; base64?: string; pairingCode?: string };
  base64?: string;
  presences?: Record<string, { lastKnownPresence?: string }>;
  [key: string]: unknown;
}

/** Normaliza o nome do evento: "messages.upsert" -> "MESSAGES_UPSERT". */
export function normalizeEvent(event: string): string {
  return event.replace(/[.-]/g, '_').toUpperCase();
}

/** Extrai o texto de uma mensagem, seja qual for o tipo. */
export function extractText(message?: Record<string, unknown>): string | null {
  if (!message) return null;
  const m = message as Record<string, Record<string, unknown> | string | undefined>;
  if (typeof m.conversation === 'string') return m.conversation;
  const ext = m.extendedTextMessage as Record<string, unknown> | undefined;
  if (ext && typeof ext.text === 'string') return ext.text;
  for (const kind of ['imageMessage', 'videoMessage', 'documentMessage'] as const) {
    const node = m[kind] as Record<string, unknown> | undefined;
    if (node && typeof node.caption === 'string') return node.caption;
  }
  return null;
}

export type MessageTypeValue =
  | 'TEXT'
  | 'IMAGE'
  | 'AUDIO'
  | 'VIDEO'
  | 'DOCUMENT'
  | 'STICKER'
  | 'LOCATION'
  | 'CONTACTS'
  | 'UNKNOWN';

export function mapMessageType(messageType?: string): MessageTypeValue {
  switch (messageType) {
    case 'conversation':
    case 'extendedTextMessage':
      return 'TEXT';
    case 'imageMessage':
      return 'IMAGE';
    case 'videoMessage':
      return 'VIDEO';
    case 'audioMessage':
      return 'AUDIO';
    case 'documentMessage':
    case 'documentWithCaptionMessage':
      return 'DOCUMENT';
    case 'stickerMessage':
      return 'STICKER';
    case 'locationMessage':
      return 'LOCATION';
    case 'contactMessage':
    case 'contactsArrayMessage':
      return 'CONTACTS';
    default:
      return 'UNKNOWN';
  }
}

export type MessageStatusValue = 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

/** Mapeia o ACK da Evolution para o status interno. */
export function mapAckStatus(status?: string): MessageStatusValue | null {
  switch ((status ?? '').toUpperCase()) {
    case 'PENDING':
      return 'PENDING';
    case 'SERVER_ACK':
      return 'SENT';
    case 'DELIVERY_ACK':
      return 'DELIVERED';
    case 'READ':
    case 'PLAYED':
      return 'READ';
    case 'ERROR':
      return 'FAILED';
    default:
      return null;
  }
}

export type InstanceStatusValue = 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED';

export function mapConnectionState(state?: string): InstanceStatusValue {
  switch ((state ?? '').toLowerCase()) {
    case 'open':
      return 'CONNECTED';
    case 'connecting':
      return 'CONNECTING';
    default:
      return 'DISCONNECTED';
  }
}
