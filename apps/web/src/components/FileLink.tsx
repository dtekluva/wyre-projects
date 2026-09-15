import { useFileViewer } from "../lib/fileViewer";

/** Opens a stored file in the in-app viewer. The signed link is resolved there, on click, because signatures
 *  are short-lived and a page left open would otherwise hand out a dead one. */
export function FileLink({ kind, id, children, className = "link", title }:
  { kind: "document" | "attachment"; id: string; children: React.ReactNode; className?: string; title?: string }) {
  const view = useFileViewer();
  return <button type="button" className={className} title={title} onClick={() => view({ kind, id })}>{children}</button>;
}
