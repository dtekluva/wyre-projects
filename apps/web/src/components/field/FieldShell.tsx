import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useApi } from "../../lib/useApi";
import { useAuth } from "../../lib/auth";
import { useToast } from "../../lib/toast";
import { useOnline } from "../../lib/useOnline";
import { applyCommand, onOutboxChange, outbox, type Command, type OutboxEntry } from "../../lib/outbox";
import { ApiError } from "@wyre/api";
import { Avatar } from "../ui";

type FieldCtx = { online: boolean; queue: OutboxEntry[]; submit: (label: string, c: Command) => "applied" | "queued" | "error"; flush: () => Promise<void> };
const Ctx = createContext<FieldCtx | null>(null);
export const useField = () => { const v = useContext(Ctx); if (!v) throw new Error("FieldShell missing"); return v; };

export function FieldShell() {
  const api = useApi(); const { user } = useAuth(); const toast = useToast(); const online = useOnline(); const nav = useNavigate();
  const [queue, setQueue] = useState<OutboxEntry[]>([]);
  const refresh = useCallback(() => { outbox.list().then(setQueue).catch(() => setQueue([])); }, []);
  useEffect(() => { refresh(); return onOutboxChange(refresh); }, [refresh]);
  const flush = useCallback(async () => {
    const q = await outbox.list(); if (!q.length) return;
    const r = await outbox.flush(api);
    toast(r.failed ? `Synced ${r.ok}, ${r.failed} failed — see queue` : `Synced ${r.ok} queued item${r.ok === 1 ? "" : "s"}`, r.failed ? "error" : "success");
  }, [api, toast]);
  useEffect(() => { if (online) void flush(); }, [online, flush]);
  const submit = useCallback((label: string, c: Command): "applied" | "queued" | "error" => {
    if (!online) { void outbox.enqueue(label, c); toast(`Offline — "${label}" queued, will sync when back online`, "info"); return "queued"; }
    try { applyCommand(api, c); toast(label, "success"); return "applied"; }
    catch (e) { toast(e instanceof ApiError ? e.message : String(e), "error"); return "error"; }
  }, [api, online, toast]);
  const failed = queue.filter((q) => q.status === "failed").length;
  return (
    <Ctx.Provider value={{ online, queue, submit, flush }}>
      <div className="field ns">
        <header className="field__head">
          <button className="field__brand" onClick={() => nav("/field")}><img src="/wyre-logo.png" alt="" />Field</button>
          <div className="row" style={{ gap: 8 }}>
            <span className={`pill ${online ? "pill--ok" : "pill--off"}`}>{online ? "online" : "offline"}</span>
            {queue.length > 0 && <button className={`pill ${failed ? "pill--bad" : "pill--warn"}`} onClick={() => nav("/field/queue")}>{queue.length} queued</button>}
            <button className="field__avatar" onClick={() => nav("/field/signin")} aria-label="Switch user"><Avatar user={user} /></button>
          </div>
        </header>
        <main className="field__main"><Outlet /></main>
        <nav className="tabbar" aria-label="Field navigation">
          <NavLink to="/field" end className={({ isActive }) => `tabbar__item ${isActive ? "tabbar__item--on" : ""}`}><span>⌂</span>Home</NavLink>
          <NavLink to="/field/issues" className={({ isActive }) => `tabbar__item ${isActive ? "tabbar__item--on" : ""}`}><span>⚠</span>Issues</NavLink>
          <NavLink to="/field/visits" className={({ isActive }) => `tabbar__item ${isActive ? "tabbar__item--on" : ""}`}><span>🛠</span>Visits</NavLink>
          <NavLink to="/field/van" className={({ isActive }) => `tabbar__item ${isActive ? "tabbar__item--on" : ""}`}><span>🚐</span>Van</NavLink>
        </nav>
      </div>
    </Ctx.Provider>
  );
}
