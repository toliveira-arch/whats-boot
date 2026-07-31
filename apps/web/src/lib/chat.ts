import { authFetch } from './api';

export interface ChatContact {
  id: string;
  name: string | null;
  pushName: string | null;
  phoneNumber: string | null;
  waJid: string | null;
  profilePicUrl: string | null;
}

export interface ChatTag {
  id: string;
  name: string;
  color: string | null;
}

export type AiMode = 'OFF' | 'COPILOT' | 'AUTOPILOT';
export type LeadVerdict = 'IN_PROGRESS' | 'QUALIFIED' | 'DISQUALIFIED';

export interface LeadQualification {
  campaignId: string | null;
  campaignName: string | null;
  collected: Record<string, unknown>;
  interest: string | null;
  urgency: string | null;
  summary: string | null;
  reasons?: string[];
  updatedAt?: string;
}

export interface ChannelRef {
  id: string;
  name: string;
}

export interface ConversationListItem {
  id: string;
  status: string;
  isPinned: boolean;
  isArchived: boolean;
  unreadCount: number;
  aiMode: AiMode;
  aiEnabled: boolean | null;
  leadVerdict: LeadVerdict | null;
  lastMessageAt: string | null;
  contact: ChatContact;
  channel: ChannelRef | null;
  tags: ChatTag[];
  lastMessage: {
    content: string | null;
    type: string;
    direction: string;
    createdAt: string;
  } | null;
}

export interface ConversationDetail {
  id: string;
  status: string;
  isPinned: boolean;
  isArchived: boolean;
  unreadCount: number;
  aiMode: AiMode;
  aiEnabled: boolean | null;
  leadVerdict: LeadVerdict | null;
  qualification: LeadQualification | null;
  evolutionInstanceId: string;
  channel: ChannelRef | null;
  contact: ChatContact;
  tags: ChatTag[];
}

export interface ChatMessage {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  authorType: string;
  type: string;
  content: string | null;
  caption: string | null;
  status: string;
  mediaUrl: string | null;
  mediaMime: string | null;
  mediaName: string | null;
  createdAt: string;
}

export interface ChatNote {
  id: string;
  body: string;
  createdAt: string;
  authorName: string | null;
}

export interface ListFilters {
  q?: string;
  archived?: boolean;
  tagId?: string;
  channelId?: string;
}

export function listConversations(f: ListFilters = {}): Promise<ConversationListItem[]> {
  const qs = new URLSearchParams();
  if (f.q) qs.set('q', f.q);
  if (f.archived !== undefined) qs.set('archived', String(f.archived));
  if (f.tagId) qs.set('tagId', f.tagId);
  if (f.channelId) qs.set('channelId', f.channelId);
  const s = qs.toString();
  return authFetch(`/conversations${s ? `?${s}` : ''}`);
}

export function getConversation(id: string): Promise<ConversationDetail> {
  return authFetch(`/conversations/${id}`);
}

export function listMessages(
  id: string,
  cursor?: string,
): Promise<{ messages: ChatMessage[]; nextCursor: string | null }> {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return authFetch(`/conversations/${id}/messages${qs}`);
}

export function sendMessage(id: string, text: string): Promise<{ messageId: string }> {
  return authFetch(`/conversations/${id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

export function markRead(id: string): Promise<{ ok: boolean }> {
  return authFetch(`/conversations/${id}/read`, { method: 'POST' });
}

export function updateConversation(
  id: string,
  patch: {
    status?: string;
    isPinned?: boolean;
    isArchived?: boolean;
    aiMode?: AiMode;
    aiEnabled?: boolean | null;
  },
): Promise<unknown> {
  return authFetch(`/conversations/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function listTags(): Promise<ChatTag[]> {
  return authFetch('/tags');
}

export function createTag(name: string, color?: string): Promise<ChatTag> {
  return authFetch('/tags', { method: 'POST', body: JSON.stringify({ name, color }) });
}

export function addTag(id: string, tagId: string): Promise<unknown> {
  return authFetch(`/conversations/${id}/tags`, {
    method: 'POST',
    body: JSON.stringify({ tagId }),
  });
}

export function removeTag(id: string, tagId: string): Promise<unknown> {
  return authFetch(`/conversations/${id}/tags/${tagId}`, { method: 'DELETE' });
}

export function listNotes(id: string): Promise<ChatNote[]> {
  return authFetch(`/conversations/${id}/notes`);
}

export function addNote(id: string, body: string): Promise<ChatNote> {
  return authFetch(`/conversations/${id}/notes`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}
