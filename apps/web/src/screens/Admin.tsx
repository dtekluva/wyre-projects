import { useState } from "react";
import { ROLE_CODES, ROLE_LABEL, MATRIX, fmtDate, type RoleCode } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { Avatar, Badge, Note, RoleChips } from "../components/ui";
import { useSafe } from "../lib/toast";

export function AdminUsers() {
  const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  if (!api.can(user.id, "users.manage")) return <Note tone="danger">Only a Director can manage users and roles.</Note>;
  return (
    <>
      <div className="page-head"><div><h1 className="page-title">Users & roles</h1><div className="page-sub">{api.getUsers().length} users · {api.getUsers().filter((u) => u.status === "invited").length} awaiting their invite</div></div></div>
      <InviteUser />
      <div className="card table--wrap"><table className="table"><thead><tr><th>User</th><th>Global / base roles</th><th>Project memberships</th><th className="num">Permissions</th></tr></thead>
        <tbody>{api.getUsers().map((u) => { const ms = api.memberships.filter((m) => m.userId === u.id && !m.revokedAt); return <tr key={u.id}>
          <td><span className="row"><Avatar user={u} sm />{u.name}<span className="sm muted">{u.email}</span>
            {u.status === "invited" && <Badge variant="warning">invited</Badge>}</span>
            {u.status === "invited" && <span className="row sm" style={{ gap: 6, marginTop: 4 }}>
              <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => safe(() => api.resendInvite(user.id, u.id), "Invite resent")}>Resend</button>
              <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => safe(() => api.revokeInvite(user.id, u.id), "Invite revoked")}>Revoke</button>
            </span>}</td>
          <td><RoleChips roles={u.roles} /></td>
          <td className="sm">{ms.length ? ms.map((m) => `${api.projects.find((p) => p.id === m.projectId)?.code} (${ROLE_LABEL[m.role]})`).join(" · ") : <span className="muted">—</span>}</td>
          <td className="num ns-mono">{new Set(u.roles.flatMap((r) => MATRIX[r])).size}</td>
        </tr>; })}</tbody></table></div>
    </>
  );
}

/** Invite by email. Nothing secret is sent — the link lets them choose their own password. */
function InviteUser() {
  const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [username, setUsername] = useState("");
  const [roles, setRoles] = useState<RoleCode[]>([]); const [open, setOpen] = useState(false);
  const toggle = (r: RoleCode) => setRoles((cur) => cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]);
  // firstname.lastname, offered but overridable
  const suggest = (n: string) => n.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 2).join(".").replace(/[^a-z0-9.]/g, "");

  if (!open) return <div className="card"><div className="card__body row">
    <div className="grow"><b>Invite someone</b><div className="sm muted">They get an email and choose their own password. Nothing is sent in plain text.</div></div>
    <button className="ns-btn ns-btn--primary" onClick={() => setOpen(true)}>＋ Invite a user</button>
  </div></div>;

  return <div className="card"><div className="card__head"><div className="card__title">Invite a user</div>
    <span className="sm muted">Roles stack — pick every one that applies</span></div>
    <div className="card__body stack" style={{ gap: 12 }}>
      <div className="form">
        <label className="ns-field"><span className="ns-field__label">Full name</span>
          <input className="ns-input" value={name} onChange={(e) => { setName(e.target.value); if (!username || username === suggest(name)) setUsername(suggest(e.target.value)); }} /></label>
        <label className="ns-field"><span className="ns-field__label">Work email</span>
          <input className="ns-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="ns-field"><span className="ns-field__label">Username</span>
          <input className="ns-input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="firstname.lastname" /></label>
      </div>
      <div><div className="ns-field__label">Roles</div>
        <div className="row row--wrap" style={{ gap: 6, marginTop: 6 }}>
          {ROLE_CODES.map((r) => <button key={r} type="button" className={`ns-btn ns-btn--sm ${roles.includes(r) ? "ns-btn--primary" : ""}`} onClick={() => toggle(r)}>{ROLE_LABEL[r]}</button>)}
        </div></div>
      <div className="row" style={{ gap: 8 }}>
        <button className="ns-btn ns-btn--primary" disabled={!name || !email || !username || !roles.length}
          onClick={() => safe(() => {
            const res = api.inviteUser(user.id, { name, email, username, roles });
            setName(""); setEmail(""); setUsername(""); setRoles([]); setOpen(false);
            return res;
          }, "Invited — an email is on its way")}>Send invite</button>
        <button className="ns-btn ns-btn--ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div></div>;
}

export function AdminThresholds() {
  const api = useApi(); const { user } = useAuth();
  if (!api.can(user.id, "thresholds.read")) return <Note tone="danger">Your role cannot view thresholds.</Note>;
  const fmt = (v: number | string, unit?: string) => unit === "NGN" ? "₦" + Number(v).toLocaleString("en-NG") : unit === "%" ? `${v}%` : `${v} ${unit ?? ""}`;
  return (
    <>
      <div className="page-head"><div><h1 className="page-title">Thresholds</h1><div className="page-sub">Spec §11 defaults · versioned; editable by Admin in Phase 1 backend</div></div></div>
      <div className="card table--wrap"><table className="table"><thead><tr><th>Setting</th><th className="num">Value</th><th>Key</th><th>Effective</th><th>Updated by</th></tr></thead>
        <tbody>{api.listThresholds().map((t) => <tr key={t.key}><td>{t.label}</td><td className="num ns-mono">{fmt(t.value, t.unit)}</td><td className="sm ns-mono muted">{t.key}</td><td className="sm">{fmtDate(t.effectiveFrom)}</td><td className="sm">{api.userName(t.updatedBy)}</td></tr>)}</tbody></table></div>
    </>
  );
}
