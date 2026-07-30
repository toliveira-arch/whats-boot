import { prisma, getTenantContext } from '@whats-boot/database';
import { HttpError } from '../../middlewares/error';
import { broadcastToTenant } from '../../realtime/emitter';
import * as messaging from '../evolution/messaging.service';

function currentTenantId(): string {
  const tenantId = getTenantContext()?.tenantId;
  if (!tenantId) throw new HttpError(500, 'Contexto de tenant ausente');
  return tenantId;
}

const contactSelect = {
  id: true,
  name: true,
  pushName: true,
  phoneNumber: true,
  waJid: true,
  profilePicUrl: true,
} as const;

// ---------------------------------------------------------------------------
// Conversas
// ---------------------------------------------------------------------------

export interface ListConversationsParams {
  q?: string;
  status?: string;
  archived?: boolean;
  pinned?: boolean;
  tagId?: string;
  limit?: number;
}

export async function listConversations(params: ListConversationsParams) {
  const limit = Math.min(params.limit ?? 50, 100);

  const conversations = await prisma.conversation.findMany({
    where: {
      deletedAt: null,
      isArchived: params.archived ?? false,
      ...(params.status ? { status: params.status as never } : {}),
      ...(params.pinned !== undefined ? { isPinned: params.pinned } : {}),
      ...(params.tagId ? { tags: { some: { tagId: params.tagId } } } : {}),
      ...(params.q
        ? {
            contact: {
              OR: [
                { name: { contains: params.q, mode: 'insensitive' } },
                { pushName: { contains: params.q, mode: 'insensitive' } },
                { phoneNumber: { contains: params.q } },
              ],
            },
          }
        : {}),
    },
    include: {
      contact: { select: contactSelect },
      tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { content: true, type: true, direction: true, createdAt: true, status: true },
      },
    },
    orderBy: [{ isPinned: 'desc' }, { lastMessageAt: { sort: 'desc', nulls: 'last' } }],
    take: limit,
  });

  return conversations.map((c) => ({
    id: c.id,
    status: c.status,
    priority: c.priority,
    isPinned: c.isPinned,
    isArchived: c.isArchived,
    unreadCount: c.unreadCount,
    aiMode: c.aiMode,
    aiEnabled: c.aiEnabled,
    assignedToId: c.assignedToId,
    lastMessageAt: c.lastMessageAt,
    contact: c.contact,
    tags: c.tags.map((t) => t.tag),
    lastMessage: c.messages[0] ?? null,
  }));
}

async function requireConversation(conversationId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, deletedAt: null },
    include: {
      contact: { select: contactSelect },
      tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
    },
  });
  if (!conversation) throw new HttpError(404, 'Conversa não encontrada');
  return conversation;
}

export async function getConversation(conversationId: string) {
  const c = await requireConversation(conversationId);
  return {
    id: c.id,
    status: c.status,
    priority: c.priority,
    isPinned: c.isPinned,
    isArchived: c.isArchived,
    unreadCount: c.unreadCount,
    aiMode: c.aiMode,
    aiEnabled: c.aiEnabled,
    assignedToId: c.assignedToId,
    evolutionInstanceId: c.evolutionInstanceId,
    lastMessageAt: c.lastMessageAt,
    contact: c.contact,
    tags: c.tags.map((t) => t.tag),
  };
}

// ---------------------------------------------------------------------------
// Mensagens (scroll infinito por cursor)
// ---------------------------------------------------------------------------

