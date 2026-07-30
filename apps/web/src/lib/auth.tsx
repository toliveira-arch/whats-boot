import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { authFetch, publicPost, refreshAccessToken, setAccessToken } from './api';
import { connectSocket, disconnectSocket } from './socket';
import type { Profile } from './types';

type Status = 'loading' | 'authenticated' | 'unauthenticated';

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  companyName?: string;
}

interface AuthValue {
  status: Status;
  profile: Profile | null;
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [profile, setProfile] = useState<Profile | null>(null);

  // Login silencioso: tenta renovar o token pelo cookie ao carregar.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const token = await refreshAccessToken();
        if (!active) return;
        if (!token) {
          setStatus('unauthenticated');
          return;
        }
        const me = await authFetch<Profile>('/auth/me');
        if (!active) return;
        connectSocket(token);
        setProfile(me);
        setStatus('authenticated');
      } catch {
        // API indisponível / erro inesperado → cai para a tela de login.
        if (active) setStatus('unauthenticated');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      profile,
      async login(email, password) {
        const { accessToken } = await publicPost<{ accessToken: string }>('/auth/login', {
          email,
          password,
        });
        setAccessToken(accessToken);
        connectSocket(accessToken);
        const me = await authFetch<Profile>('/auth/me');
        setProfile(me);
        setStatus('authenticated');
      },
      async register(input) {
        const { accessToken } = await publicPost<{ accessToken: string }>('/auth/register', input);
        setAccessToken(accessToken);
        connectSocket(accessToken);
        const me = await authFetch<Profile>('/auth/me');
        setProfile(me);
        setStatus('authenticated');
      },
      async logout() {
        try {
          await authFetch('/auth/logout', { method: 'POST' });
        } catch {
          // ignora — limpamos o estado localmente de qualquer forma
        }
        setAccessToken(null);
        disconnectSocket();
        setProfile(null);
        setStatus('unauthenticated');
      },
    }),
    [status, profile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>');
  return ctx;
}
