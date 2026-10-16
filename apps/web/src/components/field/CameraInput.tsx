import { useRef, useState } from "react";
export type Shot = { fileName: string; url: string; size: number; file: File; caption?: string };
/** Camera-first file input: on phones opens the rear camera; on desktop a file picker. Keeps object-URL previews only. */
const isVideo = (f: File) => f.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|3gp)$/i.test(f.name);
const Preview = ({ s }: { s: Shot }) => isVideo(s.file) ? <video src={s.url} muted playsInline preload="metadata" /> : <img src={s.url} alt="" />;
/** Photos by default; a clip when the moment needs one (a fault that only shows while running, a walk-through). */
export function CameraInput({ shots, onChange, label = "Add photo", required, captions = false, video = true }: { shots: Shot[]; onChange: (s: Shot[]) => void; label?: string; required?: boolean; captions?: boolean; video?: boolean }) {
  const ref = useRef<HTMLInputElement>(null); const [busy, setBusy] = useState(false);
  const pick = (files: FileList | null) => { if (!files) return; setBusy(true);
    const next = Array.from(files).map((f) => ({ fileName: f.name || `photo-${Date.now()}.jpg`, url: URL.createObjectURL(f), size: f.size, file: f }));
    onChange([...shots, ...next]); setBusy(false); if (ref.current) ref.current.value = ""; };
  return <div className="cam">
    <div className="cam__thumbs">{shots.map((s, i) => <div key={i} className="cam__thumb"><Preview s={s} /><button type="button" aria-label="Remove" onClick={() => onChange(shots.filter((_, j) => j !== i))}>✕</button></div>)}
      <button type="button" className={`cam__add ${required && !shots.length ? "cam__add--req" : ""}`} onClick={() => ref.current?.click()} disabled={busy}>📷<span>{label}{required && !shots.length ? " (required)" : ""}</span></button></div>
    {captions && shots.length > 0 && <div className="cam__captions">{shots.map((s, i) => <label key={i} className="cam__caption">
      <Preview s={s} />
      <input className="finput" value={s.caption ?? ""} placeholder={`Label ${isVideo(s.file) ? "clip" : "photo"} ${i + 1}…`}
        onChange={(e) => onChange(shots.map((q, j) => (j === i ? { ...q, caption: e.target.value } : q)))} />
    </label>)}</div>}
    <input ref={ref} type="file" accept={video ? "image/*,video/*" : "image/*"} capture="environment" multiple hidden onChange={(e) => pick(e.target.files)} />
  </div>;
}
