import { useState } from "react";
import { DOC_TYPE_LABEL, relative, type FileEntry } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useFileViewer, type ViewTarget } from "../lib/fileViewer";
import { VoidControl } from "./VoidControl";

const looksLikeImage = (name: string, mime?: string) => (mime ?? "").startsWith("image/") || /\.(jpe?g|png|gif|webp|avif|bmp)$/i.test(name);
const ext = (name: string) => name.split(".").pop()?.toUpperCase().slice(0, 4) || "FILE";

/**
 * One tile for anything in the gallery — a document or an attachment — so a wall of them reads evenly.
 * Status is a corner pip on the picture itself: a hundred tiles still show what needs action without a word read.
 */
export function FileTile({ e, siblings }: { e: FileEntry; siblings: ViewTarget[] }) {
  const api = useApi(); const view = useFileViewer();
  const [broken, setBroken] = useState(false);
  const name = e.kind === "document" ? e.doc.fileName : e.att.fileName;
  const url = e.kind === "document" ? e.doc.url : e.att.url;
  const mime = e.kind === "attachment" ? e.att.mime : undefined;
  const img = !!url && looksLikeImage(name, mime) && !broken;
  const title = e.kind === "document" ? e.doc.title : (e.att.caption || e.att.fileName);
  const by = e.kind === "document" ? e.doc.submittedBy : e.att.uploadedBy;
  const sub = e.kind === "document" ? `${DOC_TYPE_LABEL[e.doc.docType]} · v${e.doc.version}` : e.via?.label;
  const pip = e.status === "rejected" ? { cls: "ftile__pip--bad", text: "rejected" }
    : e.status === "pending" ? { cls: "ftile__pip--warn", text: "pending check" }
    : e.expiring ? { cls: "ftile__pip--warn", text: "expires soon" } : null;
  return (
    <div className="ftile">
    <button type="button" className="ftile__open" title={`Open ${name}`} onClick={() => view({ kind: e.kind, id: e.id }, siblings)}>
      <span className={`ftile__thumb ${img ? "" : "ftile__thumb--ph"}`}>
        {img ? <img src={url} alt={title} loading="lazy" onError={() => setBroken(true)} /> : <span className="ftile__ext">{ext(name)}</span>}
        {pip && <span className={`ftile__pip ${pip.cls}`}>{pip.text}</span>}
        {e.kind === "attachment" && e.att.gps && <span className="ftile__gps" title="GPS captured">◎</span>}
      </span>
      <span className="ftile__title ellipsis">{title}</span>
      {sub && <span className="ftile__sub ellipsis" title={sub}>{sub}</span>}
      <span className="ftile__meta ellipsis">{api.userName(by)} · {relative(e.at)}</span>
    </button>
    <span className="ftile__void"><VoidControl kind={e.kind} id={e.id} projectId={e.kind === "document" ? e.doc.projectId : e.att.projectId} size="xs" /></span>
    </div>
  );
}
