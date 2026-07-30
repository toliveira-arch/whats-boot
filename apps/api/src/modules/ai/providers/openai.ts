import { LlmError, type LlmProvider, type LlmRequest, type LlmResult } from './types';

const DEFAULT_BASE = 'https://api.openai.com/v1';

interface OpenAiResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string };
}

/** Provedor OpenAI (Chat Completions). */
export const openAiProvider: LlmProvider = {
  name: 'OPENAI',
  async chat(req: LlmRequest, apiKey: string, baseUrl?: string): Promise<LlmResult> {
    const base = (baseUrl || DEFAULT_BASE).replace(/\/$/, '');
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: req.model,
        temperature: req.temperature,
        max_tokens: req.maxTokens,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    const data = (await res.json().catch(() => ({}))) as OpenAiResponse;
    if (!res.ok) {
      throw new LlmError(res.status, data.error?.message ?? `OpenAI ${res.status}`);
    }

    return {
      content: data.choices?.[0]?.message?.content ?? '',
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
    };
  },
};
