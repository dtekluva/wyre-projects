import { useState } from "react";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { ApprovalCard } from "../components/ApprovalCard";
import { Empty } from "../components/ui";

export function Approvals() {
  const api = useApi(); const { user } = useAuth();
  const mine = api.approvalsFor(user.id); const pending = api.listApprovals({ status: "pending" });
  const history = api.listApprovals().filter((a) => a.status !== "pending");
  const [tab, setTab] = useState<"mine" | "pending" | "history">(mine.length ? "mine" : "pending");
  const list = tab === "mine" ? mine : tab === "pending" ? pending : history;
  return (
    <>
      <div className="page-head"><div><h1 className="page-title">Approvals</h1><div className="page-sub">Stage gates, purchase orders, change orders, retention · segregation of duties enforced</div></div></div>
      <div className="filters">
        <button className={`chip ${tab === "mine" ? "chip--on" : ""}`} onClick={() => setTab("mine")}>Awaiting me ({mine.length})</button>
        <button className={`chip ${tab === "pending" ? "chip--on" : ""}`} onClick={() => setTab("pending")}>All pending ({pending.length})</button>
        <button className={`chip ${tab === "history" ? "chip--on" : ""}`} onClick={() => setTab("history")}>History ({history.length})</button>
      </div>
      {list.length === 0 ? <Empty title={tab === "mine" ? "Nothing awaiting your approval" : "Nothing here"} /> : <div className="review-grid">{list.map((a) => <ApprovalCard key={a.id} a={a} />)}</div>}
    </>
  );
}
