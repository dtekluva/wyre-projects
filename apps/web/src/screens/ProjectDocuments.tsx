import { useState } from "react";
import { FilePick, type Pick } from "../components/FilePick";
import { FileLink } from "../components/FileLink";
import { useOutletContext } from "react-router-dom";
import { DOC_TYPE_LABEL, STAGES, bytes, fmtDate, relative, type Attachment, type DocType, type Document, type Project } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useWaitFor } from "../lib/useWaitFor";
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
      <FileLink kind="document" id={d.id} className="doc__icon doc__icon--btn" title={`Open ${d.fileName}`}>{ext}</FileLink>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="doc__title ellipsis"><FileLink kind="document" id={d.id} title={`Open ${d.fileName}`}>{d.title}</FileLink> <span className="muted sm">v{d.version}</span></div>
        <div className="doc__meta">{DOC_TYPE_LABEL[d.docType]} · {bytes(d.sizeBytes)} · submitted by <b>{api.userName(d.submittedBy)}</b> {relative(d.submittedAt)}
          {d.checkedBy && <> · checked by <b>{api.userName(d.checkedBy)}</b></>}{d.issuer && <> · issuer {d.issuer}</>}{d.expiresAt && <> · expires {fmtDate(d.expiresAt)}</>}</div>
        {d.reviewStatus === "rejected" && d.checkComment && <div className="note note--danger" style={{ marginTop: 6 }}>Rejected: {d.checkComment}</div>}
      </div>
      {expiring && d.reviewStatus === "checked" && <Badge variant="warning">expires soon</Badge>}
      <ReviewBadge status={d.reviewStatus} />
      <Reading doc={d} />
    </div>
  );
}

/** Grid tile for an uploaded photo. Falls back to an icon when the bytes are not a decodable image. */
function PhotoTile({ a }: { a: Attachment }) {
  const [broken, setBroken] = useState(false);
  const showImg = a.url && a.kind === "image" && !broken;
  return (
    <FileLink kind="attachment" id={a.id} className="photo__img photo__img--btn" title={`Open ${a.fileName}`}>
      {showImg
        ? <img src={a.url} alt={a.caption ?? a.fileName} loading="lazy" onError={() => setBroken(true)} />
        : <span className="photo__ph">{a.kind === "image" ? "📷" : "📄"} {a.fileName}</span>}
    </FileLink>
  );
}

/**
 * Ask Claude to read the file, then show what it proposes beside it. Nothing is saved until someone
 * accepts — and accepting goes through the ordinary update, so an already-checked document drops back
 * to pending, because the person who checked it never saw these values.
 */
function Reading({ doc }: { doc: Document }) {
  const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const [open, setOpen] = useState(false);
  const may = api.can(user.id, "document.update", doc.projectId);
  const ext = (api.extractions ?? []).find((e) => e.sourceId === doc.id && !["accepted", "rejected"].includes(e.status));
  useWaitFor(!!ext && (ext.status === "queued" || ext.status === "running"));
  if (!may) return null;

  if (!ext) return <button className="ns-btn ns-btn--ghost ns-btn--sm" title="Read this file and suggest its details"
    onClick={() => safe(() => api.requestExtraction(user.id, "document", doc.id), "Reading — the result appears here shortly")}>Read file</button>;

  if (ext.status === "queued" || ext.status === "running") return <Badge variant="info">reading…</Badge>;
  if (ext.status === "failed") return <span className="row sm" style={{ gap: 6 }}><Badge variant="danger">could not read</Badge>
    <span className="muted" title={ext.error}>{ext.error.slice(0, 60)}</span>
    <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => safe(() => api.rejectExtraction(user.id, ext.id), "Dismissed")}>Dismiss</button></span>;

  const f = ext.fields ?? {};
  const rows: [string, string | null | undefined][] = [["Title", f.title], ["Type", f.doc_type], ["Issuer", f.issuer],
    ["Issued", f.issued_at], ["Expires", f.expires_at], ["Reference", f.reference]];
  const low = f.confidence === "low";

  return <div className="stack" style={{ gap: 6, flexBasis: "100%", marginTop: 8 }}>
    <div className={`note ${low ? "note--warn" : "note--info"}`}>
      <div className="row" style={{ gap: 8 }}><b className="grow">Claude read this file</b>
        <span className="sm muted">{ext.modelName} · ${ext.costUsd.toFixed(4)} · confidence {String(f.confidence ?? "—")}</span></div>
      {f.notes && <div className="sm" style={{ marginTop: 4 }}>{f.notes}</div>}
      <table className="table sm" style={{ marginTop: 8 }}><tbody>{rows.map(([k, v]) => <tr key={k}>
        <td style={{ width: 90 }} className="muted">{k}</td><td>{v || <span className="muted">— not on the page —</span>}</td></tr>)}</tbody></table>
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <button className="ns-btn ns-btn--primary ns-btn--sm"
          onClick={() => safe(() => api.acceptExtraction(user.id, ext.id), "Applied — back to pending check")}>Use these</button>
        <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => safe(() => api.rejectExtraction(user.id, ext.id), "Discarded")}>Discard</button>
        <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => setOpen(!open)}>{open ? "Hide" : "Show"} what it read</button>
      </div>
      {open && <pre className="sm" style={{ whiteSpace: "pre-wrap", maxHeight: 260, overflow: "auto", marginTop: 8 }}>{ext.transcript || "(nothing)"}</pre>}
    </div>
  </div>;
}

