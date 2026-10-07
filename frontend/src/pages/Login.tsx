import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListTodo, Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { useToast } from '../components/ui';
import { Sun, Moon } from 'lucide-react';

export default function Login() {
  const { login } = useAuth();
  const { dark, toggle } = useTheme();
  const navigate = useNavigate();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!email.trim() || !password) return toast('Email and password are required', 'error');
    setLoading(true);
    try {
      await login(email, password);
      toast('Welcome back!');
      navigate('/dashboard');
    } catch (err: any) {
      toast(err?.message || 'Login failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-full flex items-center justify-center p-4 sm:p-6 bg-grid relative overflow-x-hidden">
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(900px 500px at 20% 10%, rgba(99,102,241,0.18), transparent 60%), radial-gradient(800px 450px at 85% 90%, rgba(139,92,246,0.16), transparent 55%)' }} />
      <button onClick={toggle} className="absolute top-3 right-3 sm:top-5 sm:right-5 p-2.5 rounded-xl glass text-ink2 hover:text-brand transition-colors z-10">
        {dark ? <Sun size={18} /> : <Moon size={18} />}
      </button>

      {/* py-14 keeps the first field clear of the floating theme button, and
          items-center would clip a tall card on short screens, so the wrapper
          grows instead of forcing everything into the viewport height. */}
      <div className="relative z-10 w-full max-w-5xl grid lg:grid-cols-2 gap-8 items-center anim-in py-10 sm:py-4">
        <div className="hidden lg:block">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-2xl gradient-bg flex items-center justify-center text-white shadow-xl">
              <ListTodo size={26} />
            </div>
            <div>
              <div className="text-2xl font-bold gradient-text">PDCL ICT</div>
              <div className="text-sm text-ink2">Enterprise Task Management</div>
            </div>
          </div>
          <h1 className="text-4xl font-extrabold leading-tight mb-4">
            Manage teams, track tasks & <span className="gradient-text">drive performance</span>
          </h1>
          <p className="text-ink2 mb-8 max-w-md">
            A modern enterprise workspace with role-based dashboards, KPI-driven insights, kanban boards,
            and real-time collaboration for admins and teams.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              ['Role-based', 'RBAC dashboards'],
              ['KPI engine', 'Performance scoring'],
              ['Real-time', 'Notifications & sync'],
            ].map(([a, b]) => (
              <div key={a} className="card p-4">
                <div className="text-sm font-bold">{a}</div>
                <div className="text-xs text-ink3 mt-0.5">{b}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-5 sm:p-8 shadow-2xl w-full mx-auto max-w-md lg:max-w-none">
          <div className="lg:hidden flex items-center gap-2.5 mb-6">
            <div className="w-10 h-10 rounded-xl gradient-bg flex items-center justify-center text-white"><ListTodo size={22} /></div>
             <div className="text-xl font-bold gradient-text">PDCL ICT</div>
          </div>
          <h2 className="text-2xl font-bold mb-1">Sign in</h2>
          <p className="text-sm text-ink2 mb-6">Access your task management workspace</p>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="label">Email</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
                <input className="input !pl-10" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
              </div>
            </div>
            <div>
              <label className="label">Password</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
                <input className="input !pl-10 !pr-10" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
                <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink3 hover:text-ink2">
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <button type="submit" className="btn btn-primary w-full !py-3" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
