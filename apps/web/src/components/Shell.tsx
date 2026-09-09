import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { ROLE_LABEL } from "@wyre/api";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/useApi";
import { Avatar, RoleChips } from "./ui";

const Item = ({ to, label, badge, end }: { to: string; label: string; badge?: number; end?: boolean }) =>
  <NavLink to={to} end={end} className={({ isActive }) => `nav__item ${isActive ? "nav__item--active" : ""}`}>
    <span>{label}</span>{badge ? <span className="nav__badge">{badge}</span> : null}
  </NavLink>;

export function Shell() {
  const api = useApi(); const { user, switchUser } = useAuth(); const loc = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  useEffect(() => { document.body.classList.toggle("nav-open", open); return () => document.body.classList.remove("nav-open"); }, [open]);
  const checks = api.reviewQueue(user.id).length;
  const approvals = api.approvalsFor(user.id).length;
  const isAdmin = api.can(user.id, "users.manage");
  const seesThresholds = api.can(user.id, "thresholds.read");
  const seesRecon = api.can(user.id, "recon.read");
  const unmatched = seesRecon ? api.listQbBills().filter((b) => b.confidence !== "matched").length : 0;
  const writeOffs = api.can(user.id, "writeoff.approve") ? api.listApprovals({ status: "pending", kind: "write_off" }).length : 0;
  return (
    <div className="app ns">
      <div className={`scrim ${open ? "scrim--on" : ""}`} onClick={() => setOpen(false)} aria-hidden />
      <nav className={`app__nav ${open ? "app__nav--open" : ""}`} aria-label="Primary">
        <div className="brand"><span className="brand__logo"><img src="/wyre-logo.png" alt="Wyre" /></span>
          <div><div className="brand__name">Wyre Tracker</div><div className="brand__sub">Project portfolio</div></div>
          <button className="nav__close" onClick={() => setOpen(false)} aria-label="Close menu">✕</button></div>
        <div className="nav__section">Portfolio</div>
        <Item to="/" label="All projects" end />
        <div className="nav__section">My work</div>
        <Item to="/work/reviews" label="Review queue" badge={checks} />
        <Item to="/work/approvals" label="Approvals" badge={approvals} />
        <div className="nav__section">Stores</div>
        <Item to="/inventory" label="Inventory" badge={writeOffs} />
        {seesRecon && <><div className="nav__section">Finance</div><Item to="/finance/reconciliation" label="QB reconciliation" badge={unmatched} /></>}
        {(isAdmin || seesThresholds) && <>
          <div className="nav__section">Admin</div>
          {isAdmin && <Item to="/admin/users" label="Users & roles" />}
          {seesThresholds && <Item to="/admin/thresholds" label="Thresholds" />}
        </>}
        <div className="nav__foot">Phase 2 · frontend-first · mock API
          {api.isDirty() && <div style={{ marginTop: 6 }}><button className="ns-btn ns-btn--ghost ns-btn--sm" style={{ color: "inherit", opacity: .9 }}
            onClick={() => { if (confirm("Discard all demo changes and restore the seed data?")) api.reset(); }}>Reset demo data</button></div>}
        </div>
      </nav>
      <div className="app__main">
        <header className="topbar">
          <div className="row">
            <button className="hamburger" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open}><span /><span /><span /></button>
            <span className="topbar__brand"><img src="/wyre-logo.png" alt="" />Tracker</span>
            <div className="topbar__roles"><span className="topbar__crumbs">Signed in as</span><RoleChips roles={user.roles} /></div>
          </div>
          <div className="userswitch">
            <label className="sm muted topbar__actas" htmlFor="user">Act as</label>
            <select id="user" value={user.id} onChange={(e) => switchUser(e.target.value)} aria-label="Act as user">
              {api.getUsers().map((u) => <option key={u.id} value={u.id}>{u.name} — {u.roles.map((r) => ROLE_LABEL[r]).join(", ")}</option>)}
            </select>
            <Avatar user={user} />
          </div>
        </header>
        <main className="page"><Outlet /></main>
      </div>
    </div>
  );
}
