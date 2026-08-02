import { useEffect, useRef, useState, type FormEvent, type UIEvent } from 'react';
import type { ChatMessage, ConversationDetail } from '../lib/chat';
import { EmojiPicker } from './EmojiPicker';

function statusTick(status: string): { text: string; className: string } {
  switch (status) {
    case 'SENT':
      return { text: '✓', className: '' };
    case 'DELIVERED':
      return { text: '✓✓', className: '' };
    case 'READ':
      return { text: '✓✓', className: 'read' };
    case 'FAILED':
      return { text: '⚠', className: 'failed' };
    default:
      return { text: '🕓', className: '' };
  }
}

function MessageBubble({ m }: { m: ChatMessage }) {
  const out = m.direction === 'OUTBOUND';
  const tick = statusTick(m.status);
  return (
    <div className={`bubble-row ${out ? 'out' : 'in'}`}>
      <div className="bubble">
        {m.mediaUrl && m.type === 'IMAGE' && (
          <img className="bubble-media" src={m.mediaUrl} alt={m.mediaName ?? 'imagem'} />
        )}
        {m.mediaUrl && m.type === 'VIDEO' && (
          <video className="bubble-media" src={m.mediaUrl} controls />
        )}
        {m.mediaUrl && m.type === 'AUDIO' && <audio src={m.mediaUrl} controls />}
        {m.mediaUrl && m.type === 'DOCUMENT' && (
          <a className="bubble-doc" href={m.mediaUrl} target="_blank" rel="noreferrer">
            📄 {m.mediaName ?? 'documento'}
          </a>
        )}
        {m.type === 'AUDIO' && !m.mediaUrl && m.content && (
          <div className="bubble-audiotag">🎤 áudio transcrito</div>
        )}
        {(m.content || m.caption) && <div className="bubble-text">{m.content ?? m.caption}</div>}
        <div className="bubble-meta">
          {new Date(m.createdAt).toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
          })}
          {out && <span className={`tick ${tick.className}`}>{tick.text}</span>}
        </div>
      </div>
    </div>
  );
}

interface Props {
  conversation: ConversationDetail | null;
  messages: ChatMessage[];
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onSend: (text: string) => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  onResolve: () => void;
  suggestion: string | null;
  onDismissSuggestion: () => void;
}

export function ChatWindow({
  conversation,
  messages,
  hasMore,
  loadingOlder,
  onLoadOlder,
  onSend,
  onTogglePin,
  onToggleArchive,
  onResolve,
  suggestion,
  onDismissSuggestion,
}: Props) {
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevHeightRef = useRef(0);
  const lastIdRef = useRef<string | null>(null);

  // Restaura a posição ao prepender mensagens antigas; rola ao fim em novas.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const last = messages[messages.length - 1]?.id ?? null;
    const isNewTail = last !== lastIdRef.current;
    if (loadingOlder) return;
    if (prevHeightRef.current && el.scrollHeight > prevHeightRef.current && !isNewTail) {
      // veio de "carregar antigas": mantém a posição
      el.scrollTop = el.scrollHeight - prevHeightRef.current;
    } else if (isNewTail) {
      el.scrollTop = el.scrollHeight;
    }
    prevHeightRef.current = el.scrollHeight;
    lastIdRef.current = last;
  }, [messages, loadingOlder]);

  useEffect(() => {
    // ao trocar de conversa, rola para o fim
    lastIdRef.current = null;
    prevHeightRef.current = 0;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversation?.id]);

  function onScroll(e: UIEvent<HTMLDivElement>) {
    if (e.currentTarget.scrollTop < 60 && hasMore && !loadingOlder) {
      prevHeightRef.current = e.currentTarget.scrollHeight;
      onLoadOlder();
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    onSend(value);
    setText('');
    setShowEmoji(false);
  }

  if (!conversation) {
    return (
      <section className="chat-window empty">
        <p className="sub">Selecione uma conversa</p>
      </section>
    );
  }

  const name =
    conversation.contact.name ||
    conversation.contact.pushName ||
    conversation.contact.phoneNumber ||
    'Contato';

  return (
    <section className="chat-window">
      <header className="chat-header">
        <div>
          <strong>{name}</strong>
          <span className="sub"> · {conversation.contact.phoneNumber}</span>
        </div>
        <div className="chat-actions">
          <button title="Fixar" onClick={onTogglePin}>
            {conversation.isPinned ? '📌 Desafixar' : '📌 Fixar'}
          </button>
          <button title="Arquivar" onClick={onToggleArchive}>
            {conversation.isArchived ? 'Desarquivar' : 'Arquivar'}
          </button>
          <button title="Resolver" onClick={onResolve}>
            ✓ Resolver
          </button>
        </div>
      </header>

      <div className="chat-messages" ref={scrollRef} onScroll={onScroll}>
        {hasMore && (
          <div className="load-older">{loadingOlder ? 'Carregando…' : 'Role para ver mais'}</div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} m={m} />
        ))}
      </div>

      {suggestion && (
        <div className="ai-suggestion">
          <span className="ai-badge">IA</span>
          <span className="ai-text">{suggestion}</span>
          <button
            type="button"
            onClick={() => {
              setText(suggestion);
              onDismissSuggestion();
            }}
          >
            Usar
          </button>
          <button type="button" onClick={onDismissSuggestion}>
            Descartar
          </button>
        </div>
      )}

      <form className="composer" onSubmit={submit}>
        <button type="button" className="emoji-toggle" onClick={() => setShowEmoji((v) => !v)}>
          😀
        </button>
        {showEmoji && <EmojiPicker onPick={(e) => setText((t) => t + e)} />}
        <input
          placeholder="Digite uma mensagem…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn">
          Enviar
        </button>
      </form>
    </section>
  );
}
