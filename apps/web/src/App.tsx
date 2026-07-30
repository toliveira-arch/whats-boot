import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { AppLayout } from './components/AppLayout';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Dashboard } from './pages/Dashboard';
import { Chat } from './pages/Chat';
import { AiSettings } from './pages/AiSettings';

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
        <Route path="/chat" element={<Chat />} />
        <Route path="/ai" element={<AiSettings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
