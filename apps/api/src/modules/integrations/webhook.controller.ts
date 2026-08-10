import { asyncHandler } from '../../lib/http';
import * as webhook from './webhook.service';

function present(integ: {
  id: string;
  label: string;
  enabled: boolean;
  webhookToken: string;
  channelId: string | null;
  openingMessage: string;
  handoffToSdr: boolean;
  sourceFilter: string | null;
}) {
  return {
    id: integ.id,
    label: integ.label,
    enabled: integ.enabled,
    channelId: integ.channelId,
    openingMessage: integ.openingMessage,
    handoffToSdr: integ.handoffToSdr,
    sourceFilter: integ.sourceFilter ?? '',
    webhookUrl: webhook.genericWebhookUrl(integ.webhookToken),
  };
}

function companyIdOf(req: { query: Record<string, unknown> }): string | null {
  const v = req.query.companyId;
  return typeof v === 'string' && v.trim() ? v : null;
}

export const getWebhookController = asyncHandler(async (req, res) => {
  res.json(present(await webhook.getIntegration(companyIdOf(req))));
});

export const updateWebhookController = asyncHandler(async (req, res) => {
  res.json(present(await webhook.upsertIntegration(companyIdOf(req), req.body)));
});

export const regenerateWebhookController = asyncHandler(async (req, res) => {
  res.json(present(await webhook.regenerateToken(companyIdOf(req))));
});

export const webhookEventsController = asyncHandler(async (req, res) => {
  res.json(await webhook.listEvents(companyIdOf(req)));
});

/** Rota PÚBLICA — Foresee/outros CRMs chamam aqui a cada novo lead. */
export const genericWebhookController = asyncHandler(async (req, res) => {
  const result = await webhook.handleGenericWebhook(
    req.params.token!,
    (req.body ?? {}) as Record<string, unknown>,
  );
  res.status(200).json({ received: true, ...result });
});
