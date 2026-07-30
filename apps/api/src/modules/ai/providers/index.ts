import type { LlmProvider } from './types';
import { openAiProvider } from './openai';
import { geminiProvider } from './gemini';

/**
 * Registro de provedores. `AiProvider` (enum do Prisma) -> implementação.
 * Adicionar um novo provedor = implementar LlmProvider e registrar aqui.
 */
const registry: Record<string, LlmProvider> = {
  OPENAI: openAiProvider,
  GOOGLE: geminiProvider,
};

export function getProvider(name: string): LlmProvider | null {
  return registry[name] ?? null;
}

export function supportedProviders(): string[] {
  return Object.keys(registry);
}

export * from './types';
