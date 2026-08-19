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

interface ChannelOption {
  id: string;
  name: string;
}

interface Props {
  items: ConversationListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  search: string;
  onSearch: (v: string) => void;
  archived: boolean;
  onArchivedChange: (v: boolean) => void;
  crmOnly: boolean;
  onCrmOnlyChange: (v: boolean) => void;
  onCleanupOrganic: () => void;
  loading: boolean;
  channels: ChannelOption[];
  channelId: string;
  onChannelChange: (v: string) => void;
}

export function ConversationList({
  items,
  selectedId,
  onSelect,
  search,
  onSearch,
  archived,
  onArchivedChange,
  crmOnly,
  onCrmOnlyChange,
  onCleanupOrganic,
  loading,
  channels,
  channelId,
  onChannelChange,
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
      {channels.length > 1 && (
        <div className="conv-channel-filter">
          <select value={channelId} onChange={(e) => onChannelChange(e.target.value)}>
            <option value="">Todos os canais</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="conv-tabs">
        <button className={!archived ? 'active' : ''} onClick={() => onArchivedChange(false)}>
          Ativas
        </button>
        <button className={archived ? 'active' : ''} onClick={() => onArchivedChange(true)}>
          Arquivadas
        </button>
      </div>
      <div className="conv-tabs">
        <button className={crmOnly ? 'active' : ''} onClick={() => onCrmOnlyChange(true)}>
          Clientes do CRM
        </button>
        <button className={!crmOnly ? 'active' : ''} onClick={() => onCrmOnlyChange(false)}>
          Todos os contatos
        </button>
      </div>
      {!crmOnly && (
        <button
          type="button"
          className="btn ghost sm"
          style={{ margin: '4px 8px' }}
          onClick={() => {
            if (
              window.confirm(
                'Limpar contatos orgânicos? Remove da plataforma TODAS as conversas que não vieram do CRM (contatos que o robô não atendeu), deixando só os leads do CRM. Os dados ficam no banco (auditoria), mas somem das listas. Continuar?',
              )
            )
              onCleanupOrganic();
          }}
        >
          🧹 Limpar contatos orgânicos (não-CRM)
        </button>
      )}

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
                {c.channel && <span className="conv-channel">{c.channel.name}</span>}
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
