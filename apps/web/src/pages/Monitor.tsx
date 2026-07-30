import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket } from '../lib/socket';
import * as ch from '../lib/channels';
import type { Channel, ChannelStatus } from '../lib/channels';

interface FeedItem {
  id: string;
  kind: 'message' | 'status';
  text: string;
  direction?: string;
  at: number;
}

let feedSeq = 0;

export function Monitor() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    try {
      setChannels(await ch.listChannels());
    } catch {
      /* ignora */
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 20000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const push = (item: Omit<FeedItem, 'id' | 'at'>) => {
      feedSeq += 1;
      seqRef.current += 1;
      setFeed((prev) => [{ ...item, id: `f${feedSeq}`, at: seqRef.current }, ...prev.slice(0, 49)]);
    };

    const onMessage = (p: { direction?: string; content?: string | null }) => {
      push({
        kind: 'message',
        direction: p.direction,
        text: p.content?.slice(0, 120) || '(mídia/sem texto)',
      });
    };
    const onStatus = (p: { channelId?: string; status?: ChannelStatus }) => {
      if (!p.channelId || !p.status) return;
      setChannels((prev) =>
        prev.map((c) => (c.id === p.channelId ? { ...c, status: p.status! } : c)),
      );
      push({
        kind: 'status',
        text: `Instância ${p.channelId.slice(-6)} → ${ch.STATUS_LABEL[p.status]}`,
      });
    };

    socket.on('message.created', onMessage);
    socket.on('channel.status', onStatus);
    return () => {
      socket.off('message.created', onMessage);
      socket.off('channel.status', onStatus);
    };
  }, []);

  const connected = channels.filter((c) => c.status === 'CONNECTED').length;
  const aiOn = channels.filter((c) => c.aiEnabled).length;

  return (
    <div className="settings wide">
      <h1>Monitoramento em tempo real</h1>

      <div className="stat-row">
        <div className="stat-card">
          <span className="stat-num">{channels.length}</span>
          <span className="sub">Instâncias</span>
        </div>
        <div className="stat-card">
          <span className="stat-num ok-text">{connected}</span>
          <span className="sub">Conectadas</span>
        </div>
        <div className="stat-card">
          <span className="stat-num">{aiOn}</span>
          <span className="sub">Com IA ligada</span>
        </div>
      </div>

      <div className="monitor-grid">
        <div className="card-form">
          <h2>Instâncias</h2>
          {channels.length === 0 ? (
            <p className="sub">Nenhuma instância cadastrada.</p>
          ) : (
            <table className="monitor-table">
              <thead>
                <tr>
                  <th>Canal</th>
                  <th>Instância</th>
                  <th>Status</th>
                  <th>IA</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td className="sub">{c.instanceName}</td>
                    <td>
                      <span className={`badge status-${c.status}`}>
                        {ch.STATUS_LABEL[c.status]}
                      </span>
                    </td>
                    <td>{c.aiEnabled ? '🤖' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card-form">
          <h2>Atividade ao vivo</h2>
          {feed.length === 0 ? (
            <p className="sub">Aguardando mensagens e eventos…</p>
          ) : (
            <ul className="feed">
              {feed.map((f) => (
                <li key={f.id} className={`feed-item ${f.kind}`}>
                  {f.kind === 'message' ? (
                    <>
                      <span className={`dir ${f.direction === 'INBOUND' ? 'in' : 'out'}`}>
                        {f.direction === 'INBOUND' ? '← recebida' : '→ enviada'}
                      </span>
                      <span className="feed-text">{f.text}</span>
                    </>
                  ) : (
                    <span className="feed-text">{f.text}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
