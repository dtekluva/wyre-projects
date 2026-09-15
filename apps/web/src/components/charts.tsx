import { useId, useState } from "react";

/**
 * Chart primitives. Deliberately small: horizontal bars only, because everything on this dashboard is a
 * magnitude compared across a handful of named things, which is exactly what a bar does best.
 *
 * Specs follow the house data-viz rules: marks capped at 18px with the band's leftover left as air, a 4px
 * rounded data-end squared at the baseline, hairline recessive axes, values direct-labelled at the tip, and a
 * per-mark hover/focus tooltip. Text never wears the series color.
 */

export type BarDatum = { key: string; label: string; value: number; tone?: "brand" | "good" | "warn" | "bad"; note?: string; href?: string };

const TONE: Record<string, string> = {
  brand: "var(--ns-chart-brand)", good: "var(--ns-chart-good)", warn: "var(--ns-chart-warn)", bad: "var(--ns-chart-bad)",
};

export function BarChart({ data, format = (n: number) => String(n), max, emptyLabel = "Nothing to show", onSelect, reference }: {
  data: BarDatum[];
  format?: (n: number) => string;
  max?: number;
  emptyLabel?: string;
  onSelect?: (d: BarDatum) => void;
  /** optional reference marker, e.g. the 100%-of-budget line */
  reference?: { at: number; label: string };
}) {
  const [hover, setHover] = useState<string | null>(null);
  const id = useId();
  if (!data.length) return <div className="chart__empty">{emptyLabel}</div>;
  const top = Math.max(max ?? 0, ...data.map((d) => d.value), 1);
  const pctOf = (v: number) => Math.max(0, Math.min(100, (v / top) * 100));
  return (
    <div className="chart">
      {data.map((d) => {
        const on = hover === d.key;
        const Tag = (onSelect || d.href ? "button" : "div") as "button" | "div";
        return (
          <Tag
            key={d.key}
            className={`chart__row ${onSelect || d.href ? "chart__row--click" : ""}`}
            {...(onSelect || d.href ? { type: "button" as const, onClick: () => onSelect?.(d) } : {})}
            onMouseEnter={() => setHover(d.key)} onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(d.key)} onBlur={() => setHover(null)}
            aria-describedby={on ? `${id}-tip` : undefined}
          >
            <span className="chart__label" title={d.label}>{d.label}</span>
            <span className="chart__track">
              <span className={`chart__bar ${on ? "chart__bar--on" : ""}`} style={{ width: `${pctOf(d.value)}%`, background: TONE[d.tone ?? "brand"] }} />
              {reference && reference.at <= top && (
                <span className="chart__ref" style={{ left: `${pctOf(reference.at)}%` }} aria-hidden title={reference.label} />
              )}
            </span>
            <span className="chart__value">{format(d.value)}</span>
            {on && (d.note || d.label) && (
              <span id={`${id}-tip`} role="tooltip" className="chart__tip">
                <b>{format(d.value)}</b><span>{d.note ?? d.label}</span>
              </span>
            )}
          </Tag>
        );
      })}
      {reference && <div className="chart__reflabel">— {reference.label}</div>}
    </div>
  );
}

/** A count that carries a state. Four numbers read better than four tiny bars. */
export function StatStrip({ items }: { items: { key: string; label: string; value: number; tone?: "good" | "warn" | "bad" | "info" }[] }) {
  return (
    <div className="strip">
      {items.map((i) => (
        <div key={i.key} className={`strip__item ${i.value ? `strip__item--${i.tone ?? "info"}` : "strip__item--zero"}`}>
          <span className="strip__dot" aria-hidden />
          <b className="strip__value">{i.value}</b>
          <span className="strip__label">{i.label}</span>
        </div>
      ))}
    </div>
  );
}
