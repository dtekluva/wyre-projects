import { COST_CATEGORY_LABEL, naira, pct, type CostCategory, type ProjectMoney } from "@wyre/api";
import { Badge, Empty } from "./ui";

const CATS: CostCategory[] = ["equipment", "civil", "labour", "logistics", "permits", "contingency", "om"];
type Row = { key: string; label: string; planned: number; committed: number; actual: number; total?: boolean };

/**
 * Budget vs committed vs spent, by category. The track is ALWAYS the budget — committed and spent draw against
 * it and clamp at the end; anything past it is said by a badge, not drawn or recoloured. Identity colours never
 * change (dark = spent, light = committed). A row with nothing to say stays quiet.
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
        <span />
      </div>
      {all.map((r) => {
        const peak = Math.max(r.committed, r.actual);
        const over = r.planned > 0 && peak > r.planned;
        const unbudgeted = r.planned === 0 && peak > 0;
        const ratio = r.planned > 0 ? Math.round(peak / r.planned * 100) : 0;
        const title = `${r.label}: spent ${naira(r.actual)} · committed ${naira(r.committed)} · budget ${naira(r.planned)}`;
        return (
          <div key={r.key} className={`catrow ${r.total ? "catrow--total" : ""}`} title={title}>
            <span className="catrow__label">{r.label}</span>
            {r.total ? <span /> : r.planned > 0
              ? <div className="catrow__track"><i className="catrow__committed" style={{ width: `${Math.min(100, pct(r.committed, r.planned))}%` }} /><i className="catrow__actual" style={{ width: `${Math.min(100, pct(r.actual, r.planned))}%` }} /></div>
              : <div className="catrow__track catrow__track--none" />}
            <span className={`catrow__num ${r.actual ? "" : "catrow__num--zero"}`} data-h="Spent">{naira(r.actual, true)}</span>
            <span className={`catrow__num ${r.committed ? "" : "catrow__num--zero"}`} data-h="Committed">{naira(r.committed, true)}</span>
            <span className={`catrow__num ${r.planned ? "" : "catrow__num--zero"}`} data-h="Budget">{naira(r.planned, true)}</span>
            <span className="catrow__badge">
              {over && <Badge variant="danger">{ratio.toLocaleString()}% of budget</Badge>}
              {unbudgeted && <Badge variant="warning">unbudgeted</Badge>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
