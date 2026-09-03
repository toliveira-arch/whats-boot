/**
 * Cliente da WhatsApp Cloud API (Meta / Graph API).
 * Espelha a interface do `evolution.client` no que o `messaging.service` usa,
 * para que o dispatch por `integration` fique trivial.
 */
import { logger } from '../../lib/logger';
import { env } from '../../config/env';
import type { SendMediaBody, SendTextBody } from './evolution.client';

const GRAPH_BASE = 'https://graph.facebook.com';

export class CloudApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
    /** Código de erro da Meta (ex.: 131030, 190) — útil para diagnóstico. */
    public metaCode?: number,
  ) {
    super(message);
    this.name = 'CloudApiError';
  }
}

/** Resposta de envio da Cloud API. */
interface CloudSendResponse {
  messaging_product?: string;
  contacts?: { input?: string; wa_id?: string }[];
  messages?: { id?: string }[];
}

/**
 * A Cloud API quer o número só com dígitos e com código do país, sem "+",
 * sem JID e sem máscara.
 */
function toWaId(input: string): string {
  return (input.includes('@') ? (input.split('@')[0] ?? input) : input).replace(/\D/g, '');
}

export function createCloudApiClient(
  phoneNumberId: string,
  accessToken: string,
  apiVersion?: string,
) {
  const version = apiVersion || env.WHATSAPP_CLOUD_API_VERSION;
  const endpoint = `${GRAPH_BASE}/${version}/${phoneNumberId}/messages`;

  async function post(body: Record<string, unknown>): Promise<CloudSendResponse> {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
    });

    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    if (!res.ok) {
      const err = (parsed as { error?: { message?: string; code?: number } } | null)?.error;
      // Mensagem do erro da Meta é bem mais útil que o status HTTP sozinho:
      // 131030 = destinatário fora da lista de permitidos (app em dev),
      // 190 = token expirado/inválido.
      throw new CloudApiError(
        res.status,
        err?.message ?? `Cloud API respondeu ${res.status}`,
        parsed,
        err?.code,
      );
    }

    return (parsed ?? {}) as CloudSendResponse;
  }

  return {
    /** Texto livre — só permitido DENTRO da janela de 24h do cliente. */
    async sendText(body: SendTextBody): Promise<CloudSendResponse> {
      return post({
        to: toWaId(body.number),
        type: 'text',
        text: { preview_url: body.linkPreview ?? false, body: body.text },
      });
    },

    /**
     * Mídia por URL pública. A Cloud API também aceita `id` de mídia já
     * carregada; usamos link porque é o que o resto do sistema já produz.
     */
    async sendMedia(body: SendMediaBody): Promise<CloudSendResponse> {
      const kind = body.mediatype;
      const node: Record<string, unknown> = { link: body.media };
      if (body.caption && kind !== 'audio') node.caption = body.caption;
      if (body.fileName && kind === 'document') node.filename = body.fileName;

      return post({ to: toWaId(body.number), type: kind, [kind]: node });
    },

    /**
     * Template aprovado — o ÚNICO envio permitido fora da janela de 24h.
     * `components` segue o formato da Meta (parâmetros do corpo, botões etc.).
     */
    async sendTemplate(input: {
      number: string;
      name: string;
      languageCode?: string;
      components?: unknown[];
    }): Promise<CloudSendResponse> {
      return post({
        to: toWaId(input.number),
        type: 'template',
        template: {
          name: input.name,
          language: { code: input.languageCode ?? 'pt_BR' },
          ...(input.components?.length ? { components: input.components } : {}),
        },
      });
    },

    /** Marca como lida (tique azul) — opcional, mas melhora a experiência. */
    async markAsRead(messageId: string): Promise<void> {
      try {
        await post({ status: 'read', message_id: messageId });
      } catch (err) {
        // Nunca deve derrubar a ingestão da mensagem.
        logger.warn({ err, messageId }, 'Cloud API: falha ao marcar como lida');
      }
    },
  };
}

export type CloudApiClient = ReturnType<typeof createCloudApiClient>;
