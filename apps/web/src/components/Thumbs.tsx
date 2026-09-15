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
      {shown.map((a) => (
        <FileLink key={a.id} kind="attachment" id={a.id} className="thumb" title={a.caption ?? a.fileName}>
          {a.url && a.kind === "image"
            ? <img src={a.url} alt={a.caption ?? a.fileName} loading="lazy" />
            : <span className="thumb__ph">{a.kind === "image" ? "📷" : "📄"}</span>}
        </FileLink>
      ))}
      {atts.length > shown.length && <span className="sm muted">+{atts.length - shown.length}</span>}
    </div>
  );
}
