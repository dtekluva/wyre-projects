import { STAGES, type StageDef } from "./gates";
import { MOVEMENT_LABEL, type Actual, type Attachment, type CommissioningRecord, type DocType, type Document, type GoodsReceipt,
  type HseIncident, type ReviewStatus, type SiteVisit, type StockMovement } from "./types";

/**
 * Sectioning for the file gallery.
 *
 * Documents section themselves — every doc type belongs to a stage. Attachments do not: most of them carry no
 * `linkedTo` at all, because the *record* points at the attachment (a goods receipt lists its photo ids, a visit
 * lists its photos) rather than the other way round. So the sectioner builds a reverse index over every record
 * that can hold an attachment id, and only then falls back to `linkedTo`, and only then to "Photos & files".
 *
 * The invariant the gallery depends on: every attachment the snapshot carries lands in exactly one section of
 * exactly one scope — its project, or the warehouse when it has none. files.test.mjs holds it.
 */
export const stageOf = (t: DocType): StageDef | undefined => STAGES.find((s) => s.evidence.includes(t));

export interface FileVia { model: string; id: string; label: string }
export type FileEntry =
  | { kind: "document"; id: string; doc: Document; at: string; status: ReviewStatus; expiring: boolean }
  | { kind: "attachment"; id: string; att: Attachment; via?: FileVia; at: string; status: ReviewStatus; expiring: false };
export interface FileSection { key: string; title: string; hint?: string; stage?: number; entries: FileEntry[] }

/** The slice of the store the sectioner reads. MockApi satisfies it structurally. */
export interface FileStore {
  documents: Document[]; attachments: Attachment[]; goodsReceipts: GoodsReceipt[]; movements: StockMovement[];
  actuals: Actual[]; visits: SiteVisit[]; commissionings: CommissioningRecord[]; hseIncidents: HseIncident[];
  items: { id: string; name: string }[];
}
export type FileScope = { projectId: string } | "warehouse";

const SECTION_META: Record<string, { title: string; hint?: string }> = {
  "docs-other": { title: "Other documents" },
  uploads: { title: "Photos & files", hint: "uploaded directly, not tied to a record" },
  deliveries: { title: "Deliveries", hint: "delivery notes and photos on stock received" },
  visits: { title: "Site visits" },
  commissioning: { title: "Commissioning" },
  hse: { title: "HSE" },
  writeoffs: { title: "Write-offs" },
  movements: { title: "Stock movements" },
  expenses: { title: "Expenses & receipts" },
  signoffs: { title: "Sign-offs", hint: "client signatures" },
  linked: { title: "From other records" },
};
const SECTION_ORDER = ["docs-other", "uploads", "deliveries", "visits", "commissioning", "hse", "writeoffs", "movements", "expenses", "signoffs", "linked"];

/** Where an attachment uploaded against a record with only `linkedTo` set should go. */
const LINKED_MODEL_SECTION: Record<string, string> = {
  PurchaseOrder: "deliveries", GoodsReceipt: "deliveries", StockMovement: "movements", SiteVisit: "visits", Visit: "visits",
  CommissioningRecord: "commissioning", Commissioning: "commissioning", HseIncident: "hse", Actual: "expenses", Issue: "visits",
};

type Hit = { section: string; via: FileVia; n: number };

