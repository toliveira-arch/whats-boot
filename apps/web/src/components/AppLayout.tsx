import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { getSocket } from '../lib/socket';
import { Logo } from './Logo';

export function AppLayout() {
  const { profile, logout } = useAuth();
  const [alert, setAlert] = useState<{ name: string; at: string } | null>(null);
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'nav-link active' : 'nav-link';

  // Alerta ao vivo quando um canal desconecta.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onAlert = (a: { name?: string; at?: string }) =>
      setAlert({ name: a.name ?? 'Canal', at: a.at ?? new Date().toISOString() });
    socket.on('channel.alert', onAlert);
    return () => {
      socket.off('channel.alert', onAlert);
    };
  }, []);

  return (
    <div className="app-shell">
      {alert && (
        <div className="disc-banner">
          <span>
            ⚠️ O canal <strong>{alert.name}</strong> desconectou do WhatsApp. Reconecte em{' '}
            <NavLink to="/channels" onClick={() => setAlert(null)}>
              Canais
            </NavLink>
            .
          </span>
          <button type="button" className="disc-x" onClick={() => setAlert(null)}>
            ×
          </button>
        </div>
      )}
      <nav className="app-nav">
        <span className="brand">
          <Logo height={26} />
        </span>
        <NavLink to="/" end className={linkClass}>
          Dashboard
        </NavLink>
        <NavLink to="/chat" className={linkClass}>
          Chat
        </NavLink>
        <NavLink to="/companies" className={linkClass}>
          Empresas
        </NavLink>
        <NavLink to="/channels" className={linkClass}>
          Canais
        </NavLink>
        <NavLink to="/monitor" className={linkClass}>
          Monitor
        </NavLink>
        <NavLink to="/ai" className={linkClass}>
          IA
        </NavLink>
        <NavLink to="/integrations" className={linkClass}>
          Integrações
        </NavLink>
        <NavLink to="/warmup" className={linkClass}>
          Aquecimento
        </NavLink>
        <NavLink to="/followup" className={linkClass}>
          Follow-up
        </NavLink>
        <span className="nav-spacer" />
        <span className="sub nav-user">{profile?.role.name ?? profile?.user.name}</span>
        <button className="btn ghost" onClick={() => void logout()}>
          Sair
        </button>
      </nav>
      <div className="app-body">
        <Outlet />
      </div>
    </div>
  );
}
