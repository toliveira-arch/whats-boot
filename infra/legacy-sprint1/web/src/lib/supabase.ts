import { createClient } from "@supabase/supabase-js";

// Sprint 1: o painel apenas LÊ a tabela `messages` usando a anon key.
// A escrita é feita exclusivamente pelo n8n com a service_role key.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

// Cliente único e leve para leitura. Se as variáveis não estiverem
// configuradas, expomos `null` para o painel mostrar uma mensagem de setup.
export const supabase = isSupabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: { persistSession: false },
    })
  : null;

export type Message = {
  id: string;
  instance: string | null;
  remote_jid: string | null;
  push_name: string | null;
  from_me: boolean;
  message_type: string | null;
  content: string | null;
  wa_message_id: string | null;
  created_at: string;
};
