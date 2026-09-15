import { useState } from "react";
import { useApi } from "../lib/useApi";
import { FileLink } from "./FileLink";

/**
 * Renders the evidence behind a record. Everywhere the UI used to print a count ("3 photos") it now shows the
 * actual images, because a checker cannot verify what they cannot see.
 */
export function Thumbs({ ids, empty = "—", max = 8, size = "sm" }:
  { ids?: readonly string[]; empty?: string; max?: number; size?: "sm" | "lg" }) {
  const api = useApi();
  const atts = (ids ?? []).map((id) => api.attachments.find((a) => a.id === id)).filter((a): a is NonNullable<typeof a> => !!a);
  if (!atts.length) return <span className="sm muted">{empty}</span>;
  const shown = atts.slice(0, max);
  return (
    <div className={`thumbs thumbs--${size}`}>
      {shown.map((a) => <Thumb key={a.id} att={a} />)}
      {atts.length > shown.length && <span className="sm muted">+{atts.length - shown.length}</span>}
    </div>
  );
}


/** One tile. Falls back to an icon if the stored bytes turn out not to be a decodable image. */
function Thumb({ att }: { att: { id: string; url?: string; kind: string; fileName: string; caption?: string } }) {
  const [broken, setBroken] = useState(false);
  const showImg = att.url && att.kind === "image" && !broken;
  return (
    <FileLink kind="attachment" id={att.id} className="thumb" title={att.caption ?? att.fileName}>
      {showImg
        ? <img src={att.url} alt={att.caption ?? att.fileName} loading="lazy" onError={() => setBroken(true)} />
        : <span className="thumb__ph">{att.kind === "image" ? "📷" : "📄"}</span>}
    </FileLink>
  );
}
