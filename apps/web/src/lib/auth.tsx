import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { api, type User } from "@wyre/api";

interface Auth { user: User; switchUser: (id: string) => void }
const Ctx = createContext<Auth | null>(null);
const KEY = "wyre.tracker.user";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<string>(() => { try { return localStorage.getItem(KEY) ?? "u_pm1"; } catch { return "u_pm1"; } });
  const value = useMemo<Auth>(() => ({
    user: api.getUser(id),
    switchUser: (next) => { try { localStorage.setItem(KEY, next); } catch { /* ignore */ } setId(next); },
  }), [id]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useAuth() { const v = useContext(Ctx); if (!v) throw new Error("AuthProvider missing"); return v; }
