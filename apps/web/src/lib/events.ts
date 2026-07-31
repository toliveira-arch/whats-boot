import { authFetch } from './api';

export interface ConversationEvent {
  id: string;
  type: string;
  kind: string;
  title: string;
  detail: string | null;
  actorName: string | null;
  at: string;
}

export function listConversationEvents(conversationId: string): Promise<ConversationEvent[]> {
  return authFetch(`/conversations/${conversationId}/events`);
}
