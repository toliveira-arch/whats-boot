import { authFetch } from './api';

export interface AiAgent {
  id: string;
  name: string;
  provider: 'OPENAI' | 'GOOGLE';
  model: string;
  temperature: number;
  maxTokens: number;
  mode: 'OFF' | 'COPILOT' | 'AUTOPILOT';
  systemPrompt: string | null;
  forbiddenWords: string[];
  requiredWords: string[];
  activeFrom: string | null;
  activeTo: string | null;
  maxMessagesPerConversation: number | null;
  minResponseSeconds: number;
  maxResponseSeconds: number;
  isActive: boolean;
}

export type AiAgentInput = Partial<Omit<AiAgent, 'id'>>;

export interface CredentialsInfo {
  providers: string[];
  credentials: { id: string; provider: string; isActive: boolean; baseUrl: string | null }[];
}

export function getAgent(): Promise<AiAgent | null> {
  return authFetch('/ai/agent');
}

export function saveAgent(input: AiAgentInput): Promise<AiAgent> {
  return authFetch('/ai/agent', { method: 'PUT', body: JSON.stringify(input) });
}

export function listCredentials(): Promise<CredentialsInfo> {
  return authFetch('/ai/credentials');
}

export function setCredential(
  provider: string,
  apiKey: string,
  baseUrl?: string,
): Promise<unknown> {
  return authFetch('/ai/credentials', {
    method: 'PUT',
    body: JSON.stringify({ provider, apiKey, baseUrl: baseUrl || undefined }),
  });
}

export function testAgent(userMessage: string): Promise<{ content: string }> {
  return authFetch('/ai/test', { method: 'POST', body: JSON.stringify({ userMessage }) });
}
