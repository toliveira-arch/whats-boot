// Em dev: API em localhost:3333 sob /api. Em produção (single-service): defina
// VITE_API_URL=/api (mesma origem). O sufixo /api casa com o mount do backend.
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3333/api';

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
export function getAccessToken(): string | null {
  return accessToken;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function rawFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API_URL}${path}`, { credentials: 'include', ...init });
}

async function messageOf(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { message?: string; details?: unknown };
    const base = data.message ?? res.statusText;
    // Anexa o motivo real quando o backend envia details.cause (ex.: erro da Evolution API).
    const cause =
      data.details && typeof data.details === 'object'
        ? (data.details as { cause?: unknown }).cause
        : undefined;
    return cause ? `${base} — ${String(cause)}` : base;
  } catch {
    return res.statusText;
  }
}

/**
 * Renova o access token usando o cookie httpOnly de refresh.
 * Nunca lança: erros de rede / API indisponível resultam em `null`
 * (o app cai para a tela de login em vez de travar).
 */
export async function refreshAccessToken(): Promise<string | null> {
  try {
    const res = await rawFetch('/auth/refresh', { method: 'POST' });
    if (!res.ok) {
      accessToken = null;
      return null;
    }
    const data = (await res.json()) as { accessToken: string };
    accessToken = data.accessToken;
    return accessToken;
  } catch {
    accessToken = null;
    return null;
  }
}

function withHeaders(init: RequestInit, token: string | null): RequestInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return { ...init, headers };
}

const NETWORK_MESSAGE = `Não foi possível conectar à API (${API_URL}). Verifique se ela está no ar.`;

/** Requisição autenticada; renova o token uma vez em caso de 401. */
export async function authFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await rawFetch(path, withHeaders(init, accessToken));
    if (res.status === 401) {
      const token = await refreshAccessToken();
      if (token) res = await rawFetch(path, withHeaders(init, token));
    }
  } catch {
    throw new ApiError(0, NETWORK_MESSAGE);
  }
  if (!res.ok) throw new ApiError(res.status, await messageOf(res));
  return (await res.json()) as T;
}

/** POST público (sem token) — usado por login/registro. */
export async function publicPost<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await rawFetch(path, withHeaders({ method: 'POST', body: JSON.stringify(body) }, null));
  } catch {
    throw new ApiError(0, NETWORK_MESSAGE);
  }
  if (!res.ok) throw new ApiError(res.status, await messageOf(res));
  return (await res.json()) as T;
}

export { API_URL };
