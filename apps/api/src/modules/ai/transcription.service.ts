import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { decryptSecret } from '../../lib/crypto';
import { createEvolutionClient } from '../evolution/evolution.client';

/** Transcreve áudio via OpenAI Whisper (multipart). */
async function transcribeOpenAI(
  base64: string,
  mimetype: string,
  apiKey: string,
  baseUrl?: string,
): Promise<string | null> {
  const buffer = Buffer.from(base64, 'base64');
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimetype || 'audio/ogg' }), 'audio.ogg');
  form.append('model', 'whisper-1');
  form.append('language', 'pt');
  const base = (baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const res = await fetch(`${base}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    logger.warn({ status: res.status }, 'transcrição OpenAI falhou');
    return null;
  }
  const data = (await res.json()) as { text?: string };
  return data.text?.trim() || null;
}

/** Transcreve áudio via Gemini (inline_data). */
async function transcribeGemini(
  base64: string,
  mimetype: string,
  apiKey: string,
): Promise<string | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { inline_data: { mime_type: mimetype || 'audio/ogg', data: base64 } },
            {
              text: 'Transcreva este áudio em português. Responda apenas o texto, sem comentários.',
            },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    logger.warn({ status: res.status }, 'transcrição Gemini falhou');
    return null;
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}

/** Escolhe o provedor disponível no tenant e transcreve o áudio. */
export async function transcribeAudio(base64: string, mimetype: string): Promise<string | null> {
  const openai = await prisma.aiCredential.findFirst({
    where: { provider: 'OPENAI', isActive: true, deletedAt: null },
  });
  if (openai) {
    const text = await transcribeOpenAI(
      base64,
      mimetype,
      decryptSecret(openai.apiKeyEncrypted),
      openai.baseUrl ?? undefined,
    ).catch((err) => {
      logger.warn({ err }, 'transcrição OpenAI erro');
      return null;
    });
    if (text) return text;
  }
  const google = await prisma.aiCredential.findFirst({
    where: { provider: 'GOOGLE', isActive: true, deletedAt: null },
  });
  if (google) {
    return transcribeGemini(base64, mimetype, decryptSecret(google.apiKeyEncrypted)).catch(
      (err) => {
        logger.warn({ err }, 'transcrição Gemini erro');
        return null;
      },
    );
  }
  return null;
}

interface TranscribeInboundParams {
  channel: { instanceName: string; baseUrl: string; apiKeyEncrypted: string };
  key: { id: string; remoteJid: string; fromMe: boolean };
  message: Record<string, unknown> | undefined;
}

/**
 * Obtém o áudio (do payload em base64, com fallback para a Evolution) e o
 * transcreve. Best-effort: retorna null se não conseguir.
 */
export async function transcribeInboundAudio(
  params: TranscribeInboundParams,
): Promise<string | null> {
  const { channel, key, message } = params;
  try {
    // 1) base64 já no payload (webhookBase64 ligado)?
    const msg = (message ?? {}) as Record<string, unknown>;
    const audioNode = (msg.audioMessage ?? {}) as Record<string, unknown>;
    let base64 =
      (typeof msg.base64 === 'string' && msg.base64) ||
      (typeof audioNode.base64 === 'string' && (audioNode.base64 as string)) ||
      '';
    let mimetype =
      (typeof audioNode.mimetype === 'string' && (audioNode.mimetype as string)) || 'audio/ogg';

    // 2) fallback: busca o binário na Evolution.
    if (!base64) {
      const client = createEvolutionClient(channel.baseUrl, decryptSecret(channel.apiKeyEncrypted));
      const media = await client.getBase64FromMediaMessage(channel.instanceName, key);
      base64 = media.base64 ?? '';
      mimetype = media.mimetype ?? mimetype;
    }
    if (!base64) return null;

    return await transcribeAudio(base64, mimetype);
  } catch (err) {
    logger.warn({ err }, 'falha ao transcrever áudio recebido');
    return null;
  }
}
