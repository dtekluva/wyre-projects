import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { relative, type AppNotification } from "@wyre/api";
import { useApi } from "../lib/useApi";

const ICON: Record<string, string> = {
  document_expiring: "📄", document_expired: "📄", check_overdue: "⏱", approval_pending: "✍",
  gate_ready: "🚪", issue_sla_breach: "⚠", budget_warn: "₦", budget_over: "₦",
  stock_below_reorder: "📦", qb_unmatched: "🧾",
};
const ORDER = { critical: 0, warning: 1, info: 2 } as const;

/** §8 in-app channel. The engine reconciles server-side, so this only reads and marks read. */
export function NotificationBell() {
  const api = useApi();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { void api.refreshNotifications(); }, []);           // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {                                                     // the engine runs on a schedule; keep in step
    const t = window.setInterval(() => { void api.refreshNotifications(); }, 120_000);
    return () => window.clearInterval(t);
  }, [api]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const all = [...api.listNotifications()].sort((a, b) =>
    (a.readAt ? 1 : 0) - (b.readAt ? 1 : 0) || ORDER[a.severity] - ORDER[b.severity] || b.createdAt.localeCompare(a.createdAt));
  const unread = api.unreadCount();

  const go = (n: AppNotification) => {
    setOpen(false);
    void api.markRead([n.id]);
    if (n.link) nav(n.link);
  };

  return (
    <div className="bell" ref={box}>
      <button className="bell__btn" onClick={() => setOpen((v) => !v)} aria-label={`Alerts${unread ? `, ${unread} unread` : ""}`} aria-expanded={open}>
        🔔{unread > 0 && <span className="bell__dot">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && <div className="bell__panel" role="dialog" aria-label="Alerts">
        <header className="bell__head">
          <b>Alerts</b>
          <span className="sm muted grow">{unread} unread of {all.length}</span>
          {unread > 0 && <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => void api.markRead()}>Mark all read</button>}
        </header>
        <div className="bell__list">
          {all.length === 0
            ? <div className="bell__empty">Nothing needs you right now.</div>
            : all.slice(0, 60).map((n) => (
              <button key={n.id} className={`bell__row bell__row--${n.severity} ${n.readAt ? "" : "bell__row--unread"}`} onClick={() => go(n)}>
                <span className="bell__icon" aria-hidden>{ICON[n.kind] ?? "•"}</span>
                <span className="bell__text">
                  <span className="bell__title">{n.title}</span>
                  {n.body && <span className="sm muted">{n.body}</span>}
                  <span className="sm muted">{relative(n.createdAt)}</span>
                </span>
              </button>
            ))}
        </div>
      </div>}
    </div>
  );
}
