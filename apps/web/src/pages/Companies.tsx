import { useEffect, useState, type FormEvent } from 'react';
import * as co from '../lib/companies';
import type { Company, CompanyInput } from '../lib/companies';
import { ApiError } from '../lib/api';

const EMPTY: CompanyInput = {
  name: '',
  document: '',
  email: '',
  phone: '',
  closerName: '',
  closerPhone: '',
};

export function Companies() {
  const [items, setItems] = useState<Company[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CompanyInput>({ ...EMPTY });
  const [msg, setMsg] = useState<string | null>(null);

  const load = () =>
    co
      .listCompanies()
      .then(setItems)
      .catch(() => undefined);

  useEffect(() => {
    load();
  }, []);

  function set<K extends keyof CompanyInput>(key: K, value: CompanyInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function startNew() {
    setEditingId(null);
    setForm({ ...EMPTY });
    setMsg(null);
  }

  function startEdit(c: Company) {
    setEditingId(c.id);
    setForm({
      name: c.name,
      legalName: c.legalName ?? '',
      document: c.document ?? '',
      email: c.email ?? '',
      phone: c.phone ?? '',
      closerName: c.closerName ?? '',
      closerPhone: c.closerPhone ?? '',
    });
    setMsg(null);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      if (editingId) await co.updateCompany(editingId, form);
      else await co.createCompany(form);
      await load();
      startNew();
      setMsg('Empresa salva ✅');
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Erro ao salvar');
    }
  }

  async function remove(c: Company) {
    if (!window.confirm(`Excluir a empresa "${c.name}"?`)) return;
    await co.deleteCompany(c.id);
    if (editingId === c.id) startNew();
    await load();
  }

  return (
    <div className="settings">
      <h1>Empresas (clientes)</h1>
      {msg && (
        <div className="error" style={{ borderColor: 'var(--accent)' }}>
          {msg}
        </div>
      )}

      <form className="card-form" onSubmit={save}>
        <h2>{editingId ? 'Editar empresa' : 'Nova empresa'}</h2>
        <div className="grid2">
          <label className="field">
            <span>Nome *</span>
            <input value={form.name} onChange={(e) => set('name', e.target.value)} required />
          </label>
          <label className="field">
            <span>CNPJ</span>
            <input value={form.document ?? ''} onChange={(e) => set('document', e.target.value)} />
          </label>
          <label className="field">
            <span>E-mail</span>
            <input value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} />
          </label>
          <label className="field">
            <span>Telefone</span>
            <input value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
          </label>
        </div>

        <h3>Closer (recebe os leads qualificados)</h3>
        <div className="grid2">
          <label className="field">
            <span>Nome do closer</span>
            <input
              value={form.closerName ?? ''}
              onChange={(e) => set('closerName', e.target.value)}
            />
          </label>
          <label className="field">
            <span>WhatsApp do closer (com DDI, ex: 5511999998888)</span>
            <input
              value={form.closerPhone ?? ''}
              onChange={(e) => set('closerPhone', e.target.value)}
              placeholder="5511999998888"
            />
          </label>
        </div>

        <div className="row-actions">
          <button type="submit" className="btn">
            {editingId ? 'Salvar alterações' : 'Cadastrar empresa'}
          </button>
          {editingId && (
            <button type="button" className="btn ghost" onClick={startNew}>
              Cancelar
            </button>
          )}
        </div>
      </form>

      <div className="card-form">
        <h2>Empresas cadastradas</h2>
        {items.length === 0 ? (
          <p className="sub">Nenhuma empresa ainda.</p>
        ) : (
          <table className="monitor-table">
            <thead>
              <tr>
                <th>Empresa</th>
                <th>Closer</th>
                <th>WhatsApp closer</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td className="sub">{c.closerName ?? '—'}</td>
                  <td className="sub">{c.closerPhone ?? '—'}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn ghost sm" onClick={() => startEdit(c)}>
                        Editar
                      </button>
                      <button className="btn danger sm" onClick={() => void remove(c)}>
                        Excluir
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
