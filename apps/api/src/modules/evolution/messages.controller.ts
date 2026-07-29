import { asyncHandler } from '../../lib/http';
import * as messaging from './messaging.service';

export const sendTextController = asyncHandler(async (req, res) => {
  const auth = req.auth!;
  const result = await messaging.sendText({
    tenantId: auth.tenantId,
    membershipId: auth.membershipId,
    channelId: req.body.channelId,
    number: req.body.number,
    text: req.body.text,
  });
  res.status(201).json(result);
});

export const sendMediaController = asyncHandler(async (req, res) => {
  const auth = req.auth!;
  const result = await messaging.sendMedia({
    tenantId: auth.tenantId,
    membershipId: auth.membershipId,
    channelId: req.body.channelId,
    number: req.body.number,
    mediatype: req.body.mediatype,
    media: req.body.media,
    mimetype: req.body.mimetype,
    fileName: req.body.fileName,
    caption: req.body.caption,
  });
  res.status(201).json(result);
});
