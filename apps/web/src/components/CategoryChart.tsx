import { COST_CATEGORY_LABEL, naira, pct, type CostCategory, type ProjectMoney } from "@wyre/api";
import { Empty } from "./ui";

const CATS: CostCategory[] = ["equipment", "civil", "labour", "logistics", "permits", "contingency", "om"];
type Row = { key: string; label: string; planned: number; committed: number; actual: number; total?: boolean };

/**
 * Budget vs committed vs spent, by category. The track is ALWAYS the budget — committed and spent draw against
 * it and clamp at the end. What is past the end is a NUMBER in its own column — "% of budget", on every row,
 * red past 100% — not a pill that appears on some rows and not others. Identity colours never change.
 */
export function CategoryChart({ m }: { m: ProjectMoney }) {
  const rows: Row[] = CATS.map((c) => ({ key: c, label: COST_CATEGORY_LABEL[c], ...m.byCategory[c] })).filter((r) => r.planned || r.committed || r.actual);
  if (!rows.length) return <Empty title="No checked budget lines yet" hint="Add budget lines below; POs and actuals then show against them." />;
  const all: Row[] = [...rows, { key: "total", label: "Total", planned: m.planned, committed: m.committed, actual: m.actual, total: true }];
  return (
    <div className="catchart">
      <div className="catrow catrow--head" aria-hidden>
        <span /><span />
        <span className="catrow__num"><i className="catrow__sw catrow__sw--actual" />Spent</span>
        <span className="catrow__num"><i className="catrow__sw catrow__sw--committed" />Committed</span>
        <span className="catrow__num">Budget</span>
        <span className="catrow__num">Of budget</span>
      </div>
      {all.map((r) => {
        const peak = Math.max(r.committed, r.actual);
        const ratio = r.planned > 0 ? Math.round(peak / r.planned * 100) : 0;
        const tone = r.planned === 0 ? (peak > 0 ? "catrow__pct--warn" : "catrow__num--zero") : ratio > 100 ? "catrow__pct--bad" : ratio === 0 ? "catrow__num--zero" : "";
        const used = r.planned === 0 ? (peak > 0 ? "unbudgeted" : "—") : `${ratio.toLocaleString()}%`;
        const title = `${r.label}: spent ${naira(r.actual)} · committed ${naira(r.committed)} · budget ${naira(r.planned)}`;
        return (
          <div key={r.key} className={`catrow ${r.total ? "catrow--total" : ""}`} title={title}>
            <span className="catrow__label">{r.label}</span>
            {r.total ? <div className="catrow__track catrow__track--blank" /> : r.planned > 0
              ? <div className="catrow__track"><i className="catrow__committed" style={{ width: `${Math.min(100, pct(r.committed, r.planned))}%` }} /><i className="catrow__actual" style={{ width: `${Math.min(100, pct(r.actual, r.planned))}%` }} /></div>
              : <div className="catrow__track catrow__track--none" />}
            <span className={`catrow__num ${r.actual ? "" : "catrow__num--zero"}`} data-h="Spent">{naira(r.actual, true)}</span>
            <span className={`catrow__num ${r.committed ? "" : "catrow__num--zero"}`} data-h="Committed">{naira(r.committed, true)}</span>
            <span className={`catrow__num ${r.planned ? "" : "catrow__num--zero"}`} data-h="Budget">{naira(r.planned, true)}</span>
            <span className={`catrow__num catrow__pct ${tone}`} data-h="Of budget">{used}</span>
          </div>
        );
      })}
    </div>
  );
}
