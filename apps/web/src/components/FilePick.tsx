import { useRef, useState } from "react";

export type Pick = { fileName: string; url: string; size: number; file: File; caption?: string };

const KB = 1024, MB = KB * 1024;
export const human = (n: number) => (n < MB ? `${Math.round(n / KB)} KB` : `${(n / MB).toFixed(1)} MB`);
/** Matches the backend's FILE_UPLOAD_MAX_MEMORY_SIZE. */
export const MAX_BYTES = 25 * MB;

/**
 * Real file input for the office screens. Holds the File itself so the API layer can upload the bytes;
 * the field app uses CameraInput instead, which opens the rear camera.
 */
export function FilePick({ picks, onChange, label = "Choose file", accept = "image/*,application/pdf", multiple = false, required, hint, captions = false, captionPlaceholder = "Label this photo…" }:
  { picks: Pick[]; onChange: (p: Pick[]) => void; label?: string; accept?: string; multiple?: boolean; required?: boolean; hint?: string; captions?: boolean; captionPlaceholder?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState("");
  const take = (files: FileList | null) => {
    if (!files?.length) return;
    const tooBig = Array.from(files).filter((f) => f.size > MAX_BYTES);
    if (tooBig.length) { setErr(`${tooBig[0].name} is ${human(tooBig[0].size)} — the limit is ${human(MAX_BYTES)}`); if (ref.current) ref.current.value = ""; return; }
    setErr("");
    const next = Array.from(files).map((f) => ({ fileName: f.name, url: URL.createObjectURL(f), size: f.size, file: f }));
    onChange(multiple ? [...picks, ...next] : next.slice(0, 1));
    if (ref.current) ref.current.value = "";
  };
  const drop = (e: React.DragEvent) => { e.preventDefault(); take(e.dataTransfer.files); };
  // The button is the LAST child so its bottom edge lines up with the inputs beside it in a `.form` grid,
  // which aligns items to the end. Chips and errors stack above it so they never push it out of line.
  // `hint` becomes the tooltip rather than in-flow text, which would make this cell taller than its neighbours.
  return (
    <div className="filepick" onDragOver={(e) => e.preventDefault()} onDrop={drop}>
      {picks.length > 0 && <div className={`filepick__list ${captions ? "filepick__list--captioned" : ""}`}>
        {picks.map((p, i) => <span key={i} className="filepick__chip">
          {p.file.type.startsWith("image/") ? <img src={p.url} alt="" /> : <span className="filepick__doc">📄</span>}
          <span className="filepick__meta">
            <span className="filepick__name" title={p.fileName}>{p.fileName} <span className="muted">{human(p.size)}</span></span>
            {captions && <input className="ns-input filepick__caption" value={p.caption ?? ""} placeholder={captionPlaceholder}
              onChange={(e) => onChange(picks.map((q, j) => (j === i ? { ...q, caption: e.target.value } : q)))} />}
          </span>
          <button type="button" aria-label={`Remove ${p.fileName}`} onClick={() => onChange(picks.filter((_, j) => j !== i))}>✕</button>
        </span>)}
      </div>}
      {err && <span className="sm filepick__err">{err}</span>}
      <button type="button" title={hint} className={`filepick__btn ${required && !picks.length ? "filepick__btn--req" : ""}`} onClick={() => ref.current?.click()}>
        📎 {picks.length && !multiple ? "Replace file" : label}{required && !picks.length ? " (required)" : ""}
      </button>
      <input ref={ref} type="file" accept={accept} multiple={multiple} hidden onChange={(e) => take(e.target.files)} />
    </div>
  );
}
