import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { GLOBAL_ROLES, ROLE_LABEL, fmtDate, type Project, type RoleCode } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { useSafe } from "../lib/toast";
import { Avatar, Badge, Note, RoleChips } from "../components/ui";

const PROJECT_ROLES: RoleCode[] = ["pm", "lead_engineer", "field_tech"];
export function ProjectPeople() {
  const p = useOutletContext<Project>(); const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const canManage = api.can(user.id, "membership.manage", p.id);
  const members = api.listMemberships(p.id);
  const [uid, setUid] = useState("u_ft2"); const [role, setRole] = useState<RoleCode>("field_tech");
  const globals = api.getUsers().filter((u) => u.roles.some((r) => GLOBAL_ROLES.includes(r)));
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="card table--wrap">
        <div className="card__head"><div className="card__title">Project members</div><span className="sm muted">Per-project roles · scoped by <span className="ns-mono">ProjectMembership</span></span></div>
        <table className="table"><thead><tr><th>Person</th><th>Role</th><th>Granted by</th><th>Since</th><th></th></tr></thead>
          <tbody>{members.map((m) => { const u = api.getUser(m.userId); return <tr key={m.id}>
            <td><span className="row"><Avatar user={u} sm />{u.name}<span className="sm muted">{u.email}</span></span></td>
            <td><Badge variant="info">{ROLE_LABEL[m.role]}</Badge></td><td className="sm">{api.userName(m.grantedBy)}</td><td className="sm">{fmtDate(m.grantedAt)}</td>
            <td className="num">{canManage && <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => safe(() => api.revokeMembership(user.id, m.id), "Role revoked")}>Revoke</button>}</td>
          </tr>; })}</tbody></table>
      </div>
      <div className="card"><div className="card__head"><div className="card__title">Grant a project role</div></div>
        <div className="card__body">{canManage ? <form className="form" onSubmit={(e) => { e.preventDefault(); safe(() => api.grantMembership(user.id, p.id, uid, role), "Role granted — logged to chronology"); }}>
          <label className="ns-field"><span className="ns-field__label">Person</span><select className="ns-input" value={uid} onChange={(e) => setUid(e.target.value)}>{api.getUsers().filter((u) => !u.roles.some((r) => GLOBAL_ROLES.includes(r))).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <label className="ns-field"><span className="ns-field__label">Role</span><select className="ns-input" value={role} onChange={(e) => setRole(e.target.value as RoleCode)}>{PROJECT_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>
          <button className="ns-btn ns-btn--primary" type="submit">Grant</button>
        </form> : <Note tone="warn">Only a Project Manager on this project (or Admin) can manage membership.</Note>}</div>
      </div>
      <div className="card"><div className="card__head"><div className="card__title">Global roles</div><span className="sm muted">See every project without a membership</span></div>
        <div className="card__body stack" style={{ gap: 6 }}>{globals.map((u) => <div key={u.id} className="row sm"><Avatar user={u} sm /><span className="grow">{u.name}</span><RoleChips roles={u.roles} /></div>)}</div></div>
    </div>
  );
}
