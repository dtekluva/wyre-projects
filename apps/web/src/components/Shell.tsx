import { NavLink, Outlet } from "react-router-dom";
import { ROLE_LABEL } from "@wyre/api";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/useApi";
import { Avatar, RoleChips } from "./ui";

const Item = ({ to, label, badge, end }: { to: string; label: string; badge?: number; end?: boolean }) =>
  <NavLink to={to} end={end} className={({ isActive }) => `nav__item ${isActive ? "nav__item--active" : ""}`}>
    <span>{label}</span>{badge ? <span className="nav__badge">{badge}</span> : null}
  </NavLink>;

export function Shell() {
  const api = useApi(); const { user, switchUser } = useAuth();
  const checks = api.reviewQueue(user.id).length;
  const approvals = api.approvalsFor(user.id).length;
  const isAdmin = api.can(user.id, "users.manage");
  const seesThresholds = api.can(user.id, "thresholds.read");
  return (
    <div className="app ns">
      <nav className="app__nav" aria-label="Primary">
        <div className="brand"><span className="brand__logo"><img src="/wyre-logo.png" alt="Wyre" /></span>
          <div><div className="brand__name">Wyre Tracker</div><div className="brand__sub">Project portfolio</div></div></div>
        <div className="nav__section">Portfolio</div>
        <Item to="/" label="All projects" end />
        <div className="nav__section">My work</div>
        <Item to="/work/reviews" label="Review queue" badge={checks} />
        <Item to="/work/approvals" label="Approvals" badge={approvals} />
        {(isAdmin || seesThresholds) && <>
          <div className="nav__section">Admin</div>
          {isAdmin && <Item to="/admin/users" label="Users & roles" />}
          {seesThresholds && <Item to="/admin/thresholds" label="Thresholds" />}
        </>}
        <div className="nav__foot">Phase 1 · frontend-first · mock API</div>
      </nav>
      <div className="app__main">
        <header className="topbar">
          <div className="row"><div className="topbar__crumbs">Signed in as</div><RoleChips roles={user.roles} /></div>
          <div className="userswitch">
            <label className="sm muted" htmlFor="user">Act as</label>
            <select id="user" value={user.id} onChange={(e) => switchUser(e.target.value)}>
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