export function ProjectDocuments() {
  const p = useOutletContext<Project>(); const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const docs = api.listDocuments(p.id); const atts = api.listAttachments(p.id);
  const canDoc = api.can(user.id, "document.create", p.id); const canAtt = api.can(user.id, "attachment.create", p.id);
  const gate = api.gateStatus(p.id);
  const [dt, setDt] = useState<DocType>(gate.items.find((i) => i.state !== "ok")?.docType ?? "other"); const [title, setTitle] = useState("");
  const [docFile, setDocFile] = useState<Pick[]>([]); const [picks, setPicks] = useState<Pick[]>([]); const [cap, setCap] = useState("");
  const groups = STAGES.map((s) => ({ s, docs: docs.filter((d) => stageOf(d.docType)?.stage === s.stage) })).filter((g) => g.docs.length);
  const other = docs.filter((d) => !stageOf(d.docType));
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="card">
        <div className="card__head"><div className="card__title">Add a document</div><span className="sm muted">Enters the review queue as <b>pending check</b></span></div>
        <div className="card__body">
          {canDoc ? <form className="form" onSubmit={(e) => { e.preventDefault(); if (safe(() => { const f = docFile[0]; api.addDocument(user.id, p.id, { docType: dt, title: title.trim() || DOC_TYPE_LABEL[dt], fileName: f?.fileName, sizeBytes: f?.size, blob: f?.file }); }, "Submitted for check")) { setTitle(""); setDocFile([]); } }}>
            <label className="ns-field"><span className="ns-field__label">Type</span>
              <select className="ns-input" value={dt} onChange={(e) => setDt(e.target.value as DocType)}>
                {STAGES.filter((s) => s.evidence.length).map((s) => <optgroup key={s.stage} label={`${s.stage} · ${s.name}`}>{s.evidence.map((t) => <option key={t} value={t}>{DOC_TYPE_LABEL[t]}</option>)}</optgroup>)}
                <optgroup label="Other"><option value="contract">Contract</option><option value="other">Other</option></optgroup></select></label>
            <label className="ns-field"><span className="ns-field__label">Title</span><input className="ns-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={DOC_TYPE_LABEL[dt]} /></label>
            <label className="ns-field"><span className="ns-field__label">File <span className="muted">· PDF or image, max 25 MB</span></span><FilePick picks={docFile} onChange={setDocFile} required label="Choose document" hint="PDF or image, up to 25 MB" /></label>
            <button className="ns-btn ns-btn--primary" type="submit" disabled={!docFile.length}>Submit document</button>
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
          {canAtt ? <form className="form--inline" onSubmit={(e) => { e.preventDefault(); if (!picks.length) return; if (safe(() => { for (const f of picks) api.addAttachment(user.id, p.id, { fileName: f.fileName, sizeBytes: f.size, blob: f.file, kind: f.file.type.startsWith("image/") ? "image" : "document", caption: cap.trim() || undefined }); }, `${picks.length} upload${picks.length > 1 ? "s" : ""} submitted — pending check`)) { setPicks([]); setCap(""); } }}>
            <label className="ns-field grow"><span className="ns-field__label">Files <span className="muted">· images or PDF, max 25 MB each</span></span><FilePick picks={picks} onChange={setPicks} multiple required label="Choose photos or documents" hint="Images or PDF, up to 25 MB each" /></label>
            <label className="ns-field grow"><span className="ns-field__label">Caption</span><input className="ns-input" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="What does this show?" /></label>
            <button className="ns-btn ns-btn--secondary" type="submit" disabled={!picks.length}>Upload</button>
          </form> : <Note tone="warn">Your role cannot upload to this project.</Note>}
          {atts.length ? <div className="photo-grid">{atts.map((a) => <div key={a.id} className="photo">
            <PhotoTile a={a} />
            <div className="photo__cap"><div className="ellipsis" title={a.caption}>{a.caption ?? "—"}</div>
              <div className="sm muted">{api.userName(a.uploadedBy)} · {relative(a.uploadedAt)}{a.gps && " · GPS"}</div><div style={{ marginTop: 4 }}><ReviewBadge status={a.reviewStatus} /></div></div>
          </div>)}</div> : <Empty title="No uploads yet" />}
        </div>
      </div>
    </div>
  );
}
