import { useEffect, useState } from 'react';
import { apiGet, API_URL } from './lib/api';
import { socket, SOCKET_URL } from './lib/socket';

type Health = { status: string; uptime: number };

/**
 * Página de verificação de infraestrutura (ETAPA 3).
 * Não é uma funcionalidade — apenas prova que web ↔ api ↔ socket respondem.
 */
export function App() {
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [socketOk, setSocketOk] = useState(false);

  useEffect(() => {
    apiGet<Health>('/health')
      .then(() => setApiOk(true))
      .catch(() => setApiOk(false));

    const onConnect = () => setSocketOk(true);
    const onDisconnect = () => setSocketOk(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    if (socket.connected) setSocketOk(true);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  return (
    <div className="wrap">
      <h1>whats-boot · infraestrutura</h1>
      <p className="sub">ETAPA 3 — verificação de conectividade (sem funcionalidades)</p>

      <div className="card">
        <span>API REST</span>
        <span className="status">
          <span className={`dot ${apiOk === null ? '' : apiOk ? 'ok' : 'err'}`} />
          {apiOk === null ? 'verificando…' : apiOk ? `online (${API_URL})` : 'offline'}
        </span>
      </div>

      <div className="card">
        <span>WebSocket (Socket.IO)</span>
        <span className="status">
          <span className={`dot ${socketOk ? 'ok' : 'err'}`} />
          {socketOk ? `conectado (${SOCKET_URL})` : 'desconectado'}
        </span>
      </div>
    </div>
  );
}
