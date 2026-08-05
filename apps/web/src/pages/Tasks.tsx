import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../lib/tasks';
import type { Assignee, Task } from '../lib/tasks';
import { listLeads, type Lead } from '../lib/crm';
import { listCompanies, type Company } from '../lib/companies';
import { getSocket } from '../lib/socket';
import { ApiError } from '../lib/api';

const DAY_MS = 86_400_000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "hoje 14:00", "amanhã 09:00", "12/08 15:30" */
function dueLabel(iso: string): string {
  const due = new Date(iso);
  const time = due.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((startOfDay(due) - startOfDay(new Date())) / DAY_MS);
  if (days === 0) return `hoje ${time}`;
  if (days === 1) return `amanhã ${time}`;
  if (days === -1) return `ontem ${time}`;
  return `${due.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${time}`;
}

function overdueLabel(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS);
  if (days <= 0) return 'venceu hoje';
  if (days === 1) return 'há 1 dia';
  return `há ${days} dias`;
}

/** Valor inicial do campo prazo: amanhã às 09:00 (formato datetime-local). */
function defaultDue(): string {
  const d = new Date(Date.now() + DAY_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:00`;
}

function TaskCard({
  task,
  onDone,
  onReopen,
  onCancel,
  onDelete,
  onOpenChat,
}: {
  task: Task;
  onDone: () => void;
  onReopen: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onOpenChat: () => void;
}) {
  const pending = task.status === 'PENDING';
  return (
    <div className={`crm-card task-card${task.status === 'DONE' ? ' task-done' : ''}`}>
      <div className="crm-card-top">
        <strong>{task.title}</strong>
        {task.overdue ? (
          <span className="task-overdue" title="Tarefa vencida">
            ⏰ {overdueLabel(task.dueAt)}
          </span>
        ) : (
          pending && <span className="crm-stall">📅 {dueLabel(task.dueAt)}</span>
        )}
      </div>
      <div className="crm-tags">
        {task.contactName && (
          <span className="crm-chip" title={task.contactPhone ?? undefined}>
            👤 {task.contactName}
          </span>
        )}
        {task.companyName && <span className="crm-chip">🏢 {task.companyName}</span>}
        {task.assignedToName && <span className="crm-chip">🙋 {task.assignedToName}</span>}
      </div>
      {task.notes && <div className="crm-summary">{task.notes}</div>}
      <div className="task-card-actions">
        {pending ? (
          <>
            <button className="btn sm" onClick={onDone}>
              ✓ Concluir
            </button>
            <button className="btn ghost sm" onClick={onCancel} title="Cancelar tarefa">
              Cancelar
            </button>
          </>
        ) : (
          <button className="btn ghost sm" onClick={onReopen}>
            ↩ Reabrir
          </button>
        )}
        {task.conversationId && (
          <button className="btn ghost sm" onClick={onOpenChat} title="Abrir a conversa do lead">
            💬 Conversa
          </button>
        )}
        <button className="btn ghost sm task-del" onClick={onDelete} title="Excluir tarefa">
          🗑
        </button>
      </div>
    </div>
  );
}

export function Tasks() {
  const nav = useNavigate();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [companyId, setCompanyId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  // Formulário de nova tarefa
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fTitle, setFTitle] = useState('');
  const [fDue, setFDue] = useState(defaultDue);
  const [fNotes, setFNotes] = useState('');
  const [fCompanyId, setFCompanyId] = useState('');
  const [fAssigneeId, setFAssigneeId] = useState('');
  const [fLeadId, setFLeadId] = useState('');
  const [leads, setLeads] = useState<Lead[]>([]);

  useEffect(() => {
    listCompanies()
      .then(setCompanies)
      .catch(() => undefined);
    api
      .listAssignees()
      .then(setAssignees)
      .catch(() => undefined);
  }, []);

  const load = useCallback(() => {
    api
      .listTasks({
        companyId: companyId || undefined,
        assignedToId: assigneeId || undefined,
        status: statusFilter || undefined,
        q: search || undefined,
      })
      .then(setTasks)
      .catch(() => undefined);
  }, [companyId, assigneeId, statusFilter, search]);

  useEffect(() => {
    load();
  }, [load]);

  // Atualiza ao vivo quando alguém mexe nas tarefas.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const reload = () => load();
    socket.on('tasks.updated', reload);
    return () => {
      socket.off('tasks.updated', reload);
    };
  }, [load]);

  // Leads para vincular a tarefa (respeita a empresa escolhida no formulário).
  useEffect(() => {
    if (!showForm) return;
    listLeads(fCompanyId || undefined)
      .then(setLeads)
      .catch(() => setLeads([]));
  }, [showForm, fCompanyId]);

  async function createTask() {
    if (!fTitle.trim()) {
      setMsg('Informe um título para a tarefa');
      return;
    }
    if (!fDue) {
      setMsg('Informe o prazo da tarefa');
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      await api.createTask({
        title: fTitle.trim(),
        notes: fNotes.trim() || undefined,
        dueAt: new Date(fDue).toISOString(),
        companyId: fCompanyId || undefined,
        conversationId: fLeadId || undefined,
        assignedToId: fAssigneeId || undefined,
      });
      setFTitle('');
      setFNotes('');
      setFLeadId('');
      setFDue(defaultDue());
      setShowForm(false);
      load();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Falha ao criar a tarefa');
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(id: string, status: 'PENDING' | 'DONE' | 'CANCELED') {
    // Otimista
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, status, overdue: status === 'PENDING' ? t.overdue : false } : t,
      ),
    );
    try {
      await api.updateTask(id, { status });
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Falha ao atualizar a tarefa');
      load();
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Excluir esta tarefa?')) return;
    setTasks((prev) => prev.filter((t) => t.id !== id));
    try {
      await api.deleteTask(id);
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Falha ao excluir a tarefa');
      load();
    }
  }

  const openChat = (conversationId: string) => nav(`/chat?c=${conversationId}`);

  const todo = tasks.filter((t) => t.status === 'PENDING' && !t.overdue);
  const overdue = tasks.filter((t) => t.status === 'PENDING' && t.overdue);
  const done = tasks.filter((t) => t.status === 'DONE');
  const dueToday = tasks.filter(
    (t) => t.status === 'PENDING' && startOfDay(new Date(t.dueAt)) === startOfDay(new Date()),
  );

  const columns: { key: string; label: string; desc: string; items: Task[] }[] = [
    { key: 'todo', label: 'A fazer', desc: 'Dentro do prazo', items: todo },
    { key: 'overdue', label: 'Atrasadas', desc: 'Prazo vencido', items: overdue },
    { key: 'done', label: 'Concluídas', desc: 'Trabalho feito', items: done },
  ];

  const statusLabel = (t: Task) =>
    t.status === 'DONE'
      ? 'Concluída'
      : t.status === 'CANCELED'
        ? 'Cancelada'
        : t.overdue
          ? 'Atrasada'
          : 'A fazer';

  const cardActions = (t: Task) => ({
    onDone: () => void setStatus(t.id, 'DONE'),
    onReopen: () => void setStatus(t.id, 'PENDING'),
    onCancel: () => void setStatus(t.id, 'CANCELED'),
    onDelete: () => void remove(t.id),
    onOpenChat: () => t.conversationId && openChat(t.conversationId),
  });

  return (
    <div className="settings wide crm-page">
      <div className="page-head">
        <h1>Painel de tarefas</h1>
        <div className="row-actions" style={{ margin: 0 }}>
          <button
            className={`btn ${view === 'kanban' ? '' : 'ghost'} sm`}
            onClick={() => setView('kanban')}
          >
            Painel
          </button>
          <button
            className={`btn ${view === 'list' ? '' : 'ghost'} sm`}
            onClick={() => setView('list')}
          >
            Lista
          </button>
          <button className="btn sm" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Fechar' : '+ Nova tarefa'}
          </button>
        </div>
      </div>

      {msg && <div className="error">{msg}</div>}

      {showForm && (
        <div className="task-form">
          <div className="task-form-grid">
            <input
              className="task-form-title"
              placeholder="O que precisa ser feito? Ex.: Ligar para o lead e agendar reunião"
              value={fTitle}
              onChange={(e) => setFTitle(e.target.value)}
              autoFocus
            />
            <input
              type="datetime-local"
              value={fDue}
              onChange={(e) => setFDue(e.target.value)}
              title="Prazo"
            />
            <select value={fCompanyId} onChange={(e) => setFCompanyId(e.target.value)}>
              <option value="">Empresa (opcional)</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select value={fLeadId} onChange={(e) => setFLeadId(e.target.value)}>
              <option value="">Vincular a um lead (opcional)</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.phone ? ` — ${l.phone}` : ''}
                </option>
              ))}
            </select>
            <select value={fAssigneeId} onChange={(e) => setFAssigneeId(e.target.value)}>
              <option value="">Responsável (opcional)</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <textarea
              className="task-form-notes"
              placeholder="Detalhes / anotações (opcional)"
              rows={2}
              value={fNotes}
              onChange={(e) => setFNotes(e.target.value)}
            />
          </div>
          <div className="row-actions" style={{ marginTop: 10 }}>
            <button className="btn sm" disabled={saving} onClick={() => void createTask()}>
              {saving ? 'Salvando…' : 'Criar tarefa'}
            </button>
            <button className="btn ghost sm" onClick={() => setShowForm(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="crm-filters">
        <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
          <option value="">Todas as empresas</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
          <option value="">Todos os responsáveis</option>
          {assignees.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {view === 'list' && (
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Todos os status</option>
            <option value="PENDING">A fazer / Atrasadas</option>
            <option value="DONE">Concluídas</option>
            <option value="CANCELED">Canceladas</option>
          </select>
        )}
        <input
          placeholder="Buscar por título, anotação, lead…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="sub">{tasks.length} tarefas</span>
      </div>

      {view === 'kanban' ? (
        <div className="crm-board">
          {columns.map((col) => (
            <div key={col.key} className="crm-col">
              <div className="crm-col-head">
                <div className="crm-col-title">
                  <span>{col.label}</span>
                  <span className="crm-col-desc">{col.desc}</span>
                </div>
                <span className="crm-count">{col.items.length}</span>
              </div>
              <div className="crm-col-body">
                {col.items.map((t) => (
                  <TaskCard key={t.id} task={t} {...cardActions(t)} />
                ))}
                {col.items.length === 0 && <div className="sub small crm-empty">—</div>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <table className="monitor-table crm-table">
          <thead>
            <tr>
              <th>Tarefa</th>
              <th>Prazo</th>
              <th>Status</th>
              <th>Lead</th>
              <th>Empresa</th>
              <th>Responsável</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id} className={t.status === 'DONE' ? 'task-done' : undefined}>
                <td>
                  <strong>{t.title}</strong>
                  {t.notes && <div className="sub small">{t.notes}</div>}
                </td>
                <td className={t.overdue ? 'task-overdue' : 'sub'}>{dueLabel(t.dueAt)}</td>
                <td className="sub">{statusLabel(t)}</td>
                <td className="sub">{t.contactName ?? '—'}</td>
                <td className="sub">{t.companyName ?? '—'}</td>
                <td className="sub">{t.assignedToName ?? '—'}</td>
                <td>
                  <div className="crm-row-actions">
                    {t.status === 'PENDING' ? (
                      <button className="btn ghost sm" onClick={() => void setStatus(t.id, 'DONE')}>
                        ✓ Concluir
                      </button>
                    ) : (
                      <button
                        className="btn ghost sm"
                        onClick={() => void setStatus(t.id, 'PENDING')}
                      >
                        ↩ Reabrir
                      </button>
                    )}
                    {t.conversationId && (
                      <button className="btn ghost sm" onClick={() => openChat(t.conversationId!)}>
                        💬
                      </button>
                    )}
                    <button className="btn ghost sm task-del" onClick={() => void remove(t.id)}>
                      🗑
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {tasks.length === 0 && (
              <tr>
                <td colSpan={7} className="sub" style={{ textAlign: 'center' }}>
                  Nenhuma tarefa encontrada. Crie a primeira com “+ Nova tarefa”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      <div className="crm-footer">
        <div className="crm-foot-item">
          <span className="crm-foot-value">{todo.length + overdue.length}</span>
          <span className="sub">Em aberto</span>
        </div>
        <div className="crm-foot-item">
          <span className="crm-foot-value">{dueToday.length}</span>
          <span className="sub">Para hoje</span>
        </div>
        <div className="crm-foot-item">
          <span className="crm-foot-value">{overdue.length}</span>
          <span className="sub">Atrasadas</span>
        </div>
        <div className="crm-foot-item">
          <span className="crm-foot-value">{done.length}</span>
          <span className="sub">Concluídas</span>
        </div>
      </div>
    </div>
  );
}
