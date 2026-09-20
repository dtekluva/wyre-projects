import { useMemo, useState, type ReactNode } from "react";
import { flattenFiles, type FileEntry, type FileSection } from "@wyre/api";
import { FileTile } from "./FileTile";
import { Empty } from "./ui";

type Filter = "all" | "pending" | "rejected" | "expiring";
const FILTERS: { key: Filter; label: string; test: (e: FileEntry) => boolean }[] = [
  { key: "all", label: "All", test: () => true },
  { key: "pending", label: "Pending check", test: (e) => e.status === "pending" },
  { key: "rejected", label: "Rejected", test: (e) => e.status === "rejected" },
  { key: "expiring", label: "Expiring", test: (e) => e.expiring },
];
const text = (e: FileEntry) => (e.kind === "document"
  ? `${e.doc.title} ${e.doc.fileName} ${e.doc.docType} ${e.doc.issuer ?? ""}`
  : `${e.att.caption ?? ""} ${e.att.fileName} ${e.via?.label ?? ""}`).toLowerCase();

const readSet = (key: string): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(key) ?? "[]")); } catch { return new Set(); } };
const writeSet = (key: string, s: Set<string>) => { try { localStorage.setItem(key, JSON.stringify([...s])); } catch { /* per-browser nicety only */ } };

/**
 * Sectioned wall of tiles with the filters that matter for action — pending, rejected, expiring — and a search.
 * `extras` lets a caller keep a form inside a section (the direct-upload form lives in "Photos & files"), and a
 * section that carries one stays visible even when empty, so the way in never disappears.
 */
export function FileGallery({ sections, storageKey, extras = {}, empty }:
  { sections: FileSection[]; storageKey: string; extras?: Record<string, ReactNode>; empty?: { title: string; hint?: string } }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [closed, setClosed] = useState<Set<string>>(() => readSet(`wyre.gallery.${storageKey}`));
  const toggle = (k: string) => { const n = new Set(closed); if (n.has(k)) n.delete(k); else n.add(k); setClosed(n); writeSet(`wyre.gallery.${storageKey}`, n); };

  const all = flattenFiles(sections);
  const counts = { pending: all.filter((e) => e.status === "pending").length, rejected: all.filter((e) => e.status === "rejected").length, expiring: all.filter((e) => e.expiring).length };
  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)!.test; const needle = q.trim().toLowerCase();
    return sections.map((s) => ({ ...s, entries: s.entries.filter((e) => f(e) && (!needle || text(e).includes(needle))) }))
      .filter((s) => s.entries.length || extras[s.key]);
  }, [sections, filter, q, extras]);
  const visible = shown.reduce((n, s) => n + s.entries.length, 0);

  return (
    <div className="gallery">
      <div className="gallery__bar">
        <div className="sm muted grow">
          <b>{all.length}</b> file{all.length === 1 ? "" : "s"}
          {counts.pending > 0 && <> · <b>{counts.pending}</b> pending check</>}
          {counts.rejected > 0 && <> · <b style={{ color: "var(--ns-chart-bad)" }}>{counts.rejected}</b> rejected</>}
          {counts.expiring > 0 && <> · <b>{counts.expiring}</b> expiring</>}
          {(filter !== "all" || q) && <> · showing {visible}</>}
        </div>
        <div className="filters" style={{ margin: 0 }}>
          {FILTERS.map((f) => { const n = f.key === "all" ? all.length : counts[f.key]; return (
            <button key={f.key} type="button" className={`chip ${filter === f.key ? "chip--on" : ""}`} onClick={() => setFilter(f.key)} disabled={f.key !== "all" && n === 0}>
              {f.label}{f.key !== "all" && n > 0 && <span className="chip__n">{n}</span>}
            </button>); })}
          <input className="ns-input gallery__search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles, captions, files" aria-label="Search files" />
        </div>
      </div>

      {shown.length === 0 && (all.length === 0
        ? <Empty title={empty?.title ?? "No files yet"} hint={empty?.hint} />
        : <Empty title="Nothing matches" hint="Clear the filter or search to see everything." />)}

      {shown.map((s) => {
        const open = !closed.has(s.key);
        const siblings = s.entries.map((e) => ({ kind: e.kind, id: e.id }));
        return (
          <section key={s.key} className={`gsec ${open ? "" : "gsec--closed"}`}>
            <button type="button" className="gsec__head" onClick={() => toggle(s.key)} aria-expanded={open}>
              <span className="gsec__chev" aria-hidden>▾</span>
              {s.stage !== undefined && <span className="ns-mono muted">{s.stage}</span>}
              <span className="gsec__title">{s.title}</span>
              <span className="sm muted">{s.entries.length}{s.hint && ` · ${s.hint}`}</span>
            </button>
            {open && <div className="gsec__body">
              {extras[s.key]}
              {s.entries.length
                ? <div className="gallery__grid">{s.entries.map((e) => <FileTile key={`${e.kind}:${e.id}`} e={e} siblings={siblings} />)}</div>
                : <div className="sm muted" style={{ padding: "4px 0 8px" }}>Nothing here yet.</div>}
            </div>}
          </section>
        );
      })}
    </div>
  );
}
