// IndexedDB outbox: field submissions made offline are queued here and replayed (in order) when online.
// Entries are self-contained commands (actor + payload) so a replay can create attachments first, then the record.
import type { MockApi } from "@wyre/api";

export type Photo = { fileName: string; caption?: string; gps?: { lat: number; lng: number }; blob?: Blob };
/** Canvas data-URL (signature pad) → Blob so it can be stored in IndexedDB and uploaded. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(","); const mime = /data:(.*?);/.exec(head)?.[1] ?? "image/png";
  const bin = atob(b64); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
export type Command =
  | { kind: "raise_issue"; actorId: string; projectId: string; photos: Photo[]; input: { category: string; severity: string; title: string; description: string; assetId?: string; isSnag?: boolean } }
  | { kind: "set_issue_status"; actorId: string; issueId: string; status: "in_progress" | "awaiting_parts" }
  | { kind: "resolve_issue"; actorId: string; issueId: string; projectId: string; photos: Photo[]; input: { rootCause: string; resolution: string; costToResolve: number } }
  | { kind: "log_visit"; actorId: string; projectId: string; photos: Photo[]; signature?: { name: string; rating?: number; fileName: string; blob?: Blob };
      input: { visitType: string; startedAt: string; endedAt: string; findings: string; actionsTaken: string; costTravel: number; costLabour: number; locationId: string; parts: { itemId: string; qty: number }[]; gps?: { lat: number; lng: number }; offlineCapturedAt?: string } };

export interface OutboxEntry { id: string; createdAt: string; label: string; command: Command; status: "queued" | "failed"; error?: string; attempts: number }

const DB = "wyre-field", STORE = "outbox";
function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => { const t = db.transaction(STORE, mode); const req = fn(t.objectStore(STORE)); t.oncomplete = () => res((req as IDBRequest<T> | undefined)?.result as T); t.onerror = () => rej(t.error); });
}
export const outbox = {
  async list(): Promise<OutboxEntry[]> { const all = await tx<OutboxEntry[]>("readonly", (s) => s.getAll()); return (all ?? []).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); },
  async enqueue(label: string, command: Command): Promise<OutboxEntry> {
    const e: OutboxEntry = { id: `ob_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date().toISOString(), label, command, status: "queued", attempts: 0 };
    await tx("readwrite", (s) => s.put(e)); notify(); return e;
  },
  async remove(id: string) { await tx("readwrite", (s) => s.delete(id)); notify(); },
  async clear() { await tx("readwrite", (s) => s.clear()); notify(); },
  /** Replay every queued entry against the API, in order. Failed entries stay with their error. */
  async flush(api: MockApi): Promise<{ ok: number; failed: number }> {
    const all = await outbox.list(); let ok = 0, failed = 0;
    for (const e of all) {
      try { applyCommand(api, e.command); await outbox.remove(e.id); ok++; }
      catch (err) { e.status = "failed"; e.error = err instanceof Error ? err.message : String(err); e.attempts++; await tx("readwrite", (s) => s.put(e)); failed++; }
    }
    notify(); return { ok, failed };
  },
};
const listeners = new Set<() => void>();
export const onOutboxChange = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const notify = () => listeners.forEach((f) => f());

/** Applies a command to the API — used both online (immediately) and on replay. */
export function applyCommand(api: MockApi, c: Command) {
  const photos = (projectId: string, actorId: string, ps: Photo[], link?: { model: string; id: string; label: string }) =>
    ps.map((p) => api.addAttachment(actorId, projectId, { fileName: p.fileName, caption: p.caption, gps: p.gps, linkedTo: link, blob: p.blob }).id);
  switch (c.kind) {
    case "raise_issue": { const ids = photos(c.projectId, c.actorId, c.photos); return api.raiseIssue(c.actorId, c.projectId, { ...c.input, category: c.input.category as never, severity: c.input.severity as never, beforeAttachmentIds: ids }); }
    case "set_issue_status": return api.setIssueStatus(c.actorId, c.issueId, c.status, c.actorId);
    case "resolve_issue": { const ids = photos(c.projectId, c.actorId, c.photos); return api.resolveIssue(c.actorId, c.issueId, { ...c.input, afterAttachmentIds: ids }); }
    case "log_visit": {
      const ids = photos(c.projectId, c.actorId, c.photos);
      const sig = c.signature ? api.addAttachment(c.actorId, c.projectId, { fileName: c.signature.fileName, caption: `Client sign-off — ${c.signature.name}`, blob: c.signature.blob }).id : undefined;
      return api.logVisit(c.actorId, c.projectId, { ...c.input, visitType: c.input.visitType as never, attachmentIds: ids, clientSignoff: c.signature ? { name: c.signature.name, rating: c.signature.rating, signatureAttachmentId: sig } : undefined });
    }
  }
}
