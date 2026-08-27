import { fetchWithTimeout } from '../../../lib/fetch';
import { LlmError, type LlmProvider, type LlmRequest, type LlmResult } from './types';

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';
/** Teto de espera pela resposta do modelo (ver lib/fetch.ts). */
const TIMEOUT_MS = 60_000;

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: { message?: string };
}

/** Provedor Google Gemini (generateContent). */
export const geminiProvider: LlmProvider = {
  name: 'GOOGLE',
  async chat(req: LlmRequest, apiKey: string, baseUrl?: string): Promise<LlmResult> {
    const base = (baseUrl || DEFAULT_BASE).replace(/\/$/, '');

    // Gemini separa a instrução de sistema e usa papéis user/model.
    const system = req.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n');
    const contents = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    let res: Response;
    try {
      res = await fetchWithTimeout(
        `${base}/models/${req.model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
            contents,
            generationConfig: {
              temperature: req.temperature,
              maxOutputTokens: req.maxTokens,
              ...(req.json ? { responseMimeType: 'application/json' } : {}),
            },
          }),
        },
        TIMEOUT_MS,
        'Gemini',
      );
    } catch (err) {
      // Rede/DNS/TLS/timeout: erro claro e RÁPIDO (não deixa a conversa travada).
      throw new LlmError(504, err instanceof Error ? err.message : String(err));
    }

    const data = (await res.json().catch(() => ({}))) as GeminiResponse;
    if (!res.ok) {
      throw new LlmError(res.status, data.error?.message ?? `Gemini ${res.status}`);
    }

    const content = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';

    return {
      content,
      usage: {
        promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens: data.usageMetadata?.totalTokenCount ?? 0,
      },
    };
  },
};
