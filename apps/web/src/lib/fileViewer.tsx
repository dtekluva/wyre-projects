import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import { useApi } from "./useApi";

export type ViewTarget = { kind: "document" | "attachment"; id: string };
/** Open a file. Pass the surrounding files too and the viewer steps through them with ← → instead of closing. */
type Open = (t: ViewTarget, siblings?: ViewTarget[]) => void;
const Ctx = createContext<Open>(() => {});
export const useFileViewer = () => useContext(Ctx);

const isImage = (mime?: string, name?: string) =>
  (mime ?? "").startsWith("image/") || /\.(jpe?g|png|gif|webp|avif|bmp|svg)$/i.test(name ?? "");
const isPdf = (mime?: string, name?: string) => (mime ?? "").includes("pdf") || /\.pdf$/i.test(name ?? "");

/** Single in-app viewer. Files open here rather than in a new tab, which keeps the reviewer on the page. */
export function FileViewerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ target: ViewTarget; siblings: ViewTarget[] } | null>(null);
  const open = useCallback<Open>((target, siblings) => setState({ target, siblings: siblings ?? [] }), []);
  return <Ctx.Provider value={open}>{children}
    {state && <FileModal target={state.target} siblings={state.siblings} onStep={(t) => setState({ ...state, target: t })} onClose={() => setState(null)} />}
  </Ctx.Provider>;
}

function FileModal({ target, siblings, onStep, onClose }: { target: ViewTarget; siblings: ViewTarget[]; onStep: (t: ViewTarget) => void; onClose: () => void }) {
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

  // Where we are in the gallery, if we came from one.
  const at = siblings.findIndex((s) => s.kind === target.kind && s.id === target.id);
  const prev = at > 0 ? siblings[at - 1] : undefined;
  const next = at >= 0 && at < siblings.length - 1 ? siblings[at + 1] : undefined;

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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft" && prev) onStep(prev);
      else if (e.key === "ArrowRight" && next) onStep(next);
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("modal-open");
    return () => { document.removeEventListener("keydown", onKey); document.body.classList.remove("modal-open"); };
  }, [close, prev, next, onStep]);

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
          {siblings.length > 1 && <button className="modal__nav modal__nav--prev" onClick={() => prev && onStep(prev)} disabled={!prev} aria-label="Previous file" title="Previous (←)">‹</button>}
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
          {siblings.length > 1 && <button className="modal__nav modal__nav--next" onClick={() => next && onStep(next)} disabled={!next} aria-label="Next file" title="Next (→)">›</button>}
        </div>
        <footer className="modal__foot">
          {url && <a className="ns-btn ns-btn--secondary ns-btn--sm" href={url} target="_blank" rel="noopener noreferrer">Open original</a>}
          {url && <a className="ns-btn ns-btn--ghost ns-btn--sm" href={url} download={fileName}>Download</a>}
          {siblings.length > 1 && at >= 0 && <span className="sm muted modal__count">{at + 1} / {siblings.length}</span>}
          <button className="ns-btn ns-btn--primary ns-btn--sm right" onClick={close}>Close</button>
        </footer>
      </div>
    </div>
  );
}
