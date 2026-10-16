import { useState } from "react";
import { RANGE_LABEL, rangeFor, type DateRange, type RangePreset } from "@wyre/api";

export interface DateRangeState { preset: RangePreset; setPreset: (p: RangePreset) => void; custom: DateRange; setCustom: (r: DateRange) => void; range: DateRange }

/** "What was done today / this week" — one hook, one row of chips, an optional custom from–to. */
export function useDateRange(initial: RangePreset = "all"): DateRangeState {
  const [preset, setPreset] = useState<RangePreset>(initial);
  const [custom, setCustom] = useState<DateRange>({});
  return { preset, setPreset, custom, setCustom, range: preset === "custom" ? custom : rangeFor(preset) };
}

const DEFAULT: RangePreset[] = ["today", "week", "7d", "30d", "all", "custom"];

export function DateRangePicker({ state, presets = DEFAULT, compact }: { state: DateRangeState; presets?: RangePreset[]; compact?: boolean }) {
  const { preset, setPreset, custom, setCustom } = state;
  return <div className={`daterange ${compact ? "daterange--compact" : ""}`}>
    <div className="chips">{presets.map((p) => <button key={p} type="button" className={`chip ${preset === p ? "chip--on" : ""}`} onClick={() => setPreset(p)}>{RANGE_LABEL[p]}</button>)}</div>
    {preset === "custom" && <div className="row daterange__custom">
      <input className="ns-input" type="date" aria-label="From" value={custom.from ?? ""} max={custom.to} onChange={(e) => setCustom({ ...custom, from: e.target.value || undefined })} />
      <span className="sm muted">to</span>
      <input className="ns-input" type="date" aria-label="To" value={custom.to ?? ""} min={custom.from} onChange={(e) => setCustom({ ...custom, to: e.target.value || undefined })} />
    </div>}
  </div>;
}
