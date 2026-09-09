import { useEffect, useRef, useState } from "react";
/** Sign-on-glass: pointer drawing on a canvas; exposes a PNG data URL (or null when empty). */
export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null); const drawing = useRef(false); const [empty, setEmpty] = useState(true);
  useEffect(() => { const c = ref.current!; const dpr = window.devicePixelRatio || 1; const w = c.clientWidth, h = 160; c.width = w * dpr; c.height = h * dpr; const ctx = c.getContext("2d")!; ctx.scale(dpr, dpr); ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#1E1B4B"; }, []);
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  const down = (e: React.PointerEvent) => { drawing.current = true; ref.current!.setPointerCapture(e.pointerId); const ctx = ref.current!.getContext("2d")!; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); };
  const move = (e: React.PointerEvent) => { if (!drawing.current) return; const ctx = ref.current!.getContext("2d")!; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); if (empty) setEmpty(false); };
  const up = () => { if (!drawing.current) return; drawing.current = false; onChange(ref.current!.toDataURL("image/png")); };
  const clear = () => { const c = ref.current!; const ctx = c.getContext("2d")!; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height); ctx.restore(); setEmpty(true); onChange(null); };
  return <div className="sig"><canvas ref={ref} className="sig__canvas" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} style={{ touchAction: "none" }} aria-label="Signature pad" />
    <div className="row" style={{ justifyContent: "space-between" }}><span className="sm muted">{empty ? "Client signs here" : "Signed"}</span><button type="button" className="ns-btn ns-btn--ghost ns-btn--sm" onClick={clear}>Clear</button></div></div>;
}
