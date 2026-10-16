/** Date ranges for "what was done today / this week" — item 2 from the 2026-10-16 demo. Inclusive calendar days in
 *  the viewer's local time; events carry UTC timestamps and are bucketed by the local day they fell on. */
export type RangePreset = "today" | "yesterday" | "week" | "7d" | "30d" | "all" | "custom";
export const RANGE_LABEL: Record<RangePreset, string> = { today: "Today", yesterday: "Yesterday", week: "This week", "7d": "Last 7 days", "30d": "Last 30 days", all: "All time", custom: "Custom" };
/** Both ends are YYYY-MM-DD and inclusive; an absent end is open. */
export interface DateRange { from?: string; to?: string }

export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function rangeFor(preset: RangePreset, now: Date = new Date()): DateRange {
  const t = new Date(now); t.setHours(0, 0, 0, 0);
  const shift = (days: number) => { const x = new Date(t); x.setDate(x.getDate() + days); return x; };
  switch (preset) {
    case "today": return { from: ymd(t), to: ymd(t) };
    case "yesterday": { const y = shift(-1); return { from: ymd(y), to: ymd(y) }; }
    case "week": return { from: ymd(shift(-((t.getDay() + 6) % 7))), to: ymd(t) };   // Monday to today
    case "7d": return { from: ymd(shift(-6)), to: ymd(t) };
    case "30d": return { from: ymd(shift(-29)), to: ymd(t) };
    default: return {};
  }
}

/** Does an ISO timestamp fall on a local calendar day inside the range? */
export function inRange(iso: string | undefined, r: DateRange): boolean {
  if (!iso) return false;
  if (!r.from && !r.to) return true;
  const day = ymd(new Date(iso));
  return (!r.from || day >= r.from) && (!r.to || day <= r.to);
}

/** Bucket newest-first items by local day, keeping their order inside each day. */
export function groupByDay<T>(items: T[], at: (x: T) => string): { day: string; items: T[] }[] {
  const out: { day: string; items: T[] }[] = [];
  for (const x of items) {
    const day = ymd(new Date(at(x)));
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(x); else out.push({ day, items: [x] });
  }
  return out;
}

export const fmtDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
