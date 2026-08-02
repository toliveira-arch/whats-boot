import { authFetch } from './api';

export interface FaqEntry {
  q: string;
  a: string;
}

export interface CompanyKnowledge {
  id: string;
  companyId: string;
  enabled: boolean;
  notes: string;
  entries: FaqEntry[];
}

function q(companyId?: string | null): string {
  return companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
}

export function getKnowledge(companyId: string): Promise<CompanyKnowledge> {
  return authFetch(`/knowledge${q(companyId)}`);
}

export function saveKnowledge(
  companyId: string,
  input: { enabled?: boolean; notes?: string; entries?: FaqEntry[] },
): Promise<CompanyKnowledge> {
  return authFetch(`/knowledge${q(companyId)}`, { method: 'PUT', body: JSON.stringify(input) });
}
