export const naira = (n: number, compact = false) =>
  compact
    ? "₦" + Intl.NumberFormat("en-NG", { notation: "compact", maximumFractionDigits: 1 }).format(n)
    : "₦" + Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 }).format(n);

export const fmtDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export const fmtDateTime = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export const relative = (iso: string, now = Date.now()) => {
  const d = (now - new Date(iso).getTime()) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)}d ago`;
  return fmtDate(iso);
};

export const daysBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
export const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
export const bytes = (n: number) => (n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
