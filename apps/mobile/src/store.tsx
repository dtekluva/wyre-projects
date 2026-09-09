import { createContext, useContext, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, type User } from "@wyre/api";

const STATE_KEY = "wyre.field.state.v1";
const USER_KEY = "wyre.field.user";
/** Roles that use the field app (spec §2 — in-house only). */
export const FIELD_ROLES = ["field_tech", "lead_engineer", "pm", "store_keeper"] as const;

interface Ctx { ready: boolean; user: User | null; signIn: (id: string) => void; signOut: () => void; syncedAt: string | null }
const AppCtx = createContext<Ctx>({ ready: false, user: null, signIn: () => {}, signOut: () => {}, syncedAt: null });

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false); const [user, setUser] = useState<User | null>(null); const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try { const [st, uid] = await Promise.all([AsyncStorage.getItem(STATE_KEY), AsyncStorage.getItem(USER_KEY)]);
        if (st) api.hydrate(st); if (uid) { try { setUser(api.getUser(uid)); } catch { /* stale */ } } }
      catch { /* first run */ }
      if (alive) setReady(true);
    })();
    // persist every change (debounced) — this is the local "offline" store until the backend lands
    const unsub = api.subscribe(() => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(async () => { try { await AsyncStorage.setItem(STATE_KEY, api.serialize()); setSyncedAt(new Date().toISOString()); } catch { /* ignore */ } }, 300); });
    return () => { alive = false; unsub(); };
  }, []);
  const signIn = (id: string) => { const u = api.getUser(id); setUser(u); AsyncStorage.setItem(USER_KEY, id).catch(() => {}); };
  const signOut = () => { setUser(null); AsyncStorage.removeItem(USER_KEY).catch(() => {}); };
  return <AppCtx.Provider value={{ ready, user, signIn, signOut, syncedAt }}>{children}</AppCtx.Provider>;
}
export const useApp = () => useContext(AppCtx);
/** Re-render on any api change and hand back the singleton. */
export function useApi() { const [, force] = useReducer((x: number) => x + 1, 0); useEffect(() => api.subscribe(force), []); return api; }
export function useUser() { const { user } = useApp(); if (!user) throw new Error("No user"); return user; }
