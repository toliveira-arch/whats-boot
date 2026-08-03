import { logger } from '../../lib/logger';

/** Monta a base da API v4 do Kommo a partir do subdomínio (ou host completo). */
function apiBase(subdomain: string): string {
  const s = subdomain
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  const host = s.includes('.') ? s : `${s}.kommo.com`;
  return `https://${host}/api/v4`;
}

async function kommoGet<T>(subdomain: string, token: string, path: string): Promise<T | null> {
  try {
    const res = await fetch(`${apiBase(subdomain)}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      logger.warn({ status: res.status, path }, 'kommo api: resposta não-ok');
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    logger.warn({ err, path }, 'kommo api: falha na requisição');
    return null;
  }
}

interface KommoContact {
  id: number;
  name?: string;
  custom_fields_values?: Array<{
    field_code?: string;
    values?: Array<{ value?: unknown }>;
  }> | null;
}
interface KommoLead {
  id: number;
  name?: string;
  _embedded?: { contacts?: Array<{ id: number; is_main?: boolean }> };
}

function pickField(contact: KommoContact, code: string): string | null {
  const f = (contact.custom_fields_values ?? []).find(
    (x) => (x.field_code ?? '').toUpperCase() === code,
  );
  const v = f?.values?.[0]?.value;
  return v == null || v === '' ? null : String(v);
}

export interface KommoLeadInfo {
  name: string | null;
  phone: string | null;
  email: string | null;
}

/** Busca o contato principal de um lead e extrai nome/telefone/email. */
export async function fetchLeadContact(
  subdomain: string,
  token: string,
  leadId: number,
): Promise<KommoLeadInfo> {
  const lead = await kommoGet<KommoLead>(subdomain, token, `/leads/${leadId}?with=contacts`);
  const contacts = lead?._embedded?.contacts ?? [];
  const main = contacts.find((c) => c.is_main) ?? contacts[0];
  let name = lead?.name ?? null;
  let phone: string | null = null;
  let email: string | null = null;
  if (main) {
    const contact = await kommoGet<KommoContact>(subdomain, token, `/contacts/${main.id}`);
    if (contact) {
      name = contact.name ?? name;
      phone = pickField(contact, 'PHONE');
      email = pickField(contact, 'EMAIL');
    }
  }
  return { name, phone, email };
}

/** Busca um contato diretamente (quando o webhook é de contato). */
export async function fetchContact(
  subdomain: string,
  token: string,
  contactId: number,
): Promise<KommoLeadInfo> {
  const contact = await kommoGet<KommoContact>(subdomain, token, `/contacts/${contactId}`);
  if (!contact) return { name: null, phone: null, email: null };
  return {
    name: contact.name ?? null,
    phone: pickField(contact, 'PHONE'),
    email: pickField(contact, 'EMAIL'),
  };
}
