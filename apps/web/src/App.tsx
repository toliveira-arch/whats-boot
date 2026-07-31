import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { AppLayout } from './components/AppLayout';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Dashboard } from './pages/Dashboard';
import { Chat } from './pages/Chat';
import { Channels } from './pages/Channels';
import { Companies } from './pages/Companies';
import { Monitor } from './pages/Monitor';
import { AiSettings } from './pages/AiSettings';
import { Integrations } from './pages/Integrations';

function ProtectedLayout() {
  const { status } = useAuth();
  if (status === 'loading') {
    return (
      <div className="center">
        <p className="sub">Carregando…</p>
      </div>
    );
  }
  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace />;
  }
  return <AppLayout />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/companies" element={<Companies />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/channels" element={<Channels />} />
        <Route path="/monitor" element={<Monitor />} />
        <Route path="/ai" element={<AiSettings />} />
        <Route path="/integrations" element={<Integrations />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
