import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { DOC_TYPE_LABEL, STAGES, bytes, fmtDate, relative, type DocType, type Document, type Project } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { useSafe } from "../lib/toast";
import { Badge, Empty, Note, ReviewBadge } from "../components/ui";

const stageOf = (t: DocType) => STAGES.find((s) => s.evidence.includes(t));

function DocRow({ d }: { d: Document }) {
  const api = useApi();
  const ext = d.fileName.split(".").pop()?.toUpperCase().slice(0, 4) ?? "DOC";
  const expiring = d.expiresAt && new Date(d.expiresAt).getTime() - Date.now() < 90 * 86400000;
  return (
    <div className="doc">
      <span className="doc__icon">{ext}</span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="doc__title ellipsis">{d.title} <span className="muted sm">v{d.version}</span></div>
        <div className="doc__meta">{DOC_TYPE_LABEL[d.docType]} · {bytes(d.sizeBytes)} · submitted by <b>{api.userName(d.submittedBy)}</b> {relative(d.submittedAt)}
          {d.checkedBy && <> · checked by <b>{api.userName(d.checkedBy)}</b></>}{d.issuer && <> · issuer {d.issuer}</>}{d.expiresAt && <> · expires {fmtDate(d.expiresAt)}</>}</div>
        {d.reviewStatus === "rejected" && d.checkComment && <div className="note note--danger" style={{ marginTop: 6 }}>Rejected: {d.checkComment}</div>}
      </div>
      {expiring && d.reviewStatus === "checked" && <Badge variant="warning">expires soon</Badge>}
      <ReviewBadge status={d.reviewStatus} />
    </div>
  );
}

export function ProjectDocuments() {
  const p = useOutletContext<Project>(); const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const docs = api.listDocuments(p.id); const atts = api.listAttachments(p.id);
  const canDoc = api.can(user.id, "document.create", p.id); const canAtt = api.can(user.id, "attachment.create", p.id);
  const gate = api.gateStatus(p.id);
  const [dt, setDt] = useState<DocType>(gate.items.find((i) => i.state !== "ok")?.docType ?? "other"); const [title, setTitle] = useState("");
  const [fn, setFn] = useState(""); const [cap, setCap] = useState("");
  const groups = STAGES.map((s) => ({ s, docs: docs.filter((d) => stageOf(d.docType)?.stage === s.stage) })).filter((g) => g.docs.length);
  const other = docs.filter((d) => !stageOf(d.docType));
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="card">
        <div className="card__head"><div className="card__title">Add a document</div><span className="sm muted">Enters the review queue as <b>pending check</b></span></div>
        <div className="card__body">
          {canDoc ? <form className="form" onSubmit={(e) => { e.preventDefault(); if (safe(() => { api.addDocument(user.id, p.id, { docType: dt, title: title.trim() || DOC_TYPE_LABEL[dt] }); }, "Submitted for check")) setTitle(""); }}>
            <label className="ns-field"><span className="ns-field__label">Type</span>
              <select className="ns-input" value={dt} onChange={(e) => setDt(e.target.value as DocType)}>
                {STAGES.filter((s) => s.evidence.length).map((s) => <optgroup key={s.stage} label={`${s.stage} · ${s.name}`}>{s.evidence.map((t) => <option key={t} value={t}>{DOC_TYPE_LABEL[t]}</option>)}</optgroup>)}
                <optgroup label="Other"><option value="contract">Contract</option><option value="other">Other</option></optgroup></select></label>
            <label className="ns-field"><span className="ns-field__label">Title</span><input className="ns-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={DOC_TYPE_LABEL[dt]} /></label>
            <button className="ns-btn ns-btn--primary" type="submit">Submit document</button>
          </form> : <Note tone="warn">Your role cannot add documents to this project.</Note>}
        </div>
      </div>

      {groups.map(({ s, docs: ds }) => <div key={s.stage} className="card">
        <div className="card__head"><div className="card__title"><span className="ns-mono muted">{s.stage}</span> {s.name}</div><span className="sm muted">{ds.length} document{ds.length > 1 ? "s" : ""}</span></div>
        {ds.map((d) => <DocRow key={d.id} d={d} />)}
      </div>)}
      {other.length > 0 && <div className="card"><div className="card__head"><div className="card__title">Other documents</div></div>{other.map((d) => <DocRow key={d.id} d={d} />)}</div>}
      {docs.length === 0 && <Empty title="No documents yet" hint="Add the evidence required by the current gate." />}

      <div className="card">
        <div className="card__head"><div className="card__title">Photos & files</div><span className="sm muted">{atts.length} uploads · GPS + sha256 captured</span></div>
        <div className="card__body stack">
          {canAtt ? <form className="form--inline" onSubmit={(e) => { e.preventDefault(); if (safe(() => { api.addAttachment(user.id, p.id, { fileName: fn.trim() || `photo-${Date.now()}.jpg`, caption: cap.trim() || undefined }); }, "Uploaded — pending check")) { setFn(""); setCap(""); } }}>
            <label className="ns-field grow"><span className="ns-field__label">File name</span><input className="ns-input" value={fn} onChange={(e) => setFn(e.target.value)} placeholder="site-roof-string-4.jpg" /></label>
            <label className="ns-field grow"><span className="ns-field__label">Caption</span><input className="ns-input" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="What does this show?" /></label>
            <button className="ns-btn ns-btn--secondary" type="submit">Upload (mock)</button>
          </form> : <Note tone="warn">Your role cannot upload to this project.</Note>}
          {atts.length ? <div className="photo-grid">{atts.map((a) => <div key={a.id} className="photo">
            <div className="photo__img">{a.kind === "image" ? "📷" : "📄"} {a.fileName}</div>
            <div className="photo__cap"><div className="ellipsis" title={a.caption}>{a.caption ?? "—"}</div>
              <div className="sm muted">{api.userName(a.uploadedBy)} · {relative(a.uploadedAt)}{a.gps && " · GPS"}</div><div style={{ marginTop: 4 }}><ReviewBadge status={a.reviewStatus} /></div></div>
          </div>)}</div> : <Empty title="No uploads yet" />}
        </div>
      </div>
    </div>
  );
}
