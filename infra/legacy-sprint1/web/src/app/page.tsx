import { supabase, isSupabaseConfigured, type Message } from "@/lib/supabase";
import { AutoRefresh } from "./auto-refresh";

// Sempre buscar dados frescos (nada de cache) — é um painel de validação.
export const dynamic = "force-dynamic";

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default async function Home() {
  if (!isSupabaseConfigured || !supabase) {
    return (
      <main className="container">
        <div className="header">
          <h1>📥 Mensagens recebidas</h1>
        </div>
        <div className="setup">
          <p>Supabase não configurado.</p>
          <p>
            Crie <code>web/.env.local</code> com{" "}
            <code>NEXT_PUBLIC_SUPABASE_URL</code> e{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> e reinicie o servidor.
          </p>
        </div>
      </main>
    );
  }

  const { data, error } = await supabase
    .from("messages")
    .select(
      "id, instance, remote_jid, push_name, from_me, message_type, content, wa_message_id, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(100);

  const messages = (data ?? []) as Message[];

  return (
    <main className="container">
      <AutoRefresh />
      <div className="header">
        <h1>📥 Mensagens recebidas</h1>
        <span className="badge">
          <span className="dot" /> ao vivo — atualiza a cada 5s
        </span>
      </div>
      <p className="subtitle">
        Sprint 1 · WhatsApp → Evolution API → n8n → Supabase → este painel ·{" "}
        {messages.length} mensagem(ns)
      </p>

      {error && (
        <div className="setup">
          <p>Erro ao ler do Supabase:</p>
          <p>
            <code>{error.message}</code>
          </p>
        </div>
      )}

      {!error && messages.length === 0 && (
        <div className="empty">
          <p>Nenhuma mensagem ainda.</p>
          <p>Envie uma mensagem no WhatsApp conectado à instância do Evolution.</p>
        </div>
      )}

      <div className="list">
        {messages.map((m) => (
          <article key={m.id} className={`msg ${m.from_me ? "out" : "in"}`}>
            <div className="msg-top">
              <div>
                <span className="msg-name">
                  {m.push_name || (m.from_me ? "Eu" : "Contato")}
                </span>{" "}
                <span className="msg-jid">{m.remote_jid}</span>
              </div>
              <span className="msg-time">{formatTime(m.created_at)}</span>
            </div>
            <div className="msg-body">{m.content || <em>(sem texto)</em>}</div>
            <div className="msg-meta">
              {m.instance && <span className="tag">instância: {m.instance}</span>}
              {m.message_type && <span className="tag">{m.message_type}</span>}
              <span className="tag">{m.from_me ? "enviada" : "recebida"}</span>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
