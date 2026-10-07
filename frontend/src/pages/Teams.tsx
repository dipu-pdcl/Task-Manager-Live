import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Users as UsersIcon, Search } from 'lucide-react';
import { api } from '../lib/api';
import type { Team, User } from '../lib/types';
import { Modal, ConfirmModal, useToast, EmptyState, Skeleton } from '../components/ui';

export default function Teams() {
  const toast = useToast();
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Team | null>(null);
  const [delTarget, setDelTarget] = useState<Team | null>(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ name: '', description: '', lead_id: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, u] = await Promise.all([api.get<Team[]>('/teams'), api.get<User[]>('/users')]);
      setTeams(t); setUsers(u);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const openForm = (t?: Team) => {
    setEditing(t || null);
    setForm(t ? { name: t.name, description: t.description || '', lead_id: String(t.lead_id || '') } : { name: '', description: '', lead_id: '' });
    setFormOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) return toast('Team name is required', 'error');
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        lead_id: form.lead_id ? Number(form.lead_id) : null,
      };
      if (editing) { await api.put(`/teams/${editing.id}`, payload); toast('Team updated'); }
      else { await api.post('/teams', payload); toast('Team created'); }
      setFormOpen(false); load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter((t) =>
      t.name.toLowerCase().includes(q) ||
      String(t.id).includes(q) ||
      (t.description || '').toLowerCase().includes(q) ||
      (t.lead_name || '').toLowerCase().includes(q)
    );
  }, [teams, search]);

  return (
    <div className="max-w-[1100px] mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold flex items-center gap-2"><UsersIcon size={24} className="text-brand" /> Teams</h1>
          <p className="text-sm text-ink2 mt-0.5">{teams.length} teams configured</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
            <input
              type="text"
              placeholder="Search teams..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-9 py-1.5 text-xs w-48 sm:w-60"
            />
          </div>
          <button className="btn btn-primary" onClick={() => openForm()}><Plus size={16} /> New Team</button>
        </div>
      </div>

      {loading ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32" />)}</div> :
      filtered.length === 0 ? <EmptyState icon={<UsersIcon size={26} />} title="No teams found" subtitle={search ? 'Try adjusting your search query' : 'Create your first team.'} /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((t) => (
            <div key={t.id} className="card card-hover p-4 anim-in border border-line flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="px-2 py-0.5 rounded-md bg-brand/10 text-brand text-xs font-mono font-extrabold">
                      #{t.id}
                    </span>
                    <h3 className="font-bold text-ink truncate text-sm">{t.name}</h3>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button className="p-1.5 rounded-lg hover:bg-card2 text-ink2" title="Edit team" onClick={() => openForm(t)}><Pencil size={14} /></button>
                    <button className="p-1.5 rounded-lg hover:bg-bad/10 text-ink2 hover:text-bad" title="Delete team" onClick={() => setDelTarget(t)}><Trash2 size={14} /></button>
                  </div>
                </div>
                <p className="text-xs text-ink2 line-clamp-2 min-h-[2rem] leading-relaxed">{t.description || 'No description provided'}</p>
              </div>
              <div className="flex items-center gap-2 mt-3 text-[11px] flex-wrap pt-2 border-t border-line/50">
                <span className="chip !py-0.5 !text-[11px]">{t.member_count} members</span>
                <span className="chip !py-0.5 !text-[11px]">{t.done_count}/{t.task_count} done</span>
                {t.lead_name && <span className="chip !py-0.5 !text-[11px] text-brand">Lead: {t.lead_name}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? `Edit Team (#${editing.id})` : 'Create Team'}
        footer={<><button className="btn btn-ghost" onClick={() => setFormOpen(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>{editing ? 'Save' : 'Create'}</button></>}>
        <div className="space-y-4">
          <div>
            <label className="label">Team Name *</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Infrastructure" />
          </div>
          <div>
            <label className="label">Description</label>
            <textarea className="input textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Responsibilities and scope" />
          </div>
          <div>
            <label className="label">Team Lead</label>
            <select className="input" value={form.lead_id} onChange={(e) => setForm({ ...form, lead_id: e.target.value })}>
              <option value="">None</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </div>
      </Modal>

      <ConfirmModal open={!!delTarget} onClose={() => setDelTarget(null)} onConfirm={async () => { await api.delete(`/teams/${delTarget!.id}`); toast('Team deleted'); load(); }}
        title="Delete team?" message={`Delete "${delTarget?.name}"? Users assigned to this team will become unassigned.`} confirmLabel="Delete" danger />
    </div>
  );
}

