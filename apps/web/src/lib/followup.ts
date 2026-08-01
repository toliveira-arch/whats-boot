import { authFetch } from './api';

export interface FollowUpStep {
  afterHours: number;
  text: string;
  active: boolean;
}

export interface FollowUpSequence {
  id: string;
  companyId: string;
  enabled: boolean;
  steps: FollowUpStep[];
}

function q(companyId?: string | null): string {
  return companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
}

export function getSequence(companyId: string): Promise<FollowUpSequence> {
  return authFetch(`/followup/sequence${q(companyId)}`);
}

export function saveSequence(
  companyId: string,
  input: { enabled?: boolean; steps?: FollowUpStep[] },
): Promise<FollowUpSequence> {
  return authFetch(`/followup/sequence${q(companyId)}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}
