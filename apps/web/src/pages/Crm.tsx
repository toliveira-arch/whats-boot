import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as crm from '../lib/crm';
import type { CrmStage, Lead } from '../lib/crm';
import { listCompanies, type Company } from '../lib/companies';
import { getSocket } from '../lib/socket';
import { ApiError } from '../lib/api';

function stalledLabel(days: number): string {
  if (days <= 0) return 'hoje';
  if (days === 1) return 'há 1 dia';
  return `há ${days} dias`;
}

function LeadCard({
  lead,
  onOpen,
  onDragStart,
}: {
  lead: Lead;
  onOpen: () => void;
  onDragStart: () => void;
}) {
  const digits = (lead.phone ?? '').replace(/\D/g, '');
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <div className="crm-card" draggable onDragStart={onDragStart} onClick={onOpen}>
      <div className="crm-card-top">
        <strong>{lead.name}</strong>
        {lead.stalledDays >= 2 && (
          <span className="crm-stall" title="Sem interação">
            ⏳ {stalledLabel(lead.stalledDays)}
          </span>
        )}
      </div>
      {lead.phone && <div className="sub small">{lead.phone}</div>}
      <div className="crm-tags">
        {lead.campaign && <span className="crm-chip">{lead.campaign}</span>}
        {lead.faturamento && <span className="crm-chip">R$ {lead.faturamento}</span>}
        {lead.interest && <span className="crm-chip">{lead.interest}</span>}
      </div>
      {lead.summary && <div className="crm-summary">{lead.summary}</div>}
      {digits && (
        <div className="crm-card-actions" onClick={stop}>
          <a className="crm-act" href={`tel:+${digits}`} title="Ligar">
            📞
          </a>
          <a
            className="crm-act"
            href={`https://wa.me/${digits}`}
            target="_blank"
            rel="noreferrer"
            title="Abrir no WhatsApp"
          >
            💬
          </a>
        </div>
      )}
    </div>
  );
}

export function Crm() {
  const nav = useNavigate();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [stages, setStages] = useState<CrmStage[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  useEffect(() => {
    listCompanies()
      .then(setCompanies)
      .catch(() => undefined);
    crm
      .listStages()
      .then(setStages)
      .catch(() => undefined);
  }, []);

  const load = useCallback(() => {
    crm
      .listLeads(companyId || undefined, search || undefined)
      .then(setLeads)
      .catch(() => undefined);
  }, [companyId, search]);

  useEffect(() => {
    load();
  }, [load]);

  // Atualiza ao vivo quando algo muda no CRM/conversas.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const reload = () => load();
    socket.on('crm.updated', reload);
    socket.on('lead.updated', reload);
    return () => {
      socket.off('crm.updated', reload);
      socket.off('lead.updated', reload);
    };
  }, [load]);

  async function moveTo(stage: string) {
    if (!dragId) return;
    const id = dragId;
    setDragId(null);
    // Otimista
    setLeads((prev) =>
      prev.map((l) =>
        l.id === id
          ? { ...l, stage, stageLabel: stages.find((s) => s.key === stage)?.label ?? stage }
          : l,
      ),
    );
    try {
      await crm.setStage(id, stage);
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Erro ao mover');
      load();
    }
  }

  const openLead = (id: string) => nav(`/chat?c=${id}`);

  async function doExport() {
    try {
      await crm.downloadCsv(companyId || undefined, search || undefined);
    } catch {
      setMsg('Falha ao exportar CSV');
    }
  }

  const byStage = (key: string) => leads.filter((l) => l.stage === key);

  return (
    <div className="settings wide">
      <div className="page-head">
        <h1>CRM — Funil de leads</h1>
        <div className="row-actions" style={{ margin: 0 }}>
          <button
            className={`btn ${view === 'kanban' ? '' : 'ghost'} sm`}
            onClick={() => setView('kanban')}
          >
            Kanban
          </button>
          <button
            className={`btn ${view === 'list' ? '' : 'ghost'} sm`}
            onClick={() => setView('list')}
          >
            Lista
          </button>
          <button className="btn ghost sm" onClick={() => void doExport()}>
            Exportar CSV
          </button>
        </div>
      </div>

      {msg && <div className="error">{msg}</div>}

      <div className="crm-filters">
        <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
          <option value="">Todas as empresas</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          placeholder="Buscar por nome ou telefone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="sub">{leads.length} leads</span>
      </div>

      {view === 'kanban' ? (
        <div className="crm-board">
          {stages.map((s) => {
            const items = byStage(s.key);
            return (
              <div
                key={s.key}
                className="crm-col"
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => void moveTo(s.key)}
              >
                <div className="crm-col-head">
                  <div className="crm-col-title">
                    <span>{s.label}</span>
                    {s.desc && <span className="crm-col-desc">{s.desc}</span>}
                  </div>
                  <span className="crm-count">{items.length}</span>
                </div>
                <div className="crm-col-body">
                  {items.map((l) => (
                    <LeadCard
                      key={l.id}
                      lead={l}
                      onOpen={() => openLead(l.id)}
                      onDragStart={() => setDragId(l.id)}
                    />
                  ))}
                  {items.length === 0 && <div className="sub small crm-empty">—</div>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <table className="monitor-table crm-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Telefone</th>
              <th>Empresa</th>
              <th>Etapa</th>
              <th>Campanha</th>
              <th>Faturamento</th>
              <th>Parado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id}>
                <td>{l.name}</td>
                <td className="sub">{l.phone ?? '—'}</td>
                <td className="sub">{l.company ?? '—'}</td>
                <td>
                  <select
                    value={l.stage}
                    onChange={(e) => {
                      setDragId(l.id);
                      void moveTo(e.target.value);
                    }}
                  >
                    {stages.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="sub">{l.campaign ?? '—'}</td>
                <td className="sub">{l.faturamento ? `R$ ${l.faturamento}` : '—'}</td>
                <td className="sub">{stalledLabel(l.stalledDays)}</td>
                <td>
                  <button className="btn ghost sm" onClick={() => openLead(l.id)}>
                    Abrir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="crm-footer">
        <div className="crm-foot-item">
          <span className="crm-foot-value">{leads.length}</span>
          <span className="sub">Total de leads</span>
        </div>
        {stages.map((s) => (
          <div key={s.key} className="crm-foot-item">
            <span className="crm-foot-value">{byStage(s.key).length}</span>
            <span className="sub">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
