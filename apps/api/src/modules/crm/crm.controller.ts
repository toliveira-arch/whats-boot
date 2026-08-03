import { asyncHandler } from '../../lib/http';
import * as crm from './crm.service';

function companyIdOf(req: { query: Record<string, unknown> }): string | null {
  const v = req.query.companyId;
  return typeof v === 'string' && v.trim() ? v : null;
}

export const stagesController = asyncHandler(async (_req, res) => {
  res.json(crm.CRM_STAGES);
});

export const listLeadsController = asyncHandler(async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : undefined;
  res.json(await crm.listLeads({ companyId: companyIdOf(req), q }));
});

export const setStageController = asyncHandler(async (req, res) => {
  res.json(await crm.setStage(req.params.id!, String(req.body?.stage ?? '')));
});

export const testLeadController = asyncHandler(async (req, res) => {
  const body = (req.body ?? {}) as { phone?: unknown; name?: unknown; companyId?: unknown };
  res.json(
    await crm.createTestLead({
      phone: String(body.phone ?? ''),
      name: typeof body.name === 'string' ? body.name : undefined,
      companyId:
        typeof body.companyId === 'string' && body.companyId.trim() ? body.companyId : null,
    }),
  );
});

export const exportController = asyncHandler(async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : undefined;
  const csv = await crm.exportCsv({ companyId: companyIdOf(req), q });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
  res.send('﻿' + csv); // BOM p/ acentos no Excel
});
