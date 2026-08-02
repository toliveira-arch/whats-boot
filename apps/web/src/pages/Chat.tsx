import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getSocket } from '../lib/socket';
import * as chat from '../lib/chat';
import type {
  ChatMessage,
  ChatNote,
  ChatTag,
  ConversationDetail,
  ConversationListItem,
} from '../lib/chat';
import { listChannels, type Channel } from '../lib/channels';
import { ConversationList } from '../components/ConversationList';
import { ChatWindow } from '../components/ChatWindow';
import { ContactPanel } from '../components/ContactPanel';

export function Chat() {
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelId, setChannelId] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const [allTags, setAllTags] = useState<ChatTag[]>([]);
  const [notes, setNotes] = useState<ChatNote[]>([]);
  const [suggestion, setSuggestion] = useState<string | null>(null);

  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;

  // Deep-link: /chat?c=<conversationId> (usado pelo CRM para abrir a conversa).
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const c = searchParams.get('c');
    if (c) {
      setSelectedId(c);
      searchParams.delete('c');
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      setConversations(
        await chat.listConversations({
          q: search || undefined,
          archived,
          channelId: channelId || undefined,
        }),
      );
    } catch {
      /* ignora */
    } finally {
      setLoadingList(false);
    }
  }, [search, archived, channelId]);

  // Lista + busca (com debounce)
  useEffect(() => {
    const t = setTimeout(loadList, 250);
    return () => clearTimeout(t);
  }, [loadList]);

  // Etiquetas e canais disponíveis
  useEffect(() => {
    chat
      .listTags()
      .then(setAllTags)
      .catch(() => undefined);
    listChannels()
      .then(setChannels)
      .catch(() => undefined);
  }, []);

  const loadMessages = useCallback(async (id: string) => {
    const res = await chat.listMessages(id);
    setMessages(res.messages);
    setNextCursor(res.nextCursor);
  }, []);

  const loadNotes = useCallback((id: string) => {
    chat
      .listNotes(id)
      .then(setNotes)
      .catch(() => undefined);
  }, []);

  // Ao selecionar uma conversa
  useEffect(() => {
    setSuggestion(null);
    if (!selectedId) {
      setConversation(null);
      setMessages([]);
      setNotes([]);
      return;
    }
    let active = true;
    (async () => {
      try {
        const detail = await chat.getConversation(selectedId);
        if (!active) return;
        setConversation(detail);
        await loadMessages(selectedId);
        loadNotes(selectedId);
        await chat.markRead(selectedId);
        void loadList();
      } catch {
        /* ignora */
      }
    })();
    return () => {
      active = false;
    };
  }, [selectedId, loadMessages, loadNotes, loadList]);

  // Tempo real
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onCreated = (payload: { conversationId?: string }) => {
      if (payload.conversationId && payload.conversationId === selectedRef.current) {
        void loadMessages(payload.conversationId);
      }
      void loadList();
    };
    const onStatus = (payload: { conversationId?: string }) => {
      if (payload.conversationId && payload.conversationId === selectedRef.current) {
        void loadMessages(payload.conversationId);
      }
    };
    const onUpdated = () => void loadList();
    const onSuggestion = (payload: { conversationId?: string; content?: string }) => {
      if (payload.conversationId === selectedRef.current) setSuggestion(payload.content ?? null);
    };
    const onLead = (payload: { conversationId?: string }) => {
      if (payload.conversationId === selectedRef.current) {
        chat
          .getConversation(payload.conversationId)
          .then(setConversation)
          .catch(() => undefined);
      }
      void loadList();
    };
    socket.on('message.created', onCreated);
    socket.on('message.status', onStatus);
    socket.on('conversation.updated', onUpdated);
    socket.on('ai.suggestion', onSuggestion);
    socket.on('lead.updated', onLead);
    return () => {
      socket.off('message.created', onCreated);
      socket.off('message.status', onStatus);
      socket.off('conversation.updated', onUpdated);
      socket.off('ai.suggestion', onSuggestion);
      socket.off('lead.updated', onLead);
    };
  }, [loadMessages, loadList]);

  async function onLoadOlder() {
    if (!selectedId || !nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const res = await chat.listMessages(selectedId, nextCursor);
      setMessages((prev) => [...res.messages, ...prev]);
      setNextCursor(res.nextCursor);
    } finally {
      setLoadingOlder(false);
    }
  }

  async function onSend(text: string) {
    if (!selectedId) return;
    await chat.sendMessage(selectedId, text);
    await loadMessages(selectedId);
    void loadList();
  }

  async function patch(p: { status?: string; isPinned?: boolean; isArchived?: boolean }) {
    if (!selectedId) return;
    await chat.updateConversation(selectedId, p);
    setConversation(await chat.getConversation(selectedId));
    void loadList();
  }

  async function refreshDetail() {
    if (!selectedId) return;
    setConversation(await chat.getConversation(selectedId));
    void loadList();
  }

  return (
    <div className="chat-layout">
      <ConversationList
        items={conversations}
        selectedId={selectedId}
        onSelect={setSelectedId}
        search={search}
        onSearch={setSearch}
        archived={archived}
        onArchivedChange={setArchived}
        loading={loadingList}
        channels={channels}
        channelId={channelId}
        onChannelChange={setChannelId}
      />

      <ChatWindow
        conversation={conversation}
        messages={messages}
        hasMore={Boolean(nextCursor)}
        loadingOlder={loadingOlder}
        onLoadOlder={onLoadOlder}
        onSend={onSend}
        onTogglePin={() => patch({ isPinned: !conversation?.isPinned })}
        onToggleArchive={() => patch({ isArchived: !conversation?.isArchived })}
        onResolve={() => patch({ status: 'RESOLVED' })}
        suggestion={suggestion}
        onDismissSuggestion={() => setSuggestion(null)}
      />

      {conversation && (
        <ContactPanel
          conversation={conversation}
          allTags={allTags}
          notes={notes}
          onAddTag={async (tagId) => {
            await chat.addTag(conversation.id, tagId);
            await refreshDetail();
          }}
          onRemoveTag={async (tagId) => {
            await chat.removeTag(conversation.id, tagId);
            await refreshDetail();
          }}
          onCreateTag={async (name) => {
            const tag = await chat.createTag(name);
            setAllTags((prev) => [...prev, tag]);
            await chat.addTag(conversation.id, tag.id);
            await refreshDetail();
          }}
          onAddNote={async (body) => {
            await chat.addNote(conversation.id, body);
            loadNotes(conversation.id);
          }}
          onSetAiMode={async (mode) => {
            await chat.updateConversation(conversation.id, { aiMode: mode });
            await refreshDetail();
          }}
          onToggleAiEnabled={async (enabled) => {
            await chat.updateConversation(conversation.id, { aiEnabled: enabled });
            await refreshDetail();
          }}
          onResetMemory={async () => {
            await chat.resetConversation(conversation.id);
            await loadMessages(conversation.id);
            await refreshDetail();
          }}
        />
      )}
    </div>
  );
}
