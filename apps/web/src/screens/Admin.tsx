import { ROLE_LABEL, MATRIX, fmtDate } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { Avatar, Note, RoleChips } from "../components/ui";

export function AdminUsers() {
  const api = useApi(); const { user } = useAuth();
  if (!api.can(user.id, "users.manage")) return <Note tone="danger">Only Admin can manage users and roles.</Note>;
  return (
    <>
      <div className="page-head"><div><h1 className="page-title">Users & roles</h1><div className="page-sub">{api.getUsers().length} users · role grants are audited to the chronology</div></div></div>
      <div className="card table--wrap"><table className="table"><thead><tr><th>User</th><th>Global / base roles</th><th>Project memberships</th><th className="num">Permissions</th></tr></thead>
        <tbody>{api.getUsers().map((u) => { const ms = api.memberships.filter((m) => m.userId === u.id && !m.revokedAt); return <tr key={u.id}>
          <td><span className="row"><Avatar user={u} sm />{u.name}<span className="sm muted">{u.email}</span></span></td>
          <td><RoleChips roles={u.roles} /></td>
          <td className="sm">{ms.length ? ms.map((m) => `${api.projects.find((p) => p.id === m.projectId)?.code} (${ROLE_LABEL[m.role]})`).join(" · ") : <span className="muted">—</span>}</td>
          <td className="num ns-mono">{new Set(u.roles.flatMap((r) => MATRIX[r])).size}</td>
        </tr>; })}</tbody></table></div>
    </>
  );
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
