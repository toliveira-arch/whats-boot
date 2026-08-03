import { asyncHandler } from '../../lib/http';
import * as kommo from './kommo.service';

function present(integ: {
  id: string;
  enabled: boolean;
  webhookToken: string;
  channelId: string | null;
  openingMessage: string;
  handoffToSdr: boolean;
  subdomain: string | null;
  accessTokenEnc: string | null;
}) {
  return {
    id: integ.id,
    enabled: integ.enabled,
    channelId: integ.channelId,
    openingMessage: integ.openingMessage,
    handoffToSdr: integ.handoffToSdr,
    subdomain: integ.subdomain ?? '',
    hasToken: Boolean(integ.accessTokenEnc),
    webhookUrl: kommo.kommoWebhookUrl(integ.webhookToken),
  };
}

function companyIdOf(req: { query: Record<string, unknown> }): string | null {
  const v = req.query.companyId;
  return typeof v === 'string' && v.trim() ? v : null;
}

export const getKommoController = asyncHandler(async (req, res) => {
  res.json(present(await kommo.getIntegration(companyIdOf(req))));
});

export const updateKommoController = asyncHandler(async (req, res) => {
  res.json(present(await kommo.upsertIntegration(companyIdOf(req), req.body)));
});

export const regenerateKommoController = asyncHandler(async (req, res) => {
  res.json(present(await kommo.regenerateToken(companyIdOf(req))));
});

export const kommoEventsController = asyncHandler(async (req, res) => {
  res.json(await kommo.listEvents(companyIdOf(req)));
});

/** Rota PÚBLICA — o Kommo chama aqui a cada novo lead. */
export const kommoWebhookController = asyncHandler(async (req, res) => {
  const result = await kommo.handleKommoWebhook(
    req.params.token!,
    (req.body ?? {}) as Record<string, unknown>,
  );
  res.status(200).json({ received: true, ...result });
});
