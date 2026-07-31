import { asyncHandler } from '../../lib/http';
import * as svc from './conversations.service';

export const listConversationsController = asyncHandler(async (req, res) => {
  const { q, status, archived, pinned, tagId, channelId, limit } = req.query;
  res.json(
    await svc.listConversations({
      q: typeof q === 'string' ? q : undefined,
      status: typeof status === 'string' ? status : undefined,
      archived: archived === 'true' ? true : archived === 'false' ? false : undefined,
      pinned: pinned === 'true' ? true : pinned === 'false' ? false : undefined,
      tagId: typeof tagId === 'string' ? tagId : undefined,
      channelId: typeof channelId === 'string' ? channelId : undefined,
      limit: typeof limit === 'string' ? Number(limit) : undefined,
    }),
  );
});

export const getConversationController = asyncHandler(async (req, res) => {
  res.json(await svc.getConversation(req.params.id!));
});

export const listMessagesController = asyncHandler(async (req, res) => {
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
  res.json(await svc.listMessages(req.params.id!, cursor, limit));
});

export const sendMessageController = asyncHandler(async (req, res) => {
  const result = await svc.sendMessage(req.params.id!, {
    membershipId: req.auth!.membershipId,
    ...req.body,
  });
  res.status(201).json(result);
});

export const markReadController = asyncHandler(async (req, res) => {
  res.json(await svc.markRead(req.params.id!));
});

export const resetConversationController = asyncHandler(async (req, res) => {
  res.json(await svc.resetConversation(req.params.id!));
});

export const updateConversationController = asyncHandler(async (req, res) => {
  res.json(await svc.updateConversation(req.params.id!, req.body));
});

export const listTagsController = asyncHandler(async (_req, res) => {
  res.json(await svc.listTags());
});

export const createTagController = asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createTag(req.body));
});

export const addTagController = asyncHandler(async (req, res) => {
  res.json(await svc.addTag(req.params.id!, req.body.tagId, req.auth!.membershipId));
});

export const removeTagController = asyncHandler(async (req, res) => {
  res.json(await svc.removeTag(req.params.id!, req.params.tagId!));
});

export const listNotesController = asyncHandler(async (req, res) => {
  res.json(await svc.listNotes(req.params.id!));
});

export const addNoteController = asyncHandler(async (req, res) => {
  res.status(201).json(await svc.addNote(req.params.id!, req.auth!.membershipId, req.body.body));
});
