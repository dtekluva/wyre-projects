import { useRef, useState } from "react";
export type Shot = { fileName: string; url: string; size: number; file: File };
/** Camera-first file input: on phones opens the rear camera; on desktop a file picker. Keeps object-URL previews only. */
export function CameraInput({ shots, onChange, label = "Add photo", required }: { shots: Shot[]; onChange: (s: Shot[]) => void; label?: string; required?: boolean }) {
  const ref = useRef<HTMLInputElement>(null); const [busy, setBusy] = useState(false);
  const pick = (files: FileList | null) => { if (!files) return; setBusy(true);
    const next = Array.from(files).map((f) => ({ fileName: f.name || `photo-${Date.now()}.jpg`, url: URL.createObjectURL(f), size: f.size, file: f }));
    onChange([...shots, ...next]); setBusy(false); if (ref.current) ref.current.value = ""; };
  return <div className="cam">
    <div className="cam__thumbs">{shots.map((s, i) => <div key={i} className="cam__thumb"><img src={s.url} alt="" /><button type="button" aria-label="Remove" onClick={() => onChange(shots.filter((_, j) => j !== i))}>✕</button></div>)}
      <button type="button" className={`cam__add ${required && !shots.length ? "cam__add--req" : ""}`} onClick={() => ref.current?.click()} disabled={busy}>📷<span>{label}{required && !shots.length ? " (required)" : ""}</span></button></div>
    <input ref={ref} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => pick(e.target.files)} />
  </div>;
}
