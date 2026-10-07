import React, { useEffect, useState, useMemo } from 'react';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Plus,
  Pencil,
  Trash2,
  Users,
  Check,
  X,
  Lock,
  Sparkles,
  Info,
  CheckSquare,
  Square,
  HelpCircle,
  RotateCcw,
  Save,
  Tag,
  Search,
  Layers,
  ArrowRight,
  Award
} from 'lucide-react';
import { api } from '../lib/api';
import type { RoleGroup, PermissionModule, PermissionItem } from '../lib/types';
import { useAuth } from '../lib/auth';
import { Modal, ConfirmModal, useToast, Badge } from './ui';
import { cx } from '../lib/utils';

const COLOR_PALETTE = [
  '#dc2626', // Red
  '#ea580c', // Orange
  '#d97706', // Amber
  '#16a34a', // Green
  '#0d9488', // Teal
  '#0284c7', // Light Blue
  '#2563eb', // Blue
  '#6366f1', // Indigo
  '#7c3aed', // Purple
  '#c026d3', // Fuchsia
  '#db2777', // Pink
  '#475569', // Slate
];

export default function RolePermissionManager() {
  const toast = useToast();
  const { user: me, isSuper, hasPermission } = useAuth();
  const canManageRoles = isSuper || hasPermission('roles.manage');

  const [groups, setGroups] = useState<RoleGroup[]>([]);
  const [modules, setModules] = useState<PermissionModule[]>([]);
  const [allPermIds, setAllPermIds] = useState<string[]>([]);
  const [defaultGroupId, setDefaultGroupId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'groups' | 'catalog'>('groups');
  const [searchQuery, setSearchQuery] = useState('');

  // Modal State for Create / Edit
  const [modalOpen, setModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<RoleGroup | null>(null);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formColor, setFormColor] = useState('#6366f1');
  const [formPerms, setFormPerms] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  // Delete State
  const [deleteTarget, setDeleteTarget] = useState<RoleGroup | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Default Group Modal / Selector
  const [savingDefault, setSavingDefault] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [groupsRes, permsRes, defRes] = await Promise.all([
        api.get<RoleGroup[]>('/settings/role-groups'),
        api.get<{ modules: PermissionModule[]; all_permission_ids: string[] }>('/settings/permissions'),
        api.get<{ default_role_group_id: number }>('/settings/default-role-group'),
      ]);
      const validGroups = (groupsRes || []).filter((g) => g.slug !== 'super_admin');
      setGroups(validGroups);
      setModules(permsRes.modules || []);
      setAllPermIds(permsRes.all_permission_ids || []);
      setDefaultGroupId(defRes?.default_role_group_id ?? null);
    } catch (err: any) {
      toast(err.message || 'Failed to load role groups', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  if (!canManageRoles) {
    return (
      <div className="p-8 rounded-2xl bg-card border border-line text-center space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-red-500/10 text-red-500 flex items-center justify-center mx-auto">
          <ShieldAlert size={24} />
        </div>
        <h3 className="font-bold text-lg text-ink1">Role Management Access Required</h3>
        <p className="text-xs text-ink3 max-w-md mx-auto">
          Role & permission group definitions and security policy matrices require assigned role management permissions.
        </p>
      </div>
    );
  }

  const openCreateModal = () => {
    setEditingGroup(null);
    setFormName('');
    setFormDesc('');
    setFormColor('#6366f1');
    // Default with basic view permissions
    const defaults = new Set<string>([
      'dashboard.view',
      'tasks.view',
      'leaves.view',
      'users.view',
      'reports.view',
    ]);
    setFormPerms(defaults);
    setModalOpen(true);
  };

  const openEditModal = (g: RoleGroup) => {
    setEditingGroup(g);
    setFormName(g.name);
    setFormDesc(g.description || '');
    setFormColor(g.color || '#6366f1');
    if (g.slug === 'super_admin') {
      setFormPerms(new Set(allPermIds));
    } else {
      setFormPerms(new Set(g.permissions || []));
    }
    setModalOpen(true);
  };

  const handleTogglePerm = (permId: string) => {
    if (editingGroup?.slug === 'super_admin') return;
    setFormPerms((prev) => {
      const next = new Set(prev);
      if (next.has(permId)) {
        next.delete(permId);
      } else {
        next.add(permId);
      }
      return next;
    });
  };

  const handleToggleModuleAll = (mod: PermissionModule) => {
    if (editingGroup?.slug === 'super_admin') return;
    const modPermIds = mod.permissions.map((p) => p.id);
    const allSelected = modPermIds.every((id) => formPerms.has(id));

    setFormPerms((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        modPermIds.forEach((id) => next.delete(id));
      } else {
        modPermIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (editingGroup?.slug === 'super_admin') return;
    setFormPerms(new Set(allPermIds));
  };

  const handleClearAll = () => {
    if (editingGroup?.slug === 'super_admin') return;
    setFormPerms(new Set());
  };

  const handleSaveGroup = async () => {
    const trimmed = formName.trim();
    if (!trimmed) {
      return toast('Role group name is required', 'error');
    }
    setSaving(true);
    try {
      const payload = {
        name: trimmed,
        description: formDesc.trim(),
        color: formColor,
        permissions: Array.from(formPerms),
      };

      if (editingGroup) {
        await api.put(`/settings/role-groups/${editingGroup.id}`, payload);
        toast(`Role group "${trimmed}" updated successfully`);
      } else {
        await api.post('/settings/role-groups', payload);
        toast(`Role group "${trimmed}" created successfully`);
      }
      setModalOpen(false);
      loadData();
    } catch (err: any) {
      toast(err.message || 'Failed to save role group', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/settings/role-groups/${deleteTarget.id}`);
      toast(`Role group "${deleteTarget.name}" deleted successfully`);
      setDeleteTarget(null);
      loadData();
    } catch (err: any) {
      toast(err.message || 'Failed to delete role group', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleSetDefaultGroup = async (id: number) => {
    setSavingDefault(true);
    try {
      await api.put('/settings/default-role-group', { default_role_group_id: id });
      setDefaultGroupId(id);
      toast('Default user role group updated');
      loadData();
    } catch (err: any) {
      toast(err.message || 'Failed to set default role group', 'error');
    } finally {
      setSavingDefault(false);
    }
  };

  // Preset quick templates
  const applyTemplate = (preset: 'viewer' | 'manager' | 'full') => {
    if (editingGroup?.slug === 'super_admin') return;
    if (preset === 'viewer') {
      setFormPerms(new Set(allPermIds.filter((p) => p.endsWith('.view'))));
    } else if (preset === 'manager') {
      setFormPerms(
        new Set(
          allPermIds.filter(
            (p) => !p.startsWith('roles.') && !p.startsWith('settings.') && p !== 'users.delete'
          )
        )
      );
    } else if (preset === 'full') {
      setFormPerms(new Set(allPermIds));
    }
  };

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groups;
    const q = searchQuery.toLowerCase();
    return groups.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        g.slug.toLowerCase().includes(q) ||
        (g.description && g.description.toLowerCase().includes(q))
    );
  }, [groups, searchQuery]);

  return (
    <div className="space-y-6">
      {/* HEADER & CONTROL BAR */}
      <div className="p-5 rounded-2xl border border-line bg-card shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-brand/10 text-brand">
                <ShieldCheck size={22} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-ink">Role & Permission Group Management</h2>
                  <span className="badge badge-brand text-[11px] font-semibold">
                    {isSuper ? 'Super Admin (Root Scope)' : `Delegated Scope (${allPermIds.length} Available)`}
                  </span>
                </div>
                <p className="text-xs text-ink2 mt-0.5">
                  Create custom role groups and define granular module access, feature permissions, and user assignments within your authorized scope.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              disabled={loading}
              className="btn btn-ghost btn-sm p-2 text-ink2 hover:text-ink"
              title="Refresh Role Groups"
            >
              <RotateCcw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={openCreateModal}
              className="btn btn-primary btn-sm flex items-center gap-1.5 shadow-sm"
            >
              <Plus size={15} />
              <span>Create Role Group</span>
            </button>
          </div>
        </div>

        {/* SUB NAV & DEFAULT SELECTOR */}
        <div className="mt-5 pt-4 border-t border-line flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-1 bg-card2/70 p-1 rounded-xl border border-line w-fit">
            <button
              onClick={() => setActiveTab('groups')}
              className={cx(
                'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5',
                activeTab === 'groups'
                  ? 'bg-brand text-white shadow-xs'
                  : 'text-ink2 hover:text-ink hover:bg-card'
              )}
            >
              <Layers size={13} />
              <span>Role Groups ({groups.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('catalog')}
              className={cx(
                'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5',
                activeTab === 'catalog'
                  ? 'bg-brand text-white shadow-xs'
                  : 'text-ink2 hover:text-ink hover:bg-card'
              )}
            >
              <Award size={13} />
              <span>Permissions Catalog ({allPermIds.length})</span>
            </button>
          </div>

          {/* DEFAULT ROLE GROUP SETTING */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-ink3 flex items-center gap-1">
              <Tag size={12} className="text-brand" /> Default group for new users:
            </span>
            <select
              value={defaultGroupId ?? ''}
              onChange={(e) => handleSetDefaultGroup(Number(e.target.value))}
              disabled={savingDefault || groups.length === 0}
              className="input text-xs py-1 px-2.5 font-medium rounded-lg border-line bg-card2 text-ink max-w-[180px]"
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} {g.slug === 'user' ? '(Default)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* SUPER ADMIN OR HIERARCHICAL RBAC NOTICE */}
        {isSuper ? (
          <div className="mt-4 p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-xs text-purple-900 dark:text-purple-300 flex items-center gap-2.5">
            <Sparkles size={15} className="text-purple-600 dark:text-purple-400 shrink-0" />
            <span>
              <strong>Super Administrator Root Scope:</strong> Super Admin accounts hold root access and automatically have full access to all features and modules without needing a role group.
            </span>
          </div>
        ) : (
          <div className="mt-4 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-900 dark:text-blue-300 flex items-center gap-2.5">
            <Sparkles size={15} className="text-blue-600 dark:text-blue-400 shrink-0" />
            <span>
              <strong>Hierarchical RBAC Scope Enforced:</strong> You can manage role groups within your {allPermIds.length} granted permissions. Super Admin root permissions and system settings remain strictly protected.
            </span>
          </div>
        )}
      </div>

      {/* TAB CONTENT: ROLE GROUPS */}
      {activeTab === 'groups' && (
        <div className="space-y-4">
          {/* SEARCH BAR */}
          <div className="flex items-center gap-2 max-w-md">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
              <input
                type="text"
                placeholder="Search role groups by name or description..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input input-sm pl-8 w-full text-xs"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink3 hover:text-ink"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          {/* GROUPS LIST / CARDS */}
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="card p-5 animate-pulse bg-card space-y-3">
                  <div className="h-5 bg-card2 rounded-md w-1/3"></div>
                  <div className="h-3 bg-card2 rounded-md w-3/4"></div>
                  <div className="h-10 bg-card2 rounded-xl"></div>
                </div>
              ))}
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="card p-12 text-center text-ink2 border border-line">
              <ShieldAlert size={32} className="mx-auto text-ink3 mb-2 opacity-60" />
              <div className="font-bold text-ink">No role groups found</div>
              <p className="text-xs text-ink3 mt-1">
                {searchQuery ? 'Try adjusting your search query' : 'Create your first custom role group above'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredGroups.map((group) => {
                const isFullAccess = group.slug === 'super_admin' || group.permissions.includes('*');
                const permCount = isFullAccess ? allPermIds.length : group.permissions.length;
                const isDefault = group.id === defaultGroupId;

                return (
                  <div
                    key={group.id}
                    className="card p-5 border border-line bg-card hover:border-brand/40 transition-all flex flex-col justify-between group shadow-xs"
                  >
                    <div>
                      {/* CARD HEADER */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <div
                            className="w-4 h-4 rounded-full shrink-0 shadow-xs border border-white/20"
                            style={{ backgroundColor: group.color || '#6366f1' }}
                          />
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-bold text-base text-ink">{group.name}</h3>
                              {group.is_system ? (
                                <span className="badge text-[10px] px-1.5 py-0.2 bg-slate-500/10 text-slate-600 dark:text-slate-400 font-medium">
                                  System Group
                                </span>
                              ) : (
                                <span className="badge text-[10px] px-1.5 py-0.2 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-medium">
                                  Custom Group
                                </span>
                              )}
                              {isDefault && (
                                <span className="badge badge-brand text-[10px] px-1.5 py-0.2 font-semibold">
                                  Default
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-ink3 font-mono mt-0.5">
                              slug: {group.slug}
                            </div>
                          </div>
                        </div>

                        {/* ACTIONS */}
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openEditModal(group)}
                            className="btn btn-ghost btn-xs p-1.5 text-ink2 hover:text-brand hover:bg-brand/10 rounded-lg"
                            title="Edit Role Group and Permissions"
                          >
                            <Pencil size={14} />
                          </button>
                          {!group.is_system && (
                            <button
                              onClick={() => setDeleteTarget(group)}
                              className="btn btn-ghost btn-xs p-1.5 text-ink2 hover:text-red-500 hover:bg-red-500/10 rounded-lg"
                              title="Delete Role Group"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* DESCRIPTION */}
                      <p className="text-xs text-ink2 mt-2.5 leading-relaxed line-clamp-2">
                        {group.description || 'No description provided.'}
                      </p>

                      {/* STATS STRIP */}
                      <div className="mt-4 p-3 rounded-xl bg-card2/60 border border-line flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5 text-ink">
                          <Users size={14} className="text-brand" />
                          <span className="font-bold">{group.user_count ?? 0}</span>
                          <span className="text-ink3 text-[11px]">active users</span>
                        </div>

                        <div className="flex items-center gap-1.5 text-ink">
                          <ShieldCheck size={14} className={isFullAccess ? 'text-amber-500' : 'text-brand'} />
                          {isFullAccess ? (
                            <span className="font-bold text-amber-600 dark:text-amber-400">Full Access (All)</span>
                          ) : (
                            <>
                              <span className="font-bold">{permCount}</span>
                              <span className="text-ink3 text-[11px]">/ {allPermIds.length} permissions</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* SAMPLE PERMISSION TAGS */}
                      <div className="mt-3 flex flex-wrap gap-1">
                        {isFullAccess ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                            <Sparkles size={10} /> Full Administrative Capabilities
                          </span>
                        ) : group.permissions.length === 0 ? (
                          <span className="text-[11px] text-ink3 italic">No permissions assigned</span>
                        ) : (
                          group.permissions.slice(0, 5).map((p) => (
                            <span
                              key={p}
                              className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-card2 border border-line text-ink2"
                            >
                              {p}
                            </span>
                          ))
                        )}
                        {!isFullAccess && group.permissions.length > 5 && (
                          <span className="px-1.5 py-0.5 rounded-md text-[10px] text-ink3 font-medium bg-card2/40">
                            +{group.permissions.length - 5} more
                          </span>
                        )}
                      </div>
                    </div>

                    {/* CARD FOOTER */}
                    <div className="mt-4 pt-3 border-t border-line/60 flex items-center justify-between">
                      <button
                        onClick={() => openEditModal(group)}
                        className="text-xs text-brand hover:underline font-semibold flex items-center gap-1"
                      >
                        <span>Configure Permissions</span>
                        <ArrowRight size={12} />
                      </button>

                      {!isDefault && (
                        <button
                          onClick={() => handleSetDefaultGroup(group.id)}
                          className="text-[11px] text-ink3 hover:text-ink underline"
                        >
                          Make default
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB CONTENT: FULL PERMISSION CATALOG */}
      {activeTab === 'catalog' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-card2/60 border border-line text-xs text-ink2 flex items-start gap-2.5">
            <Info size={16} className="text-brand shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-ink">System Permissions Catalog</p>
              <p className="text-ink3 mt-0.5">
                The application contains {allPermIds.length} discrete permission endpoints across {modules.length} modules.
                Role groups map user identities to combinations of these permissions.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {modules.map((mod) => (
              <div key={mod.id} className="card p-4 border border-line bg-card">
                <div className="flex items-center justify-between pb-3 border-b border-line">
                  <div>
                    <h3 className="font-bold text-sm text-ink flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-brand"></span>
                      {mod.name}
                    </h3>
                    <p className="text-xs text-ink3 mt-0.5">{mod.description}</p>
                  </div>
                  <span className="badge text-[11px] bg-card2 border border-line text-ink2 font-mono">
                    {mod.permissions.length} actions
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 mt-3">
                  {mod.permissions.map((p) => (
                    <div
                      key={p.id}
                      className="p-2.5 rounded-lg bg-card2/50 border border-line/60 hover:border-line flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-1">
                          <div className="font-mono text-xs font-semibold text-brand">{p.id}</div>
                          {p.super_admin_only && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-500/10 text-purple-600 border border-purple-500/20">
                              Super Admin
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-medium text-ink mt-0.5">{p.name}</div>
                        <div className="text-[11px] text-ink3 mt-1 leading-snug">{p.description}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODAL: CREATE / EDIT ROLE GROUP */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingGroup ? `Edit Role Group: ${editingGroup.name}` : 'Create New Role Group'}
        width="820px"
      >
        <div className="space-y-5">
          {/* GROUP DETAILS SECTION */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-xl bg-card2/60 border border-line">
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-ink block mb-1">
                  Group Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g., Branch Manager, Auditor, Operations"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="input input-sm w-full text-xs"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-ink block mb-1">Description</label>
                <input
                  type="text"
                  placeholder="Briefly describe who this group is for..."
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  className="input input-sm w-full text-xs"
                />
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-ink block mb-1">Badge Color Theme</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={formColor}
                    onChange={(e) => setFormColor(e.target.value)}
                    className="w-8 h-8 rounded-lg border border-line cursor-pointer bg-transparent"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {COLOR_PALETTE.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setFormColor(c)}
                        className={cx(
                          'w-6 h-6 rounded-md transition-all border',
                          formColor.toLowerCase() === c.toLowerCase()
                            ? 'border-brand scale-110 shadow-xs'
                            : 'border-transparent hover:scale-105'
                        )}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* TEMPLATES */}
              {editingGroup?.slug !== 'super_admin' && (
                <div>
                  <label className="text-[11px] font-semibold text-ink3 block mb-1">Quick Presets</label>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => applyTemplate('viewer')}
                      className="px-2 py-1 rounded-md text-[11px] font-medium bg-card border border-line hover:border-brand text-ink"
                    >
                      Read-Only (Viewer)
                    </button>
                    <button
                      type="button"
                      onClick={() => applyTemplate('manager')}
                      className="px-2 py-1 rounded-md text-[11px] font-medium bg-card border border-line hover:border-brand text-ink"
                    >
                      Standard Manager
                    </button>
                    <button
                      type="button"
                      onClick={() => applyTemplate('full')}
                      className="px-2 py-1 rounded-md text-[11px] font-medium bg-card border border-line hover:border-brand text-ink"
                    >
                      All Permissions
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* PERMISSIONS MATRIX */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-bold text-ink flex items-center gap-2">
                  <span>Assigned Permissions</span>
                  <span className="badge badge-brand text-[11px]">
                    {editingGroup?.slug === 'super_admin' ? allPermIds.length : formPerms.size} / {allPermIds.length} Active
                  </span>
                </h3>
                <p className="text-xs text-ink3 mt-0.5">
                  Check each action or feature you wish members of this role group to access.
                </p>
              </div>

              {editingGroup?.slug !== 'super_admin' && (
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    className="text-brand hover:underline font-semibold"
                  >
                    Select All
                  </button>
                  <span className="text-ink3">•</span>
                  <button
                    type="button"
                    onClick={handleClearAll}
                    className="text-ink3 hover:text-ink underline"
                  >
                    Clear All
                  </button>
                </div>
              )}
            </div>

            {/* MODULES LIST */}
            <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
              {modules.map((mod) => {
                const modPermIds = mod.permissions.map((p) => p.id);
                const allSelected = modPermIds.every((id) => formPerms.has(id));
                const someSelected = modPermIds.some((id) => formPerms.has(id)) && !allSelected;

                return (
                  <div
                    key={mod.id}
                    className="p-3.5 rounded-xl border border-line bg-card hover:border-line/90 transition-all"
                  >
                    {/* MODULE HEADER WITH TOGGLE ALL */}
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-line/60">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleToggleModuleAll(mod)}
                          className="p-0.5 rounded transition-all hover:bg-brand/10"
                        >
                          {allSelected ? (
                            <CheckSquare size={16} className="text-brand" />
                          ) : someSelected ? (
                            <div className="w-4 h-4 rounded border border-brand bg-brand/20 flex items-center justify-center">
                              <div className="w-2 h-2 bg-brand rounded-xs" />
                            </div>
                          ) : (
                            <Square size={16} className="text-ink3" />
                          )}
                        </button>
                        <span className="font-bold text-xs text-ink">{mod.name}</span>
                        <span className="text-[11px] text-ink3">({mod.description})</span>
                      </div>

                      <span className="text-[10px] text-ink3 font-medium">
                        {modPermIds.filter((id) => formPerms.has(id)).length} / {mod.permissions.length} selected
                      </span>
                    </div>

                    {/* PERMISSIONS CHECKBOXES */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                      {mod.permissions.map((p) => {
                        const isSuperOnly = !!p.super_admin_only;
                        const checked = formPerms.has(p.id);
                        const disabled = isSuperOnly;

                        return (
                          <label
                            key={p.id}
                            className={cx(
                              'p-2 rounded-lg border text-xs flex items-start gap-2 transition-all select-none',
                              disabled ? 'opacity-65 cursor-not-allowed bg-card2/20' : 'cursor-pointer',
                              checked
                                ? 'bg-brand/5 border-brand/30 text-ink'
                                : 'bg-card2/40 border-line/60 text-ink2 hover:bg-card2'
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={disabled}
                              onChange={() => handleTogglePerm(p.id)}
                              className="mt-0.5 rounded border-line text-brand focus:ring-brand shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-1">
                                <div className="font-semibold truncate text-[11px]">{p.name}</div>
                                {isSuperOnly && (
                                  <span className="text-[9px] font-bold text-purple-600 bg-purple-500/10 px-1 py-0.2 rounded border border-purple-500/20 shrink-0">
                                    Super Admin
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-ink3 line-clamp-1">{p.description}</div>
                              <div className="text-[9px] font-mono text-ink3 opacity-70 mt-0.5">{p.id}</div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* MODAL FOOTER */}
          <div className="flex items-center justify-end gap-2 pt-4 border-t border-line">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="btn btn-ghost btn-sm"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveGroup}
              disabled={saving || !formName.trim()}
              className="btn btn-primary btn-sm flex items-center gap-1.5"
            >
              <Save size={14} />
              <span>{saving ? 'Saving...' : editingGroup ? 'Save Changes' : 'Create Role Group'}</span>
            </button>
          </div>
        </div>
      </Modal>

      {/* CONFIRM DELETE MODAL */}
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteGroup}
        title={`Delete Role Group: ${deleteTarget?.name}`}
        message={
          deleteTarget?.user_count && deleteTarget.user_count > 0
            ? `Warning: There are ${deleteTarget.user_count} active user(s) assigned to "${deleteTarget?.name}". You must reassign those users to another role group before deleting.`
            : `Are you sure you want to permanently delete the custom role group "${deleteTarget?.name}"? This action cannot be undone.`
        }
        confirmLabel={deleting ? 'Deleting...' : 'Delete Group'}
        danger
      />
    </div>
  );
}
