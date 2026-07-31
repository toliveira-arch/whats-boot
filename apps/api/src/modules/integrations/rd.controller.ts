import { asyncHandler } from '../../lib/http';
import * as rd from './rd.service';

function present(integ: {
  id: string;
  enabled: boolean;
  webhookToken: string;
  channelId: string | null;
  openingMessage: string;
  handoffToSdr: boolean;
}) {
  return {
    id: integ.id,
    enabled: integ.enabled,
    channelId: integ.channelId,
    openingMessage: integ.openingMessage,
    handoffToSdr: integ.handoffToSdr,
    webhookUrl: rd.rdWebhookUrl(integ.webhookToken),
  };
}

/** Lê ?companyId=... da query (empresa selecionada no painel). */
function companyIdOf(req: { query: Record<string, unknown> }): string | null {
  const v = req.query.companyId;
  return typeof v === 'string' && v.trim() ? v : null;
}

export const getRdController = asyncHandler(async (req, res) => {
  res.json(present(await rd.getIntegration(companyIdOf(req))));
});

export const updateRdController = asyncHandler(async (req, res) => {
  res.json(present(await rd.upsertIntegration(companyIdOf(req), req.body)));
});

export const regenerateRdController = asyncHandler(async (req, res) => {
  res.json(present(await rd.regenerateToken(companyIdOf(req))));
});

export const rdEventsController = asyncHandler(async (req, res) => {
  res.json(await rd.listEvents(companyIdOf(req)));
});

/** Rota PÚBLICA — RD Station chama aqui a cada novo lead. */
export const rdWebhookController = asyncHandler(async (req, res) => {
  const result = await rd.handleRdWebhook(
    req.params.token!,
    (req.body ?? {}) as Record<string, unknown>,
  );
  // Sempre 200 para o RD não ficar reenviando; o status vai no corpo/log.
  res.status(200).json({ received: true, ...result });
});
