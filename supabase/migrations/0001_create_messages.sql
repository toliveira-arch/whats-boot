-- =============================================================================
-- Sprint 1 — Tabela única para validar o fluxo de ponta a ponta.
-- Aplique no Supabase: SQL Editor > cole este conteúdo > Run.
-- (ou via CLI: supabase db push)
-- =============================================================================

create table if not exists public.messages (
  id            uuid primary key default gen_random_uuid(),
  instance      text,                       -- nome da instância do Evolution
  remote_jid    text,                       -- JID do WhatsApp (ex: 5511...@s.whatsapp.net)
  push_name     text,                       -- nome exibido do remetente
  from_me       boolean not null default false,
  message_type  text,                       -- conversation, extendedTextMessage, imageMessage...
  content       text,                       -- corpo textual da mensagem
  wa_message_id text,                       -- id da mensagem no WhatsApp (idempotência)
  raw           jsonb,                      -- payload completo do webhook (debug)
  created_at    timestamptz not null default now()
);

-- Evita duplicar a mesma mensagem se o webhook for reenviado.
create unique index if not exists messages_wa_message_id_key
  on public.messages (wa_message_id)
  where wa_message_id is not null;

-- Índice para ordenar por data (o painel lista as mais recentes primeiro).
create index if not exists messages_created_at_idx
  on public.messages (created_at desc);

-- -----------------------------------------------------------------------------
-- RLS: o painel Next.js lê com a `anon key` (somente SELECT).
-- O n8n grava com a `service_role key`, que ignora RLS por padrão.
-- Sprint 1 NÃO tem autenticação — a leitura é pública propositalmente.
-- -----------------------------------------------------------------------------
alter table public.messages enable row level security;

drop policy if exists "sprint1_anon_select" on public.messages;
create policy "sprint1_anon_select"
  on public.messages
  for select
  to anon
  using (true);
