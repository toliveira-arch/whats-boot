import type { ConversationListItem } from '../lib/chat';

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

function displayName(c: ConversationListItem): string {
  return c.contact.name || c.contact.pushName || c.contact.phoneNumber || 'Contato';
}

function time(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

interface Props {
  items: ConversationListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  search: string;
  onSearch: (v: string) => void;
  archived: boolean;
  onArchivedChange: (v: boolean) => void;
  loading: boolean;
}

export function ConversationList({
  items,
  selectedId,
  onSelect,
  search,
  onSearch,
  archived,
  onArchivedChange,
  loading,
}: Props) {
  return (
    <aside className="conv-list">
      <div className="conv-search">
        <input
          placeholder="Pesquisar conversa…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>
      <div className="conv-tabs">
        <button className={!archived ? 'active' : ''} onClick={() => onArchivedChange(false)}>
          Ativas
        </button>
        <button className={archived ? 'active' : ''} onClick={() => onArchivedChange(true)}>
          Arquivadas
        </button>
      </div>

      <div className="conv-items">
        {loading && <p className="sub conv-empty">Carregando…</p>}
        {!loading && items.length === 0 && <p className="sub conv-empty">Nenhuma conversa.</p>}
        {items.map((c) => {
          const name = displayName(c);
          return (
            <button
              key={c.id}
              className={`conv-item ${selectedId === c.id ? 'selected' : ''}`}
              onClick={() => onSelect(c.id)}
            >
              <span className="avatar">{initials(name)}</span>
              <span className="conv-main">
                <span className="conv-top">
                  <span className="conv-name">
                    {c.isPinned && <span className="pin">📌</span>} {name}
                  </span>
                  <span className="conv-time">{time(c.lastMessageAt)}</span>
                </span>
                <span className="conv-bottom">
                  <span className="conv-preview">{c.lastMessage?.content ?? '—'}</span>
                  {c.unreadCount > 0 && <span className="unread">{c.unreadCount}</span>}
                </span>
                {c.tags.length > 0 && (
                  <span className="conv-tags">
                    {c.tags.map((t) => (
                      <span
                        key={t.id}
                        className="tag-chip"
                        style={{ borderColor: t.color ?? undefined }}
                      >
                        {t.name}
                      </span>
                    ))}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
