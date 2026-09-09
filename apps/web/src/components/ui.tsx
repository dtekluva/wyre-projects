import type { ReactNode } from "react";
import { ROLE_LABEL, STAGES, type Rag, type ReviewStatus, type RoleCode, type Stage, type User } from "@wyre/api";

export type BadgeVariant = "neutral" | "success" | "warning" | "danger" | "info";
export const Badge = ({ variant = "neutral", children, title }: { variant?: BadgeVariant; children: ReactNode; title?: string }) =>
  <span className={`ns-badge ns-badge--${variant}`} title={title}>{children}</span>;

export const ReviewBadge = ({ status }: { status: ReviewStatus }) => {
  const m: Record<ReviewStatus, [BadgeVariant, string]> = { pending: ["warning", "Pending check"], checked: ["success", "Checked"], rejected: ["danger", "Rejected"] };
  const [v, l] = m[status]; return <Badge variant={v}><span className="ns-badge__dot" />{l}</Badge>;
};

export const RagDot = ({ rag, title }: { rag: Rag; title?: string }) => <span className={`rag rag--${rag}`} title={title ?? rag} aria-label={rag} />;

export const StageChip = ({ stage }: { stage: Stage }) =>
  <Badge variant={stage === 8 ? "neutral" : "info"}><span className="ns-mono">{stage}</span>{STAGES[stage].short}</Badge>;

export const Avatar = ({ user, sm }: { user: User; sm?: boolean }) =>
  <span className={`avatar ${sm ? "avatar--sm" : ""}`} title={user.name}>{user.initials}</span>;

export const RoleChips = ({ roles }: { roles: RoleCode[] }) =>
  <span className="rolechips">{roles.map((r) => <Badge key={r} variant="neutral">{ROLE_LABEL[r]}</Badge>)}</span>;

export const Empty = ({ title, hint }: { title: string; hint?: string }) => <div className="empty"><b>{title}</b>{hint}</div>;

export const Note = ({ tone = "info", children }: { tone?: "info" | "warn" | "danger" | "success"; children: ReactNode }) =>
  <div className={`note note--${tone}`}>{children}</div>;

export const Kpi = ({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "accent" | "warn" | "danger" }) =>
  <div className={`card kpi ${tone ? `kpi--${tone}` : ""}`}><div className="kpi__label">{label}</div><div className="kpi__value">{value}</div>{sub && <div className="kpi__sub">{sub}</div>}</div>;

export const Bar = ({ pct }: { pct: number }) =>
  <span className={`bar ${pct > 100 ? "bar--over" : pct > 90 ? "bar--warn" : ""}`} title={`${pct}%`}><i style={{ width: `${Math.min(pct, 100)}%` }} /></span>;