/** One pass over every record that can hold an attachment id. First writer wins; repeats from the same record type count. */
function indexAttachments(s: FileStore): Map<string, Hit> {
  const idx = new Map<string, Hit>();
  const itemName = (id: string) => s.items.find((i) => i.id === id)?.name ?? id;
  const put = (id: string | undefined, section: string, via: FileVia) => {
    if (!id) return;
    const cur = idx.get(id);
    if (cur) { if (cur.section === section) cur.n++; return; }
    idx.set(id, { section, via, n: 1 });
  };
  // Signatures first — a signature is also listed among the visit's attachments, and "Sign-offs" is the more useful home.
  for (const v of s.visits) put(v.clientSignoff?.signatureAttachmentId, "signoffs", { model: "SiteVisit", id: v.id, label: `${v.clientSignoff?.name ?? "Client"} · site visit` });
  for (const c of s.commissionings) put(c.clientWitness?.signatureAttachmentId, "signoffs", { model: "CommissioningRecord", id: c.id, label: `${c.clientWitness?.name ?? "Client"} · commissioning` });
  for (const c of s.commissionings) {
    const via = { model: "CommissioningRecord", id: c.id, label: `Commissioning · ${c.date.slice(0, 10)}` };
    for (const it of c.items) put(it.attachmentId, "commissioning", { ...via, label: `${it.label} · commissioning` });
    for (const id of c.attachmentIds) put(id, "commissioning", via);
  }
  for (const v of s.visits) for (const id of v.attachmentIds) put(id, "visits", { model: "SiteVisit", id: v.id, label: `${v.visitType} visit · ${v.startedAt.slice(0, 10)}` });
  for (const h of s.hseIncidents) for (const id of h.attachmentIds) put(id, "hse", { model: "HseIncident", id: h.id, label: `${h.type} · ${h.occurredAt.slice(0, 10)}` });
  for (const g of s.goodsReceipts) for (const id of g.attachmentIds) put(id, "deliveries", { model: "GoodsReceipt", id: g.id, label: g.grnNumber });
  for (const m of s.movements) {
    const section = m.movementType === "receipt" ? "deliveries" : m.movementType === "write_off" ? "writeoffs" : "movements";
    const label = m.sourceRef?.label ?? `${MOVEMENT_LABEL[m.movementType]} · ${itemName(m.itemId)} × ${m.qty}`;
    for (const id of m.attachmentIds ?? []) put(id, section, { model: "StockMovement", id: m.id, label });
  }
  for (const a of s.actuals) for (const id of a.attachmentIds) put(id, "expenses", { model: "Actual", id: a.id, label: a.sourceRef.label });
  return idx;
}

const EXPIRING_MS = 90 * 86400000;

export function sectionFiles(s: FileStore, scope: FileScope, opts: { keep?: string[]; now?: number } = {}): FileSection[] {
  const now = opts.now ?? Date.now();
  const pid = scope === "warehouse" ? null : scope.projectId;
  const buckets = new Map<string, FileEntry[]>();
  const add = (key: string, e: FileEntry) => { const b = buckets.get(key); if (b) b.push(e); else buckets.set(key, [e]); };

  if (pid) {
    for (const d of s.documents) {
      if (d.projectId !== pid) continue;
      const st = stageOf(d.docType);
      const expiring = !!d.expiresAt && d.reviewStatus === "checked" && new Date(d.expiresAt).getTime() - now < EXPIRING_MS;
      add(st ? `stage-${st.stage}` : "docs-other", { kind: "document", id: d.id, doc: d, at: d.submittedAt, status: d.reviewStatus, expiring });
    }
  }

  const idx = indexAttachments(s);
  for (const a of s.attachments) {
    const owner = a.projectId || null;
    if (owner !== pid) continue;
    const hit = idx.get(a.id);
    let section: string; let via: FileVia | undefined;
    if (hit) { section = hit.section; via = hit.n > 1 ? { ...hit.via, label: `${hit.via.label} +${hit.n - 1} more` } : hit.via; }
    else if (a.linkedTo) { section = LINKED_MODEL_SECTION[a.linkedTo.model] ?? "linked"; via = a.linkedTo; }
    else section = "uploads";
    add(section, { kind: "attachment", id: a.id, att: a, via, at: a.uploadedAt, status: a.reviewStatus, expiring: false });
  }

  const out: FileSection[] = [];
  for (const st of STAGES) {
    const b = buckets.get(`stage-${st.stage}`);
    if (b) out.push({ key: `stage-${st.stage}`, title: st.name, stage: st.stage, entries: b });
  }
  for (const key of SECTION_ORDER) {
    const b = buckets.get(key) ?? (opts.keep?.includes(key) ? [] : undefined);
    if (b) out.push({ key, ...SECTION_META[key], entries: b });
  }
  for (const sec of out) sec.entries.sort((x, y) => y.at.localeCompare(x.at));
  return out;
}

/** Everything the gallery can show for a scope, regardless of section — for counts and for the "any file" check. */
export const flattenFiles = (sections: FileSection[]) => sections.flatMap((s) => s.entries);
