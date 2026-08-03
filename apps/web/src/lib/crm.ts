import { authFetch, API_URL, getAccessToken } from './api';

export interface CrmStage {
  key: string;
  label: string;
  desc?: string;
}

export interface Lead {
  id: string;
  stage: string;
  stageLabel: string;
  verdict: string | null;
  status: string;
  name: string;
  phone: string | null;
  company: string | null;
  campaign: string | null;
  summary: string | null;
  interest: string | null;
  urgency: string | null;
  faturamento: string | null;
  assignedTo: string | null;
  lastMessageAt: string | null;
  stalledDays: number;
  createdAt: string;
}

function q(companyId?: string | null, search?: string): string {
  const p = new URLSearchParams();
  if (companyId) p.set('companyId', companyId);
  if (search) p.set('q', search);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function listStages(): Promise<CrmStage[]> {
  return authFetch('/crm/stages');
}

export function listLeads(companyId?: string | null, search?: string): Promise<Lead[]> {
  return authFetch(`/crm/leads${q(companyId, search)}`);
}

export function setStage(id: string, stage: string): Promise<Lead> {
  return authFetch(`/crm/leads/${id}/stage`, { method: 'PATCH', body: JSON.stringify({ stage }) });
}

export interface TestLeadResult {
  status: string;
  conversationId: string;
  channel: string;
  phone: string;
}

export function createTestLead(input: {
  phone: string;
  name?: string;
  companyId?: string | null;
}): Promise<TestLeadResult> {
  return authFetch('/crm/test-lead', { method: 'POST', body: JSON.stringify(input) });
}

/** Baixa o CSV de leads (respeitando empresa/busca). */
export async function downloadCsv(companyId?: string | null, search?: string): Promise<void> {
  const res = await fetch(`${API_URL}/crm/export${q(companyId, search)}`, {
    credentials: 'include',
    headers: getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {},
  });
  if (!res.ok) throw new Error('Falha ao exportar');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'leads.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
