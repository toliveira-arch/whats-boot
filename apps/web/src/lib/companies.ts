import { authFetch } from './api';

export interface Company {
  id: string;
  name: string;
  legalName: string | null;
  document: string | null;
  email: string | null;
  phone: string | null;
  closerName: string | null;
  closerPhone: string | null;
  status: string;
  createdAt: string;
}

export type CompanyInput = Partial<Omit<Company, 'id' | 'status' | 'createdAt'>> & { name: string };

export function listCompanies(): Promise<Company[]> {
  return authFetch('/companies');
}

export function createCompany(input: CompanyInput): Promise<Company> {
  return authFetch('/companies', { method: 'POST', body: JSON.stringify(input) });
}

export function updateCompany(id: string, input: Partial<CompanyInput>): Promise<Company> {
  return authFetch(`/companies/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteCompany(id: string): Promise<{ ok: boolean }> {
  return authFetch(`/companies/${id}`, { method: 'DELETE' });
}
