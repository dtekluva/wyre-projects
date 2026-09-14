import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { User } from "@wyre/api";
import { api, remote } from "./api";
import { SignIn, Splash } from "../screens/SignIn";

interface Auth { user: User; remote: boolean; switchUser: (id: string) => void; login: (username: string, password: string) => Promise<void>; logout: () => void }
const Ctx = createContext<Auth | null>(null);
const KEY = "wyre.tracker.user";

export function AuthProvider({ children }: { children: ReactNode }) {
  // mock mode: "Act as" any demo user. live mode: JWT session against the backend.
  const [id, setId] = useState<string>(() => { try { return localStorage.getItem(KEY) ?? "u_pm1"; } catch { return "u_pm1"; } });
  const [status, setStatus] = useState<"loading" | "out" | "in">(remote ? (remote.signedIn ? "loading" : "out") : "in");
  const [, bump] = useState(0);
  useEffect(() => {
    const r = remote; if (!r) return;
    if (r.signedIn) r.refresh().then(() => setStatus(r.me ? "in" : "out")).catch(() => setStatus("out"));
    return r.subscribe(() => { if (!r.signedIn) setStatus("out"); bump((n) => n + 1); });
  }, []);
  const value = useMemo<Auth>(() => ({
    user: remote ? (remote.me ?? { id: "", name: "", email: "", roles: [], initials: "" }) : api.getUser(id),
    remote: !!remote,
    switchUser: (next) => { if (remote) return; try { localStorage.setItem(KEY, next); } catch { /* ignore */ } setId(next); },
    login: async (u, p) => { if (!remote) return; await remote.login(u, p); setStatus("in"); },
    logout: () => { if (!remote) return; remote.logout(); setStatus("out"); },
  }), [id, status]);  // eslint-disable-line react-hooks/exhaustive-deps
  if (remote && status === "loading") return <Splash />;
  if (remote && status === "out") return <Ctx.Provider value={value}><SignIn /></Ctx.Provider>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useAuth() { const v = useContext(Ctx); if (!v) throw new Error("AuthProvider missing"); return v; }
