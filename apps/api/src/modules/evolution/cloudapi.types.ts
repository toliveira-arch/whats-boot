/**
 * Tipos e tradutor dos webhooks da WhatsApp Cloud API (Meta).
 *
 * ESTRATÉGIA: em vez de um pipeline de ingestão paralelo, traduzimos o payload
 * da Meta para o MESMO formato que a Evolution API entrega
 * (`EvolutionWebhookPayload`). Assim todo o `ingest.service` continua valendo
 * sem alteração — inclusive o casamento de contato por variantes do 9º dígito,
 * o disparo do robô de IA, a transcrição de áudio e o realtime.
 */
import type { EvolutionWebhookPayload } from './evolution.types';

// ---------------------------------------------------------------------------
// Formato bruto da Meta
// ---------------------------------------------------------------------------

export interface CloudApiPayload {
  object?: string;
  entry?: CloudApiEntry[];
}

export interface CloudApiEntry {
  id?: string; // WABA ID
  changes?: CloudApiChange[];
}

export interface CloudApiChange {
  field?: string; // "messages"
  value?: CloudApiValue;
}

export interface CloudApiValue {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: { profile?: { name?: string }; wa_id?: string }[];
  messages?: CloudApiMessage[];
  statuses?: CloudApiStatus[];
  errors?: { code?: number; title?: string; message?: string }[];
}

export interface CloudApiMessage {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: CloudApiMedia;
  video?: CloudApiMedia;
  audio?: CloudApiMedia;
  document?: CloudApiMedia;
  sticker?: CloudApiMedia;
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
  reaction?: { message_id?: string; emoji?: string };
  context?: { from?: string; id?: string };
}

export interface CloudApiMedia {
  id?: string;
  mime_type?: string;
  sha256?: string;
  caption?: string;
  filename?: string;
  voice?: boolean;
}

export interface CloudApiStatus {
  id?: string;
  status?: string; // sent | delivered | read | failed
  timestamp?: string;
  recipient_id?: string;
  errors?: { code?: number; title?: string; message?: string }[];
}

// ---------------------------------------------------------------------------
// Tradução Meta -> Evolution
// ---------------------------------------------------------------------------

/**
 * Converte o status da Meta para o ACK da Evolution, que o `mapAckStatus` já
 * sabe traduzir para o status interno (SENT/DELIVERED/READ/FAILED).
 */
function cloudStatusToAck(status: string | undefined): string | undefined {
  switch ((status ?? '').toLowerCase()) {
    case 'sent':
      return 'SERVER_ACK';
    case 'delivered':
      return 'DELIVERY_ACK';
    case 'read':
      return 'READ';
    case 'failed':
      return 'ERROR';
    default:
      return undefined;
  }
}

/**
 * Monta o nó `message` no formato do Baileys, que é o que `extractText` e
 * `mapMessageType` esperam. Devolve também o `messageType` correspondente.
 */
function buildMessageNode(msg: CloudApiMessage): {
  message: Record<string, unknown>;
  messageType: string;
} {
  const type = (msg.type ?? '').toLowerCase();

  switch (type) {
    case 'text':
      return {
        message: { conversation: msg.text?.body ?? '' },
        messageType: 'conversation',
      };

    case 'image':
      return {
        message: { imageMessage: { caption: msg.image?.caption ?? '', mediaId: msg.image?.id } },
        messageType: 'imageMessage',
      };

    case 'video':
      return {
        message: { videoMessage: { caption: msg.video?.caption ?? '', mediaId: msg.video?.id } },
        messageType: 'videoMessage',
      };

    case 'audio':
      return {
        message: { audioMessage: { mediaId: msg.audio?.id, ptt: msg.audio?.voice ?? false } },
        messageType: 'audioMessage',
      };

    case 'document':
      return {
        message: {
          documentMessage: {
            caption: msg.document?.caption ?? '',
            fileName: msg.document?.filename ?? '',
            mediaId: msg.document?.id,
          },
        },
        messageType: 'documentMessage',
      };

    case 'sticker':
      return {
        message: { stickerMessage: { mediaId: msg.sticker?.id } },
        messageType: 'stickerMessage',
      };

    case 'location':
      return {
        message: {
          locationMessage: {
            degreesLatitude: msg.location?.latitude,
            degreesLongitude: msg.location?.longitude,
            name: msg.location?.name,
            address: msg.location?.address,
          },
        },
        messageType: 'locationMessage',
      };

    // Botão e lista viram TEXTO com o rótulo escolhido: para o robô de IA e para
    // o atendente, o que importa é o que a pessoa respondeu, não o id interno.
    case 'button':
      return {
        message: { conversation: msg.button?.text ?? '' },
        messageType: 'conversation',
      };

    case 'interactive': {
      const label =
        msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? '';
      return { message: { conversation: label }, messageType: 'conversation' };
    }

    case 'reaction':
      return {
        message: {
          reactionMessage: { text: msg.reaction?.emoji, key: { id: msg.reaction?.message_id } },
        },
        messageType: 'reactionMessage',
      };

    default:
      return { message: {}, messageType: type || 'unknown' };
  }
}

/**
 * Traduz UM webhook da Cloud API em zero ou mais payloads no formato Evolution.
 * Um único POST da Meta pode trazer várias mensagens e vários status, e cada um
 * vira um evento independente (a Evolution também entrega assim).
 *
 * Devolve, junto de cada payload, o `phoneNumberId` — é por ele que o
 * controller descobre a qual canal o evento pertence, já que a Meta envia todos
 * os números do app para a MESMA URL.
 */
export function cloudToEvolutionPayloads(
  body: CloudApiPayload,
): { phoneNumberId: string; payload: EvolutionWebhookPayload }[] {
  const out: { phoneNumberId: string; payload: EvolutionWebhookPayload }[] = [];

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      // --- Mensagens recebidas -------------------------------------------
      for (const msg of value.messages ?? []) {
        if (!msg.from || !msg.id) continue;

        // A Meta entrega o wa_id só com dígitos; o resto do sistema fala JID.
        const remoteJid = `${msg.from}@s.whatsapp.net`;
        const pushName = value.contacts?.find((c) => c.wa_id === msg.from)?.profile?.name;
        const { message, messageType } = buildMessageNode(msg);

        out.push({
          phoneNumberId,
          payload: {
            event: 'messages.upsert',
            instance: phoneNumberId,
            data: {
              key: { remoteJid, fromMe: false, id: msg.id },
              pushName: pushName ?? undefined,
              message,
              messageType,
              messageTimestamp: msg.timestamp ? Number(msg.timestamp) : undefined,
            },
          },
        });
      }

      // --- Confirmações de entrega/leitura --------------------------------
      for (const st of value.statuses ?? []) {
        const ack = cloudStatusToAck(st.status);
        if (!ack || !st.id) continue;

        out.push({
          phoneNumberId,
          payload: {
            event: 'messages.update',
            instance: phoneNumberId,
            data: {
              keyId: st.id,
              key: {
                id: st.id,
                fromMe: true,
                remoteJid: st.recipient_id ? `${st.recipient_id}@s.whatsapp.net` : undefined,
              },
              status: ack,
            },
          },
        });
      }
    }
  }

  return out;
}
