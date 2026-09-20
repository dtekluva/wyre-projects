import { useState } from "react";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { useSafe } from "../lib/toast";
import { ReviewCard } from "../components/ReviewCard";
import { Empty, Note } from "../components/ui";

export function ReviewQueue() {
  const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const queue = api.reviewQueue(user.id); const [sel, setSel] = useState<Set<string>>(new Set());
  const canAny = api.can(user.id, "document.check") || api.can(user.id, "attachment.check") || api.getUsers().length > 0 && api.projects.some((p) => api.can(user.id, "document.check", p.id) || api.can(user.id, "attachment.check", p.id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const bulk = () => { let n = 0; queue.filter((i) => sel.has(i.id)).forEach((i) => { if (safe(() => api.check(i.kind, i.id, user.id, "checked"))) n++; }); setSel(new Set()); if (n) safe(() => {}, `${n} item${n > 1 ? "s" : ""} checked`); };
  const overdue = queue.filter((i) => i.overdue).length;
  return (
    <>
      <div className="page-head"><div><h1 className="page-title">Review queue</h1><div className="page-sub">Maker-checker · {queue.length} input{queue.length === 1 ? "" : "s"} awaiting your check{overdue ? ` · ${overdue} overdue` : ""}</div></div>
        {sel.size > 0 && <button className="ns-btn ns-btn--primary" onClick={bulk}>✓ Check {sel.size} selected</button>}</div>
      <div style={{ marginBottom: 16 }}><Note tone="info">You only see items you are allowed to check on projects you belong to, and — unless you are Finance, a Director or the Store Keeper — never your own submissions. Rejections require a comment and go back to the maker. Nothing counts toward a gate, a rollup or a dashboard until it is checked.</Note></div>
      {queue.length === 0 ? <Empty title="Your queue is empty" hint={canAny ? "Nothing is waiting for you right now." : "Your role has no check permissions — Documents are checked by Lead Engineers / Directors, photos by PMs / Lead Engineers."} />
        : <div className="review-grid">{queue.map((i) => <ReviewCard key={i.id} item={i} selected={sel.has(i.id)} onToggle={() => toggle(i.id)} />)}</div>}
    </>
  );
}
