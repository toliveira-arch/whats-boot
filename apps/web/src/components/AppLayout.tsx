import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export function AppLayout() {
  const { profile, logout } = useAuth();
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'nav-link active' : 'nav-link';

  return (
    <div className="app-shell">
      <nav className="app-nav">
        <span className="brand">whats-boot</span>
        <NavLink to="/" end className={linkClass}>
          Dashboard
        </NavLink>
        <NavLink to="/chat" className={linkClass}>
          Chat
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
        <span className="nav-spacer" />
        <span className="sub">{profile?.user.name}</span>
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
