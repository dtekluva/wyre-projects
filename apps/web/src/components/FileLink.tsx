import { useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../lib/toast";

/**
 * Opens a stored file. The signed link is resolved on click rather than taken from the snapshot, because
 * signatures are short-lived and a page left open would otherwise hand out a dead link.
 */
export function FileLink({ kind, id, children, className = "link", title }:
  { kind: "document" | "attachment"; id: string; children: React.ReactNode; className?: string; title?: string }) {
  const toast = useToast(); const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try {
      const url = await api.fileUrl(kind, id);
      if (!url) { toast("No file was uploaded with this record", "info"); return; }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      toast("Could not open the file", "error");
    } finally { setBusy(false); }
  };
  return <button type="button" className={className} onClick={open} disabled={busy} title={title}>{children}</button>;
}
