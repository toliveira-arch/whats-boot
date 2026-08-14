import { useEffect, useState, type FormEvent } from 'react';
import type { AiMode, ChatNote, ChatTag, ConversationDetail } from '../lib/chat';
import { listConversationEvents, type ConversationEvent } from '../lib/events';
import { getSocket } from '../lib/socket';

const EVENT_EMOJI: Record<string, string> = {
  qualified: '✅',
  disqualified: '⛔',
  in_progress: '📈',
  handoff: '🤝',
  ai: '🤖',
  conversation: '💬',
};

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}

function Timeline({ conversationId }: { conversationId: string }) {
  const [events, setEvents] = useState<ConversationEvent[]>([]);

  useEffect(() => {
    let active = true;
    listConversationEvents(conversationId)
      .then((e) => active && setEvents(e))
      .catch(() => undefined);

    const socket = getSocket();
    const onActivity = (a: { conversationId?: string } & Partial<ConversationEvent>) => {
      const id = a.id;
      if (a.conversationId !== conversationId || !id) return;
      const next: ConversationEvent = {
        id,
        type: a.type ?? '',
        kind: a.kind ?? 'conversation',
        title: a.title ?? '',
        detail: null,
        actorName: null,
        at: a.at ?? new Date().toISOString(),
      };
      setEvents((prev) => (prev.some((e) => e.id === id) ? prev : [next, ...prev]));
    };
    socket?.on('activity.created', onActivity);
    return () => {
      active = false;
      socket?.off('activity.created', onActivity);
    };
  }, [conversationId]);

  return (
    <div className="cp-section">
      <h3>Linha do tempo</h3>
      {events.length === 0 ? (
        <span className="sub">Sem eventos ainda.</span>
      ) : (
        <ul className="cp-timeline">
          {events.map((e) => (
            <li key={e.id}>
              <span className="cp-tl-ico">{EVENT_EMOJI[e.kind] ?? '•'}</span>
              <div className="cp-tl-body">
                <span className="cp-tl-title">{e.title}</span>
                <span className="sub">
                  {relTime(e.at)}
                  {e.actorName ? ` · ${e.actorName}` : ''}
                  {e.detail ? ` · ${e.detail}` : ''}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface Props {
  conversation: ConversationDetail;
  allTags: ChatTag[];
  notes: ChatNote[];
  onAddTag: (tagId: string) => void;
  onRemoveTag: (tagId: string) => void;
  onCreateTag: (name: string) => void;
  onAddNote: (body: string) => void;
  onSetAiMode: (mode: AiMode) => void;
  onToggleAiEnabled: (enabled: boolean | null) => void;
  onResetMemory: () => void;
  onResetNumber: () => void;
}

export function ContactPanel({
  conversation,
  allTags,
  notes,
  onAddTag,
  onRemoveTag,
  onCreateTag,
  onAddNote,
  onSetAiMode,
  onToggleAiEnabled,
  onResetMemory,
  onResetNumber,
}: Props) {
  const [newTag, setNewTag] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const c = conversation.contact;
  const usedIds = new Set(conversation.tags.map((t) => t.id));
  const available = allTags.filter((t) => !usedIds.has(t.id));

  function submitTag(e: FormEvent) {
    e.preventDefault();
    const name = newTag.trim();
    if (name) onCreateTag(name);
    setNewTag('');
  }

  function submitNote(e: FormEvent) {
    e.preventDefault();
    const body = noteBody.trim();
    if (body) onAddNote(body);
    setNoteBody('');
  }

  return (
    <aside className="contact-panel">
      <div className="cp-section">
        <div className="cp-avatar">{(c.name || c.pushName || 'C').slice(0, 1).toUpperCase()}</div>
        <div className="cp-name">{c.name || c.pushName || 'Contato'}</div>
        <div className="sub">{c.phoneNumber}</div>
      </div>

      {conversation.leadVerdict && (
        <div className="cp-section">
          <h3>Qualificação (SDR)</h3>
          <span className={`badge lead-${conversation.leadVerdict}`}>
            {conversation.leadVerdict === 'QUALIFIED'
              ? 'Qualificado (MQL)'
              : conversation.leadVerdict === 'DISQUALIFIED'
                ? 'Não qualificado'
                : 'Em qualificação'}
          </span>
          {conversation.qualification && (
            <div className="lead-card">
              {conversation.qualification.campaignName && (
                <div className="lead-row">
                  <span className="sub">Campanha</span>
                  <strong>{conversation.qualification.campaignName}</strong>
                </div>
              )}
              {(conversation.qualification.interest || conversation.qualification.urgency) && (
                <div className="lead-row">
                  <span className="sub">Interesse / Urgência</span>
                  <strong>
                    {conversation.qualification.interest ?? '—'} /{' '}
                    {conversation.qualification.urgency ?? '—'}
                  </strong>
                </div>
              )}
              {Object.entries(conversation.qualification.collected ?? {}).map(([k, v]) => (
                <div key={k} className="lead-row">
                  <span className="sub">{k}</span>
                  <strong>{String(v)}</strong>
                </div>
              ))}
              {conversation.qualification.summary && (
                <p className="lead-summary">{conversation.qualification.summary}</p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="cp-section">
        <h3>Robô de IA nesta conversa</h3>
        <label className="ai-toggle">
          <input
            type="checkbox"
            checked={conversation.aiEnabled !== false}
            onChange={(e) => onToggleAiEnabled(e.target.checked ? null : false)}
          />
          <span>{conversation.aiEnabled === false ? 'Desligado (manual)' : 'Ligado'}</span>
        </label>
        <select
          className="cp-select"
          value={conversation.aiMode}
          disabled={conversation.aiEnabled === false}
          onChange={(e) => onSetAiMode(e.target.value as AiMode)}
        >
          <option value="OFF">Modo: usar padrão do agente</option>
          <option value="COPILOT">Modo: Copiloto (sugere)</option>
          <option value="AUTOPILOT">Modo: Autopilot (responde)</option>
        </select>
        <button
          type="button"
          className="btn ghost sm"
          style={{ marginTop: 8 }}
          onClick={() => {
            if (
              window.confirm(
                'Limpar a memória desta conversa? Apaga o histórico que a IA lê e zera a qualificação (para testar variações de prompt).',
              )
            )
              onResetMemory();
          }}
        >
          🧹 Limpar memória (teste)
        </button>
        <button
          type="button"
          className="btn ghost sm"
          style={{ marginTop: 8 }}
          onClick={() => {
            if (
              window.confirm(
                `Resetar o número ${c.phoneNumber ?? ''}? Encerra e oculta TODAS as conversas ativas deste número, liberando-o para ser atendido como lead novo no próximo disparo (teste ou real). Os dados ficam no banco (auditoria), mas somem da operação.`,
              )
            )
              onResetNumber();
          }}
        >
          ♻️ Resetar número (teste)
        </button>
      </div>

      <Timeline conversationId={conversation.id} />

      <div className="cp-section">
        <h3>Etiquetas</h3>
        <div className="cp-tags">
          {conversation.tags.length === 0 && <span className="sub">Nenhuma etiqueta</span>}
          {conversation.tags.map((t) => (
            <span key={t.id} className="tag-chip" style={{ borderColor: t.color ?? undefined }}>
              {t.name}
              <button className="tag-x" onClick={() => onRemoveTag(t.id)}>
                ×
              </button>
            </span>
          ))}
        </div>
        {available.length > 0 && (
          <select
            className="cp-select"
            value=""
            onChange={(e) => e.target.value && onAddTag(e.target.value)}
          >
            <option value="">+ Adicionar etiqueta…</option>
            {available.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        <form className="cp-inline" onSubmit={submitTag}>
          <input
            placeholder="Nova etiqueta"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
          />
          <button type="submit">Criar</button>
        </form>
      </div>

      <div className="cp-section">
        <h3>Notas internas</h3>
        <form className="cp-note-form" onSubmit={submitNote}>
          <textarea
            placeholder="Escreva uma nota (visível só para a equipe)…"
            value={noteBody}
            onChange={(e) => setNoteBody(e.target.value)}
          />
          <button type="submit" className="btn">
            Adicionar nota
          </button>
        </form>
        <div className="cp-notes">
          {notes.length === 0 && <span className="sub">Sem notas.</span>}
          {notes.map((n) => (
            <div key={n.id} className="cp-note">
              <div className="cp-note-body">{n.body}</div>
              <div className="sub">
                {n.authorName ?? 'Equipe'} ·{' '}
                {new Date(n.createdAt).toLocaleString('pt-BR', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
