const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3333';

/** Cliente HTTP mínimo (infraestrutura). A camada de dados real virá depois. */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`GET ${path} -> ${res.status}`);
  }
  return (await res.json()) as T;
}

export { API_URL };
