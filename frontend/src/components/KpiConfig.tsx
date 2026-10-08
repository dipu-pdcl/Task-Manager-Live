import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Save, X, RefreshCw, RotateCcw, AlertTriangle, Check, HelpCircle } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast, Modal, Switch, Skeleton } from './ui';

interface KpiRule {
  id: number;
  rule_key: string;
  rule_name: string;
  rule_category: string;
  points: number;
  enabled: number;
  description: string;
  created_at: string;
  updated_at: string;
}

interface KpiConfigProps {
  onClose?: () => void;
}

const CATEGORIES = [
  { key: 'task', label: 'Task', color: '#6366f1' },
  { key: 'bonus', label: 'Bonus', color: '#22c55e' },
  { key: 'penalty', label: 'Penalty', color: '#ef4444' },
  { key: 'daily', label: 'Daily', color: '#f97316' },
  { key: 'project', label: 'Project', color: '#a855f7' },
];

export default function KpiConfig({ onClose }: KpiConfigProps) {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const [rules, setRules] = useState<KpiRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<Record<string, { points: number; enabled: boolean; description: string }>>({});
  const [showReset, setShowReset] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const canManage = hasPermission('kpi.manage');

  const loadRules = useCallback(async () => {
    try {
      const res = await api.get<{ rules: KpiRule[] }>('/kpi/config');
      setRules(res.rules);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  const startEdit = (rule: KpiRule) => {
    setEditing(prev => ({
      ...prev,
      [rule.rule_key]: { points: rule.points, enabled: rule.enabled === 1, description: rule.description }
    }));
  };

  const cancelEdit = (ruleKey: string) => {
    setEditing(prev => {
      const next = { ...prev };
      delete next[ruleKey];
      return next;
    });
  };

  const saveRule = async (rule: KpiRule) => {
    const edit = editing[rule.rule_key];
    if (!edit) return;
    setSaving(prev => ({ ...prev, [rule.rule_key]: true }));
    try {
      await api.put(`/kpi/config/${rule.rule_key}`, edit);
      toast(`${rule.rule_name} updated`);
      loadRules();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setSaving(prev => ({ ...prev, [rule.rule_key]: false }));
      cancelEdit(rule.rule_key);
    }
  };

  const handleReset = async () => {
    try {
      await api.post('/kpi/config/reset', {});
      toast('All KPI rules reset to system defaults');
      loadRules();
      setShowReset(false);
      setResetConfirm(false);
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  const rulesByCategory = rules.reduce((acc, rule) => {
    const cat = rule.rule_category || 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(rule);
    return acc;
  }, {} as Record<string, KpiRule[]>);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold flex items-center gap-2">
            <HelpCircle size={22} className="text-brand" /> KPI Configuration
          </h2>
          <p className="text-sm text-ink2 mt-0.5">Manage KPI scoring rules, points, and categories</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn btn-ghost btn-sm"
            onClick={loadRules}
            disabled={loading}
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          {canManage && (
            <>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowReset(true)}
                title="Reset to Defaults"
              >
                <RotateCcw size={14} /> Reset
              </button>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(rulesByCategory).map(([category, catRules]) => {
            const catInfo = CATEGORIES.find(c => c.key === category) || { label: category, color: '#64748b' };
            return (
              <div key={category} className="card p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="px-2 py-0.5 rounded text-xs font-semibold bg-opacity-15"
                    style={{ backgroundColor: catInfo.color + '26', color: catInfo.color }}>
                    {catInfo.label}
                  </span>
                  <span className="text-xs text-ink3">{catRules.length} rules</span>
                </div>
                <div className="space-y-2">
                  {catRules.map(rule => {
                    const isEdit = !!editing[rule.rule_key];
                    const edit = editing[rule.rule_key];
                    return (
                      <div key={rule.rule_key} className="p-3 rounded-lg border border-line bg-card2/50">
                        {isEdit ? (
                          <div className="space-y-3">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{rule.rule_name}</span>
                              <span className="text-xs text-ink3">({rule.rule_key})</span>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                              <div>
                                <label className="label text-xs mb-1">Points</label>
                                <input
                                  type="number"
                                  className="input text-sm"
                                  value={edit.points}
                                  onChange={e => setEditing(prev => ({
                                    ...prev,
                                    [rule.rule_key]: { ...prev[rule.rule_key]!, points: Number(e.target.value) }
                                  }))}
                                  step="1"
                                />
                              </div>
                              <div className="flex items-end">
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <Switch
                                    checked={edit.enabled}
                                    onChange={checked => setEditing(prev => ({
                                      ...prev,
                                      [rule.rule_key]: { ...prev[rule.rule_key]!, enabled: checked }
                                    }))}
                                  />
                                  <span className="text-sm">Enabled</span>
                                </label>
                              </div>
                              <div className="md:col-span-2">
                                <label className="label text-xs mb-1">Description</label>
                                <input
                                  type="text"
                                  className="input text-sm"
                                  value={edit.description}
                                  onChange={e => setEditing(prev => ({
                                    ...prev,
                                    [rule.rule_key]: { ...prev[rule.rule_key]!, description: e.target.value }
                                  }))}
                                />
                              </div>
                            </div>
                            <div className="flex items-center gap-2 pt-2">
                              <button
                                className="btn btn-primary btn-sm"
                                onClick={() => saveRule(rule)}
                                disabled={saving[rule.rule_key]}
                              >
                                {saving[rule.rule_key] ? 'Saving...' : 'Save'}
                              </button>
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => cancelEdit(rule.rule_key)}
                              >
                                <X size={14} /> Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex-1 min-w-[200px]">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{rule.rule_name}</span>
                                <span className="text-xs text-ink3 px-1.5 py-0.5 rounded bg-card2 font-mono">{rule.rule_key}</span>
                              </div>
                              <div className="text-xs text-ink3 mt-0.5">{rule.description}</div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-ink3">Points:</span>
                                <span className={`font-mono font-bold ${rule.points > 0 ? 'text-green-600' : rule.points < 0 ? 'text-red-600' : 'text-ink3'}`}>
                                  {rule.points > 0 ? '+' : ''}{rule.points}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-ink3">Status:</span>
                                {canManage ? (
                                  <Switch
                                    checked={rule.enabled === 1}
                                    onChange={() => startEdit(rule)}
                                  />
                                ) : (
                                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${rule.enabled === 1 ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'}`}>
                                    {rule.enabled === 1 ? 'Enabled' : 'Disabled'}
                                  </span>
                                )}
                              </div>
                              {canManage && (
                                <button
                                  className="btn btn-ghost btn-sm text-xs"
                                  onClick={() => startEdit(rule)}
                                >
                                  Edit
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={showReset} onClose={() => { setShowReset(false); setResetConfirm(false); }} title="Reset KPI Rules to Defaults" width={500}>
        <div className="space-y-4">
          {!resetConfirm ? (
            <>
              <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto" />
              <p className="text-center text-ink2">This will reset all KPI rules to system defaults. Current custom values will be lost.</p>
              <p className="text-xs text-center text-ink3">The defaults are: Self Task: 3, Create Task: 3, Assignee Task: 3, Task Bonus: 1, Create Bonus: 1, Assign Bonus: 1, Overdue Penalty: -3, Incomplete Penalty: -1, Daily Complete: 2, Daily Miss: -1, Project Create: 5, Project Task: 3, Project Overdue: -3</p>
              <div className="flex gap-2 justify-end pt-2">
                <button className="btn btn-ghost" onClick={() => { setShowReset(false); }}>Cancel</button>
                <button className="btn btn-outline" onClick={() => setResetConfirm(true)}>
                  I Understand, Reset
                </button>
              </div>
            </>
          ) : (
            <>
              <Check className="w-12 h-12 text-green-500 mx-auto" />
              <p className="text-center text-ink2">Are you sure? This action cannot be undone.</p>
              <div className="flex gap-2 justify-end pt-2">
                <button className="btn btn-ghost" onClick={() => setResetConfirm(false)}>Go Back</button>
                <button className="btn btn-bad" onClick={handleReset}>Reset All Rules</button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}