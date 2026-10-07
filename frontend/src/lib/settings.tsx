import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api';
import type { Settings } from './types';
import { useAuth } from './auth';

const Ctx = createContext<Settings | null>(null);
const SetterCtx = createContext<((s: Settings) => void) | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const { user } = useAuth();
  useEffect(() => {
    if (!user) {
      setSettings(null);
      return;
    }
    api.get<Settings>('/settings').then(setSettings).catch(() => {});
  }, [user]);
  return (
    <Ctx.Provider value={settings}>
      <SetterCtx.Provider value={setSettings}>{children}</SetterCtx.Provider>
    </Ctx.Provider>
  );
}

export function useSettings() {
  return useContext(Ctx);
}
export function useSetSettings() {
  return useContext(SetterCtx);
}