export async function listMessages(conversationId: string, cursor?: string, limit = 30) {
  await requireConversation(conversationId);
  const take = Math.min(limit, 100);

  const messages = await prisma.message.findMany({
    where: { conversationId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      file: { select: { url: true, mimeType: true, kind: true, originalName: true } },
    },
  });

  const hasMore = messages.length > take;
  const page = hasMore ? messages.slice(0, take) : messages;

  return {
    // devolvidos em ordem cronológica (antigas -> novas) para o front
    messages: page.reverse().map((m) => ({
      id: m.id,
      direction: m.direction,
      authorType: m.authorType,
      type: m.type,
      content: m.content,
      caption: m.caption,
      status: m.status,
      mediaUrl: m.file?.url ?? null,
      mediaMime: m.file?.mimeType ?? null,
      mediaName: m.file?.originalName ?? null,
      createdAt: m.createdAt,
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export async function markRead(conversationId: string) {
  await requireConversation(conversationId);
  await prisma.conversation.update({ where: { id: conversationId }, data: { unreadCount: 0 } });
  broadcastToTenant(currentTenantId(), 'conversation.updated', { conversationId });
  return { ok: true };
}

export interface SendInput {
  membershipId: string;
  text?: string;
  mediatype?: 'image' | 'video' | 'audio' | 'document';
  media?: string;
  mimetype?: string;
  fileName?: string;
  caption?: string;
}

export async function sendMessage(conversationId: string, input: SendInput) {
  const conversation = await requireConversation(conversationId);
  const tenantId = currentTenantId();
  const number = conversation.contact.waJid ?? conversation.contact.phoneNumber ?? '';

  if (input.media && input.mediatype) {
    return messaging.sendMedia({
      tenantId,
      membershipId: input.membershipId,
      channelId: conversation.evolutionInstanceId,
      number,
      mediatype: input.mediatype,
      media: input.media,
      mimetype: input.mimetype,
      fileName: input.fileName,
      caption: input.caption,
    });
  }

  return messaging.sendText({
    tenantId,
    membershipId: input.membershipId,
    channelId: conversation.evolutionInstanceId,
    number,
    text: input.text ?? '',
  });
}

export interface UpdateConversationInput {
  status?: string;
  isPinned?: boolean;
  isArchived?: boolean;
  assignedToId?: string | null;
  aiMode?: 'OFF' | 'COPILOT' | 'AUTOPILOT';
  aiEnabled?: boolean | null;
}

export async function updateConversation(conversationId: string, patch: UpdateConversationInput) {
  await requireConversation(conversationId);
  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      ...(patch.status ? { status: patch.status as never } : {}),
      ...(patch.isPinned !== undefined ? { isPinned: patch.isPinned } : {}),
      ...(patch.isArchived !== undefined
        ? { isArchived: patch.isArchived, archivedAt: patch.isArchived ? new Date() : null }
        : {}),
      ...(patch.assignedToId !== undefined ? { assignedToId: patch.assignedToId } : {}),
      ...(patch.aiMode !== undefined ? { aiMode: patch.aiMode } : {}),
      ...(patch.aiEnabled !== undefined ? { aiEnabled: patch.aiEnabled } : {}),
    },
  });
  broadcastToTenant(currentTenantId(), 'conversation.updated', { conversationId });
  return {
    id: updated.id,
    status: updated.status,
    isPinned: updated.isPinned,
    isArchived: updated.isArchived,
    aiMode: updated.aiMode,
    aiEnabled: updated.aiEnabled,
  };
}

// ---------------------------------------------------------------------------
// Etiquetas (tags)
// ---------------------------------------------------------------------------

export async function listTags() {
  return prisma.tag.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, color: true, type: true },
    orderBy: { name: 'asc' },
  });
}

export async function createTag(input: { name: string; color?: string }) {
  const tenantId = currentTenantId();
  return prisma.tag.create({
    data: { tenantId, name: input.name, color: input.color, type: 'CONVERSATION' },
    select: { id: true, name: true, color: true, type: true },
  });
}

export async function addTag(conversationId: string, tagId: string, membershipId: string) {
  await requireConversation(conversationId);
  const tenantId = currentTenantId();
  await prisma.conversationTag.upsert({
    where: { conversationId_tagId: { conversationId, tagId } },
    create: { tenantId, conversationId, tagId, createdById: membershipId },
    update: {},
  });
  broadcastToTenant(tenantId, 'conversation.updated', { conversationId });
  return { ok: true };
}

export async function removeTag(conversationId: string, tagId: string) {
  await requireConversation(conversationId);
  await prisma.conversationTag.deleteMany({ where: { conversationId, tagId } });
  broadcastToTenant(currentTenantId(), 'conversation.updated', { conversationId });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Notas internas
// ---------------------------------------------------------------------------

export async function listNotes(conversationId: string) {
  await requireConversation(conversationId);
  const notes = await prisma.note.findMany({
    where: { conversationId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    include: { author: { include: { user: { select: { name: true } } } } },
  });
  return notes.map((n) => ({
    id: n.id,
    body: n.body,
    createdAt: n.createdAt,
    authorName: n.author?.user.name ?? null,
  }));
}

export async function addNote(conversationId: string, membershipId: string, body: string) {
  const conversation = await requireConversation(conversationId);
  const tenantId = currentTenantId();
  const note = await prisma.note.create({
    data: {
      tenantId,
      conversationId,
      contactId: conversation.contactId,
      authorMembershipId: membershipId,
      body,
    },
  });
  return { id: note.id, body: note.body, createdAt: note.createdAt };
}
