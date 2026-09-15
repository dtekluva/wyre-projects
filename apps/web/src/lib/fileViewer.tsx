import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import { useApi } from "./useApi";

export type ViewTarget = { kind: "document" | "attachment"; id: string };
const Ctx = createContext<(t: ViewTarget) => void>(() => {});
export const useFileViewer = () => useContext(Ctx);

const isImage = (mime?: string, name?: string) =>
  (mime ?? "").startsWith("image/") || /\.(jpe?g|png|gif|webp|avif|bmp|svg)$/i.test(name ?? "");
const isPdf = (mime?: string, name?: string) => (mime ?? "").includes("pdf") || /\.pdf$/i.test(name ?? "");

/** Single in-app viewer. Files open here rather than in a new tab, which keeps the reviewer on the page. */
export function FileViewerProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<ViewTarget | null>(null);
  return <Ctx.Provider value={setTarget}>{children}{target && <FileModal target={target} onClose={() => setTarget(null)} />}</Ctx.Provider>;
}

function FileModal({ target, onClose }: { target: ViewTarget; onClose: () => void }) {
  const store = useApi();
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [broken, setBroken] = useState(false);

  const doc = target.kind === "document" ? store.documents.find((d) => d.id === target.id) : undefined;
  const att = target.kind === "attachment" ? store.attachments.find((a) => a.id === target.id) : undefined;
  const fileName = doc?.fileName ?? att?.fileName ?? "file";
  const title = doc?.title ?? att?.caption ?? fileName;
  const mime = att?.mime;
  const meta = doc
    ? `v${doc.version} · ${store.userName(doc.submittedBy)} · ${doc.sizeBytes ? Math.round(doc.sizeBytes / 1024) + " KB" : ""}`
    : att ? `${store.userName(att.uploadedBy)} · ${att.sizeBytes ? Math.round(att.sizeBytes / 1024) + " KB" : ""}${att.gps ? " · GPS" : ""}` : "";

  useEffect(() => {
    let live = true;
    setState("loading"); setUrl(null); setBroken(false);
    api.fileUrl(target.kind, target.id)
      .then((u) => { if (!live) return; if (!u) { setState("missing"); return; } setUrl(u); setState("ready"); })
      .catch(() => { if (live) setState("error"); });
    return () => { live = false; };
  }, [target.kind, target.id]);

  const close = useCallback(() => onClose(), [onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("modal-open");
    return () => { document.removeEventListener("keydown", onKey); document.body.classList.remove("modal-open"); };
  }, [close]);

  const image = isImage(mime, fileName) && !broken;
  const pdf = isPdf(mime, fileName);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal__panel">
        <header className="modal__head">
          <div style={{ minWidth: 0 }}>
            <div className="modal__title ellipsis">{title}</div>
            <div className="sm muted ellipsis">{fileName}{meta && ` · ${meta}`}</div>
          </div>
          <button className="modal__x" onClick={close} aria-label="Close">✕</button>
        </header>
        <div className="modal__body">
          {state === "loading" && <div className="modal__note muted">Loading…</div>}
          {state === "missing" && <div className="modal__note"><b>No file was uploaded with this record.</b>
            <div className="sm muted">It was created before uploads were wired up, or as demo data.</div></div>}
          {state === "error" && <div className="modal__note"><b>Could not load this file.</b>
            <div className="sm muted">The link may have expired. Close and try again.</div></div>}
          {state === "ready" && url && (
            image ? <img className="modal__img" src={url} alt={title} onError={() => setBroken(true)} />
            : pdf ? <iframe className="modal__frame" src={url} title={title} />
            : <div className="modal__note"><b>{broken ? "This file isn't a viewable image." : "No preview for this file type."}</b>
                <div className="sm muted">{fileName}</div></div>
          )}
        </div>
        <footer className="modal__foot">
          {url && <a className="ns-btn ns-btn--secondary ns-btn--sm" href={url} target="_blank" rel="noopener noreferrer">Open original</a>}
          {url && <a className="ns-btn ns-btn--ghost ns-btn--sm" href={url} download={fileName}>Download</a>}
          <button className="ns-btn ns-btn--primary ns-btn--sm right" onClick={close}>Close</button>
        </footer>
      </div>
    </div>
  );
}
