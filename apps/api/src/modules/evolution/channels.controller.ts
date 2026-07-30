import { asyncHandler } from '../../lib/http';
import * as channels from './channels.service';

export const listChannelsController = asyncHandler(async (_req, res) => {
  res.json(await channels.listChannels());
});

export const testConnectionController = asyncHandler(async (req, res) => {
  const { baseUrl, apiKey } = req.body;
  res.json(await channels.testConnection(baseUrl, apiKey));
});

export const createChannelController = asyncHandler(async (req, res) => {
  const result = await channels.createChannel(req.body);
  res.status(201).json(result);
});

export const qrCodeController = asyncHandler(async (req, res) => {
  res.json(await channels.getQrCode(req.params.channelId!));
});

export const stateController = asyncHandler(async (req, res) => {
  res.json(await channels.getState(req.params.channelId!));
});

export const reconnectController = asyncHandler(async (req, res) => {
  res.json(await channels.reconnect(req.params.channelId!));
});

export const logoutChannelController = asyncHandler(async (req, res) => {
  res.json(await channels.logoutChannel(req.params.channelId!));
});

export const deleteChannelController = asyncHandler(async (req, res) => {
  res.json(await channels.deleteChannel(req.params.channelId!));
});

export const setChannelAiController = asyncHandler(async (req, res) => {
  res.json(await channels.setChannelAiEnabled(req.params.channelId!, req.body.enabled));
});

export const diagnosticsController = asyncHandler(async (req, res) => {
  res.json(await channels.diagnostics(req.params.channelId!));
});
