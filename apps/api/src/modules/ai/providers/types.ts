export type LlmRole = 'system' | 'user' | 'assistant';

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export interface LlmRequest {
  model: string;
  temperature: number;
  maxTokens: number;
  messages: LlmMessage[];
  /** Quando true, pede ao provedor uma resposta JSON (structured output). */
  json?: boolean;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmResult {
  content: string;
  usage: LlmUsage;
}

/**
 * Contrato único de provedor de IA. A aplicação nunca conhece o fornecedor —
 * fala só com esta interface (OpenAI, Gemini, e futuros implementam-na).
 */
export interface LlmProvider {
  readonly name: string;
  chat(req: LlmRequest, apiKey: string, baseUrl?: string): Promise<LlmResult>;
}

export class LlmError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}
