import { useState, type FormEvent } from 'react';
import type { ChatNote, ChatTag, ConversationDetail } from '../lib/chat';

interface Props {
  conversation: ConversationDetail;
  allTags: ChatTag[];
  notes: ChatNote[];
  onAddTag: (tagId: string) => void;
  onRemoveTag: (tagId: string) => void;
  onCreateTag: (name: string) => void;
  onAddNote: (body: string) => void;
}

export function ContactPanel({
  conversation,
  allTags,
  notes,
  onAddTag,
  onRemoveTag,
  onCreateTag,
  onAddNote,
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
