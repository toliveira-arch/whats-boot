import { authFetch } from './api';

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  dueAt: string;
  status: 'PENDING' | 'DONE' | 'CANCELED';
  overdue: boolean;
  completedAt: string | null;
  conversationId: string | null;
  companyId: string | null;
  companyName: string | null;
  contactId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface Assignee {
  id: string;
  name: string;
}

export interface TaskInput {
  title: string;
  notes?: string;
  dueAt: string; // ISO
  companyId?: string | null;
  conversationId?: string | null;
  assignedToId?: string | null;
}

function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function listTasks(filters: {
  companyId?: string;
  assignedToId?: string;
  status?: string;
  q?: string;
}): Promise<Task[]> {
  return authFetch(`/tasks${qs(filters)}`);
}

export function listAssignees(): Promise<Assignee[]> {
  return authFetch('/tasks/assignees');
}

export function createTask(input: TaskInput): Promise<Task> {
  return authFetch('/tasks', { method: 'POST', body: JSON.stringify(input) });
}

export function updateTask(
  id: string,
  input: Partial<TaskInput> & { status?: string },
): Promise<Task> {
  return authFetch(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteTask(id: string): Promise<{ ok: boolean }> {
  return authFetch(`/tasks/${id}`, { method: 'DELETE' });
}
