import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Building2, Search, PhoneCall, UserCheck } from 'lucide-react';
import { api } from '../lib/api';
import type { Department, User } from '../lib/types';
import { Modal, ConfirmModal, useToast, EmptyState, Skeleton } from '../components/ui';
import { HotlineBadge } from '../components/HotlineBadge';

export default function Departments() {
  const toast = useToast();
  const [depts, setDepts] = useState<Department[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [delTarget, setDelTarget] = useState<Department | null>(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ id: '', name: '', head_id: '', hotline: '', manager_name: '', manager_ext: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, u] = await Promise.all([api.get<Department[]>('/departments'), api.get<User[]>('/users')]);
      setDepts(d); setUsers(u);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const openForm = (d?: Department) => {
    setEditing(d || null);
    if (d) {
      let hotline = d.hotline || '';
      if (!hotline && d.hotline_ext) {
        const parts = d.hotline_ext.split(/,\s*Ext:\s*/i);
        hotline = parts[0]?.trim() || '';
      }
      setForm({
        id: String(d.id),
        name: d.name,
        head_id: String(d.head_id || ''),
        hotline,
        manager_name: d.manager_name || '',
        manager_ext: d.manager_ext || '',
      });
    } else {
      setForm({ id: '', name: '', head_id: '', hotline: '', manager_name: '', manager_ext: '' });
    }
    setFormOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) return toast('Name is required', 'error');
    try {
      const payload: any = {
        name: form.name.trim(),
        head_id: form.head_id ? Number(form.head_id) : null,
        hotline: form.hotline.trim(),
        manager_name: form.manager_name.trim(),
        manager_ext: form.manager_ext.trim(),
      };
      if (!editing && form.id.trim()) {
        payload.id = Number(form.id.trim());
      }
      if (editing) {
        await api.put(`/departments/${editing.id}`, payload);
        toast('Branch updated');
      } else {
        await api.post('/departments', payload);
        toast('Branch created');
      }
      setFormOpen(false);
      load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return depts;
    return depts.filter((d) =>
      d.name.toLowerCase().includes(q) ||
      String(d.id).includes(q) ||
      (d.head_name || '').toLowerCase().includes(q) ||
      (d.hotline || '').toLowerCase().includes(q) ||
      (d.hotline_ext || '').toLowerCase().includes(q) ||
      (d.manager_name || '').toLowerCase().includes(q) ||
      (d.manager_ext || '').toLowerCase().includes(q)
    );
  }, [depts, search]);

  return (
    <div className="max-w-[1100px] mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold flex items-center gap-2"><Building2 size={24} className="text-brand" /> Branches</h1>
          <p className="text-sm text-ink2 mt-0.5">{depts.length} branches registered in system</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
            <input
              type="text"
              placeholder="Search by name, ID, manager, hotline, ext..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-9 py-1.5 text-xs w-48 sm:w-64"
            />
          </div>
          <button className="btn btn-primary" onClick={() => openForm()}><Plus size={16} /> New Branch</button>
        </div>
      </div>

      {loading ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32" />)}</div> :
      filtered.length === 0 ? <EmptyState icon={<Building2 size={26} />} title="No branches found" subtitle={search ? 'Try adjusting your search query' : 'Create your first branch.'} /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((d) => (
            <div key={d.id} className="card card-hover p-4 anim-in border border-line flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="px-2 py-0.5 rounded-md bg-brand/10 text-brand text-xs font-mono font-extrabold" title={`Branch ID: ${d.id}`}>
                      ID: {d.id}
                    </span>
                    <h3 className="font-bold text-ink truncate text-sm">{d.name}</h3>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button className="p-1.5 rounded-lg hover:bg-card2 text-ink2" title="Edit branch" onClick={() => openForm(d)}><Pencil size={14} /></button>
                    <button className="p-1.5 rounded-lg hover:bg-bad/10 text-ink2 hover:text-bad" title="Delete branch" onClick={() => setDelTarget(d)}><Trash2 size={14} /></button>
                  </div>
                </div>

                <HotlineBadge
                  hotline={d.hotline || d.hotline_ext}
                  branchName={d.name}
                  variant="card"
                  className="mt-2.5"
                />

                {/* Branch Manager and Manager EXT */}
                {(d.manager_name || d.manager_ext) && (
                  <div className="mt-2 p-2 rounded-lg bg-card2/60 border border-line/60 flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-6 h-6 rounded-md bg-brand/10 text-brand flex items-center justify-center font-bold text-xs shrink-0">
                        {d.manager_name ? d.manager_name.charAt(0).toUpperCase() : <UserCheck size={12} />}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[10px] text-ink3 font-medium uppercase tracking-wider flex items-center gap-1">
                          <UserCheck size={10} className="text-brand shrink-0" /> Manager
                        </div>
                        <div className="font-semibold text-ink1 text-xs truncate" title={d.manager_name || ''}>
                          {d.manager_name || <span className="text-ink3 italic">Not named</span>}
                        </div>
                      </div>
                    </div>
                    {d.manager_ext && (
                      <div className="text-right shrink-0">
                        <div className="text-[10px] text-ink3 font-medium uppercase tracking-wider flex items-center justify-end gap-1">
                          <PhoneCall size={9} className="text-emerald-600 dark:text-emerald-400 shrink-0" /> EXT
                        </div>
                        <a
                          href={`tel:${d.manager_ext.replace(/[^0-9+]/g, '')}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-mono font-bold text-xs text-brand hover:underline px-1.5 py-0.5 rounded bg-brand/10 inline-block transition-colors"
                          title={`Click to call Manager: ${d.manager_ext}`}
                        >
                          {d.manager_ext}
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 mt-3 text-[11px] flex-wrap pt-2 border-t border-line/50">
                <span className="chip !py-0.5 !text-[11px]">{d.member_count} members</span>
                <span className="chip !py-0.5 !text-[11px]">{d.done_count}/{d.task_count} done</span>
                {d.head_name && <span className="chip !py-0.5 !text-[11px] text-brand">Head: {d.head_name}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? `Edit Branch (ID: ${editing.id})` : 'Create Branch'}
        footer={<><button className="btn btn-ghost" onClick={() => setFormOpen(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>{editing ? 'Save' : 'Create'}</button></>}>
        <div className="space-y-4">
          {!editing && (
            <div>
              <label className="label">Branch ID (Optional)</label>
              <input type="number" className="input font-mono" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder="Auto-generated if left blank" />
              <p className="text-[11px] text-ink3 mt-1">Specify an exact numeric branch ID or leave blank for auto-assignment.</p>
            </div>
          )}
          <div>
            <label className="label">Branch Name *</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Dhanmondi" />
          </div>

          <div>
            <label className="label flex items-center gap-1.5 font-semibold text-ink1">
              <PhoneCall size={13} className="text-emerald-600 dark:text-emerald-400" /> Branch Hotline
            </label>
            <input
              className="input font-mono"
              value={form.hotline}
              onChange={(e) => setForm({ ...form, hotline: e.target.value })}
              placeholder="e.g. 09613-787801"
            />
            <p className="text-[11px] text-ink3 mt-1">Direct branch hotline phone number.</p>
          </div>

          {/* Branch Manager & Manager EXT Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-card2/50 border border-line/70">
            <div>
              <label className="label flex items-center gap-1.5 font-semibold text-ink1">
                <UserCheck size={13} className="text-brand" /> Branch Manager
              </label>
              <input
                className="input"
                value={form.manager_name}
                onChange={(e) => setForm({ ...form, manager_name: e.target.value })}
                placeholder="e.g. Mohammad Rahim"
              />
              <p className="text-[11px] text-ink3 mt-1">Full name of the branch manager.</p>
            </div>
            <div>
              <label className="label flex items-center gap-1.5 font-semibold text-ink1">
                <PhoneCall size={13} className="text-emerald-600 dark:text-emerald-400" /> Manager EXT
              </label>
              <input
                className="input font-mono"
                value={form.manager_ext}
                onChange={(e) => setForm({ ...form, manager_ext: e.target.value })}
                placeholder="e.g. 101 or 017XXXXXXXX"
              />
              <p className="text-[11px] text-ink3 mt-1">Manager's direct extension or hotline number.</p>
            </div>
          </div>

          <div>
            <label className="label">Branch Head / In-Charge</label>
            <select className="input" value={form.head_id} onChange={(e) => setForm({ ...form, head_id: e.target.value })}>
              <option value="">None</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </div>
      </Modal>

      <ConfirmModal open={!!delTarget} onClose={() => setDelTarget(null)} onConfirm={async () => { await api.delete(`/departments/${delTarget!.id}`); toast('Branch deleted'); load(); }}
        title="Delete branch?" message={`Delete "${delTarget?.name}" (ID: ${delTarget?.id})? Users assigned to this branch will become unassigned.`} confirmLabel="Delete" danger />
    </div>
  );
}
