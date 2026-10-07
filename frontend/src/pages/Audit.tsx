import React, { useCallback, useEffect, useState } from 'react';
import { ScrollText, Download, Search, Trash2, AlertTriangle, LoaderCircle } from 'lucide-react';
import { api, downloadExport } from '../lib/api';
import type { AuditLog } from '../lib/types';
import { useToast, Badge, EmptyState, Skeleton, ConfirmModal } from '../components/ui';
import { DATE_PRESETS, timeAgo } from '../lib/utils';
import { useAuth } from '../lib/auth';

export default function Audit() {
  const toast = useToast();
  const { hasPermission } = useAuth();
  const canClear = hasPermission('audit.clear');
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [dateKey, setDateKey] = useState('');
  const [action, setAction] = useState('');
  const [total, setTotal] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (q) params.search = q;
      if (dateKey) params.dateKey = dateKey;
      if (action) params.action = action;
      const [l, a] = await Promise.all([api.get<AuditLog[]>('/audit', params), api.get<string[]>('/audit/actions')]);
      setLogs(l); setActions(a);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [q, dateKey, action, toast]);

  const loadCount = useCallback(() => {
    if (!canClear) return;
    api.get<{ ok: boolean; total: number }>('/audit/count')
      .then((r) => setTotal(r.total ?? 0))
      .catch(() => setTotal(null));
  }, [canClear]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [q, dateKey, action]);

  useEffect(() => { loadCount(); }, [loadCount]);

  const runClear = async () => {
    setClearing(true);
    try {
      const res = await api.delete<{ ok: boolean; deleted: number }>('/audit');
      toast(`Cleared ${res.deleted.toLocaleString()} audit log entr${res.deleted === 1 ? 'y' : 'ies'}`);
      setQ(''); setAction(''); setDateKey('');
      await load();
      loadCount();
    } catch (e: any) {
      toast(e.message || 'Failed to clear the audit log', 'error');
    } finally {
      setClearing(false);
    }
  };

  const actionColor = (a: string) =>
    a.includes('delete') || a.includes('deactivate') ? '#ef4444' :
    a.includes('create') ? '#22c55e' :
    a.includes('update') || a.includes('reset') ? '#eab308' : '#6366f1';

  return (
    <div className="max-w-[1100px] mx-auto space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold flex items-center gap-2"><ScrollText size={24} className="text-brand" /> Audit Logs</h1>
          <p className="text-sm text-ink2 mt-0.5">Every action is recorded for compliance and traceability</p>
        </div>
        <div className="flex items-center gap-2">
          {canClear && (
            <button className="btn btn-danger btn-sm" onClick={() => setConfirmClear(true)} disabled={clearing || !total}>
              {clearing ? <LoaderCircle size={14} className="animate-spin" /> : <Trash2 size={14} />}
              Clear Log
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={async () => {
            try { await downloadExport(`/reports/export?type=activity&format=csv&dateKey=${dateKey || '30d'}`, 'audit-logs.csv'); } catch (e: any) { toast(e.message, 'error'); }
          }}>
            <Download size={14} /> Export
          </button>
        </div>
      </div>

      {canClear && (
        <div className="rounded-xl border border-bad/30 bg-bad/10 p-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] font-semibold text-bad flex items-center gap-2">
            <AlertTriangle size={14} className="shrink-0" />
            Clearing the log permanently erases all {total === null ? '' : total.toLocaleString()} entries for every user and
            action. This cannot be undone.
          </p>
          <button className="btn btn-danger btn-sm" onClick={() => setConfirmClear(true)} disabled={clearing || !total}>
            {clearing ? <LoaderCircle size={14} className="animate-spin" /> : <Trash2 size={14} />}
            Permanently Clear Audit Log
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <input className="input !pl-9" placeholder="Search logs..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input !w-auto" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All actions</option>
          {actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="input !w-auto" value={dateKey} onChange={(e) => setDateKey(e.target.value)}>
          <option value="">All dates</option>
          {DATE_PRESETS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
      </div>

      {loading ? <Skeleton className="h-96" /> : logs.length === 0 ? (
        <EmptyState icon={<ScrollText size={26} />} title="No audit logs" subtitle="No logs match your criteria." />
      ) : (
        <div className="card overflow-hidden">
          <div className="table-wrap">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink3 uppercase tracking-wider border-b border-line">
                <th className="px-4 py-3">Time</th><th className="px-4 py-3">User</th><th className="px-4 py-3">Action</th>
                <th className="px-4 py-3 hidden md:table-cell">Entity</th><th className="px-4 py-3">Details</th><th className="px-4 py-3 hidden lg:table-cell">IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-b border-line last:border-0 hover:bg-card2">
                  <td className="px-4 py-2.5 text-ink2 whitespace-nowrap">{timeAgo(l.created_at)}</td>
                  <td className="px-4 py-2.5 font-semibold">{l.user_name || 'System'}</td>
                  <td className="px-4 py-2.5"><Badge color={actionColor(l.action)}>{l.action}</Badge></td>
                  <td className="px-4 py-2.5 text-ink2 hidden md:table-cell">{l.entity_type}{l.entity_id ? ` #${l.entity_id}` : ''}</td>
                  <td className="px-4 py-2.5 text-ink2 max-w-[320px] truncate">{l.details}</td>
                  <td className="px-4 py-2.5 text-ink3 text-xs hidden lg:table-cell">{l.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmClear}
        onClose={() => !clearing && setConfirmClear(false)}
        onConfirm={runClear}
        title="Permanently Clear the Audit Log?"
        danger
        confirmLabel="Yes, Clear Everything"
        message={`This will permanently delete all ${total?.toLocaleString() ?? 0} audit log entries covering every user and action. The trail cannot be restored. The clear operation itself will be recorded as a single new entry.`}
      />
    </div>
  );
}
