import type { ReactNode } from "react";
import { STAGES, type Stage } from "@wyre/api";
export function StageBar({ stage, action }: { stage: Stage; action?: ReactNode }) {
  return (
    <div className="stagebar-wrap">
      <div className="stagebar" role="list" aria-label="Lifecycle stages">
        {STAGES.map((s) => {
          const cls = s.stage < stage ? "stagebar__step--done" : s.stage === stage ? "stagebar__step--current" : "";
          return <div key={s.stage} role="listitem" className={`stagebar__step ${cls}`} title={s.name}>
            <div className="stagebar__track" /><div className="stagebar__label"><b>{s.stage}</b>{s.short}</div></div>;
        })}
      </div>
      <div className={`stagebar__caption ${action ? "stagebar__caption--action" : ""}`}><span><b>Stage {stage}</b> · {STAGES[stage].name} · {stage} of 8</span>{action && <span className="stagebar__action">{action}</span>}</div>
    </div>
  );
}
