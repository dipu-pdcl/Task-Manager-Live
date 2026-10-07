import React, { useEffect, useState } from 'react';
import { UserCircle, KeyRound, Upload, Mail, Building2, Users, Award, Shield, Eye, EyeOff, Radio } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast, Avatar, Badge, Skeleton } from '../components/ui';
import { LiveStatusBadge, LiveStatusDot } from '../components/LiveStatusIndicator';
import { HotlineBadge } from '../components/HotlineBadge';
import type { LiveStatusType } from '../lib/types';
import { fmtDate, cx } from '../lib/utils';

export default function Profile() {
  const { user, refreshUser, setUser, updateLiveStatus } = useAuth();
  const toast = useToast();
  const [profile, setProfile] = useState({ name: user?.name || '', title: user?.title || '', phone: user?.phone || '' });
  const [pwd, setPwd] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [saving, setSaving] = useState(false);
  const [pwdSaving, setPwdSaving] = useState(false);
  const [kpi, setKpi] = useState<any>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [statusMsg, setStatusMsg] = useState(user?.status_message || '');

  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    if (!user) return;
    setProfile({ name: user.name, title: user.title || '', phone: user.phone || '' });
    setStatusMsg(user.status_message || '');
    api.get<any>('/kpi/me').then(setKpi).catch(() => { });
  }, [user]);

  if (!user) return null;

  const currentLiveStatus: LiveStatusType = (user.live_status as LiveStatusType) || 'active';

  const handleToggleStatus = async (newStatus: LiveStatusType) => {
    setUpdatingStatus(true);
    try {
      await updateLiveStatus(newStatus, statusMsg);
      toast(`Live status changed to ${newStatus === 'active' ? 'Active 🟢' : newStatus === 'away' ? 'Away 🟡' : 'Inactive 🔴'}`);
    } catch (e: any) {
      toast(e.message || 'Failed to update status', 'error');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleSaveStatusMsg = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdatingStatus(true);
    try {
      await updateLiveStatus(currentLiveStatus, statusMsg);
      toast('Status message updated');
    } catch (e: any) {
      toast(e.message || 'Failed to update status message', 'error');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const saveProfile = async () => {
    const trimmedName = profile.name.trim();
    if (!trimmedName) return toast('Full name cannot be empty', 'error');
    setSaving(true);
    try {
      const u = await api.put<{ id: number; name: string; title?: string; phone?: string; avatar?: string; role: string; email: string }>('/users/me/profile', {
        name: trimmedName,
        title: profile.title.trim(),
        phone: profile.phone.trim(),
      });
      setUser({ ...user, name: u.name, title: u.title, phone: u.phone });
      toast('Profile updated successfully');
      refreshUser();
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const savePwd = async () => {
    if (!pwd.currentPassword) return toast('Current password is required', 'error');
    if (!pwd.newPassword) return toast('New password is required', 'error');
    if (pwd.newPassword.length < 6) return toast('New password must be at least 6 characters', 'error');
    if (pwd.newPassword !== pwd.confirm) return toast('Passwords do not match', 'error');
    if (pwd.currentPassword === pwd.newPassword) return toast('New password must be different from current password', 'error');
    setPwdSaving(true);
    try {
      await api.post('/auth/change-password', { currentPassword: pwd.currentPassword, newPassword: pwd.newPassword });
      setPwd({ currentPassword: '', newPassword: '', confirm: '' });
      toast('Password changed successfully');
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setPwdSaving(false); }
  };

  const uploadAvatar = async (file: File) => {
    if (!/^image\/(png|jpe?g|gif|webp)$/i.test(file.type)) return toast('Only PNG, JPEG, GIF or WebP images are allowed', 'error');
    if (file.size > 50 * 1024) return toast('Image must be 50KB or smaller', 'error');
    const fd = new FormData();
    fd.append('avatar', file);
    try {
      const r = await api.upload<{ url: string }>('/uploads/avatar', fd);
      setUser({ ...user, avatar: r.url });
      toast('Profile picture updated');
      refreshUser();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const roleLabel: Record<string, string> = { super_admin: 'Super Admin', admin: 'Admin', user: 'User' };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold flex items-center gap-2"><UserCircle size={24} className="text-brand" /> My Profile</h1>
        <p className="text-sm text-ink2 mt-0.5">Manage your personal information and security</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="space-y-5">
          <div className="card p-6 text-center relative">
            <div className="relative inline-block">
              <Avatar name={user.name} src={user.avatar} size={96} />
              <span className="absolute bottom-0 right-0 p-1 rounded-full bg-card ring-2 ring-card">
                <LiveStatusDot status={currentLiveStatus} size="lg" pulse={true} />
              </span>
              <label className="absolute -top-1 -right-1 w-7 h-7 rounded-full gradient-bg text-white flex items-center justify-center cursor-pointer shadow-lg hover:scale-110 transition-transform" title="Upload new photo">
                <Upload size={12} />
                <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadAvatar(e.target.files[0])} />
              </label>
            </div>
            <h2 className="font-bold text-lg mt-4">{user.name}</h2>
            <p className="text-sm text-ink2">{user.email}</p>
            <div className="flex items-center justify-center gap-2 mt-3 flex-wrap">
              <Badge color="#8b5cf6"><Shield size={11} /> {roleLabel[user.role]}</Badge>
            </div>
            {user.title && <div className="text-xs text-ink3 mt-2">{user.title}</div>}

            {/* Live Status Switcher in Profile */}
            <div className="mt-5 pt-4 border-t border-line text-left">
              <div className="text-xs font-semibold text-ink2 mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Radio size={13} className="text-emerald-500" />
                  Live Status Light:
                </span>
                <span className="text-[11px] font-mono text-ink3">
                  {user.employee_id || `EMP${String(user.id).padStart(3, '0')}`}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleToggleStatus('active')}
                  disabled={updatingStatus}
                  className={cx(
                    'p-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all border',
                    currentLiveStatus === 'active'
                      ? 'bg-emerald-500 text-white border-emerald-600 shadow-sm'
                      : 'bg-card2 border-line text-ink2 hover:bg-card hover:text-ink'
                  )}
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span>🟢 Active</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleStatus('away')}
                  disabled={updatingStatus}
                  className={cx(
                    'p-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all border',
                    currentLiveStatus === 'away'
                      ? 'bg-amber-500 text-white border-amber-600 shadow-sm'
                      : 'bg-card2 border-line text-ink2 hover:bg-card hover:text-ink'
                  )}
                >
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  <span>🟡 Away</span>
                </button>
              </div>

              {/* Status Note input */}
              <form onSubmit={handleSaveStatusMsg} className="mt-3">
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={statusMsg}
                    onChange={(e) => setStatusMsg(e.target.value)}
                    placeholder="Status message (e.g. In meeting)"
                    className="input !py-1 text-xs flex-1"
                  />
                  <button type="submit" disabled={updatingStatus} className="btn btn-ghost border border-line text-xs !py-1 !px-2.5">
                    Save
                  </button>
                </div>
              </form>
            </div>
          </div>

          <div className="card p-5">
            <h3 className="font-bold mb-3 text-sm">Organization</h3>
            <div className="space-y-2.5 text-sm">
              <div className="flex items-center gap-2 text-ink2"><span className="text-ink3 font-mono text-xs">ID:</span> <span className="font-mono font-semibold">{user.employee_id || `EMP${String(user.id).padStart(3, '0')}`}</span></div>
              <div className="flex items-center gap-2 text-ink2"><Users size={14} className="text-brand" /> <span className="text-ink3">Team:</span> {user.team_name || '—'}</div>
              <div className="flex items-center gap-2 text-ink2 flex-wrap">
                <Building2 size={14} className="text-brand shrink-0" />
                <span className="text-ink3">Branch:</span>
                <span>{user.department_name || '—'}</span>
                {user.department_hotline && (
                  <HotlineBadge
                    hotline={user.department_hotline}
                    branchName={user.department_name}
                    variant="chip"
                    showCopy={true}
                  />
                )}
              </div>
              <div className="flex items-center gap-2 text-ink2"><Mail size={14} className="text-brand" /> <span className="text-ink3">Member since:</span> {fmtDate(user.created_at)}</div>
            </div>
          </div>

          <div className="card p-5">
            <h3 className="font-bold mb-3 text-sm flex items-center gap-2"><Award size={14} className="text-brand" /> My KPI</h3>
            {!kpi ? <Skeleton className="h-20" /> : (
              <div className="text-center">
                <div className="text-4xl font-extrabold gradient-text">{kpi.score}</div>
                <div className="text-xs text-ink3">Performance score</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-4 text-center">
                  <Mini label="Completed" value={kpi.completed} />
                  <Mini label="On-Time" value={kpi.onTime} />
                  <Mini label="Overdue" value={kpi.overdueCount} />
                </div>
                <div className="mt-3 text-xs text-ink2">Completion rate: <b>{kpi.completionRate}%</b> · Avg {kpi.avgCompletionHours}h</div>
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-2 space-y-5">
          <div className="card p-6">
            <h3 className="font-bold mb-4">Profile Information</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Full Name</label>
                <input className="input" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
              </div>
              <div>
                <label className="label">Job Title</label>
                <input className="input" value={profile.title} onChange={(e) => setProfile({ ...profile, title: e.target.value })} />
              </div>
              <div>
                <label className="label">Email</label>
                <input className="input" value={user.email} disabled />
              </div>
              <div>
                <label className="label">Phone</label>
                <input className="input" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
              </div>
            </div>
            <button className="btn btn-primary mt-5" onClick={saveProfile} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
          </div>

          <div className="card p-6">
            <h3 className="font-bold mb-4 flex items-center gap-2"><KeyRound size={16} className="text-brand" /> Change Password</h3>
            <div className="space-y-4 max-w-md">
              <div>
                <label className="label">Current Password</label>
                <div className="relative">
                  <input
                    type={showCurrent ? 'text' : 'password'}
                    className="input !pr-10"
                    placeholder="Enter current password"
                    value={pwd.currentPassword}
                    onChange={(e) => setPwd({ ...pwd, currentPassword: e.target.value })}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ink3 hover:text-ink1 transition-colors"
                    onClick={() => setShowCurrent(!showCurrent)}
                  >
                    {showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">New Password</label>
                  <div className="relative">
                    <input
                      type={showNew ? 'text' : 'password'}
                      className="input !pr-10"
                      placeholder="Min 6 chars"
                      value={pwd.newPassword}
                      onChange={(e) => setPwd({ ...pwd, newPassword: e.target.value })}
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-ink3 hover:text-ink1 transition-colors"
                      onClick={() => setShowNew(!showNew)}
                    >
                      {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="label">Confirm New Password</label>
                  <input
                    type={showNew ? 'text' : 'password'}
                    className="input"
                    placeholder="Repeat password"
                    value={pwd.confirm}
                    onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })}
                  />
                </div>
              </div>
              <p className="text-xs text-ink3">Password must be at least 6 characters long and different from your current password.</p>
              <button className="btn btn-primary" onClick={savePwd} disabled={pwdSaving}>{pwdSaving ? 'Updating...' : 'Update Password'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="p-2 rounded-lg bg-card2/70">
      <div className="font-bold">{value}</div>
      <div className="text-[10px] text-ink3">{label}</div>
    </div>
  );
}
