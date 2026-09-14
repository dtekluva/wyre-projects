// RemoteApi — the same synchronous surface as MockApi, backed by the Django backend.
// Reads run locally over the last snapshot; every mutation is applied locally first (instant UI, stable client ids)
// and then sent to the server in order. The server's snapshot replaces local state after each command; a server
// rejection is surfaced through onError() and the local state is re-synced from the server.
import { MockApi, ApiError } from "./client";
import type { User } from "./types";

type Json = Record<string, unknown>;
type Mutation = { name: string; body: Json; blob?: Blob; fileName?: string };
const TOKENS = "wyre.tracker.tokens";

export interface RemoteError { command: string; message: string; code: string }

export class RemoteApi extends MockApi {
  private access: string | null = null;
  private refreshTok: string | null = null;
  private queue: Promise<void> = Promise.resolve();
  private errorListeners = new Set<(e: RemoteError) => void>();
  private syncListeners = new Set<(pending: number) => void>();
  private pending = 0;
  me: User | null = null;

  constructor(public readonly base: string) {
    super();
    try { const t = JSON.parse(localStorage.getItem(TOKENS) ?? "null"); if (t?.access) { this.access = t.access; this.refreshTok = t.refresh; } } catch { /* ignore */ }
    // remote mode never reads the mock's persisted demo state
    this.resetLocal();
    this.wrapMutations();
  }
  private resetLocal() { for (const k of ["projects","memberships","documents","attachments","events","approvals","thresholds","vendors","locations","items","costItems","purchaseOrders","goodsReceipts","assets","movements","actuals","changeOrders","retentions","qbBills","visits","issues","commissionings","hseIncidents","warrantyClaims","stockCounts"]) (this as unknown as Record<string, unknown[]>)[k] = []; this.users = []; }
  get signedIn() { return !!this.access; }
  onError(fn: (e: RemoteError) => void) { this.errorListeners.add(fn); return () => { this.errorListeners.delete(fn); }; }
  onSync(fn: (pending: number) => void) { this.syncListeners.add(fn); return () => { this.syncListeners.delete(fn); }; }

  // ---------- auth ----------
  async login(username: string, password: string): Promise<User> {
    const r = await fetch(`${this.base}/auth/token/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
    if (!r.ok) throw new ApiError(r.status === 401 ? "Wrong username or password" : `Sign-in failed (${r.status})`, "forbidden");
    const j = await r.json();
    this.access = j.access; this.refreshTok = j.refresh;
    try { localStorage.setItem(TOKENS, JSON.stringify({ access: j.access, refresh: j.refresh })); } catch { /* ignore */ }
    await this.refresh();
    return this.me!;
  }
  logout() { this.access = null; this.refreshTok = null; this.me = null; try { localStorage.removeItem(TOKENS); } catch { /* ignore */ } this.resetLocal(); this.notify(); }
  private async fetchAuth(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const r = await fetch(`${this.base}${path}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${this.access}` } });
    if (r.status === 401 && retry && this.refreshTok) {
      const rr = await fetch(`${this.base}/auth/token/refresh/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh: this.refreshTok }) });
      if (rr.ok) { const j = await rr.json(); this.access = j.access; try { localStorage.setItem(TOKENS, JSON.stringify({ access: j.access, refresh: this.refreshTok })); } catch { /* ignore */ } return this.fetchAuth(path, init, false); }
      this.logout();
    }
    return r;
  }
  /** Pull the full read model for the signed-in user. */
  async refresh(): Promise<void> {
    if (!this.access) return;
    const me = await this.fetchAuth("/me/");
    if (!me.ok) { if (me.status === 401) this.logout(); return; }
    this.me = (await me.json()).user as User;
    const r = await this.fetchAuth("/snapshot/");
    if (!r.ok) throw new ApiError(`Could not load data (${r.status})`, "invalid");
    this.applySnapshot(await r.json());
  }
  private applySnapshot(snap: Json) { this.users = (snap.users as User[]) ?? this.users; this.hydrate(snap); }
  private notify() { this.hydrate({}); }

  // ---------- mutations ----------
  private send(m: Mutation) {
    this.pending++; this.syncListeners.forEach((f) => f(this.pending));
    this.queue = this.queue.then(async () => {
      try {
        let r: Response;
        if (m.blob) {
          const fd = new FormData(); fd.append("payload", JSON.stringify(m.body)); fd.append("file", m.blob, m.fileName ?? "photo.jpg");
          r = await this.fetchAuth(`/commands/${m.name}/`, { method: "POST", body: fd });
        } else {
          r = await this.fetchAuth(`/commands/${m.name}/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(m.body) });
        }
        if (!r.ok) {
          let msg = `${m.name} failed (${r.status})`, code = "invalid";
          try { const j = await r.json(); msg = j.message ?? msg; code = j.code ?? code; } catch { /* ignore */ }
          this.errorListeners.forEach((f) => f({ command: m.name, message: msg, code }));
          await this.refresh(); // server wins — undo the optimistic change
          return;
        }
        const j = await r.json();
        if (j.snapshot) this.applySnapshot(j.snapshot);
      } catch (e) {
        this.errorListeners.forEach((f) => f({ command: m.name, message: e instanceof Error ? e.message : String(e), code: "network" }));
      } finally { this.pending--; this.syncListeners.forEach((f) => f(this.pending)); }
    });
    return this.queue;
  }
  /** Wrap every MockApi mutation: run it locally (rules + instant result), then replay on the server with the same ids. */
  private wrapMutations() {
    const self = this as unknown as Record<string, (...a: unknown[]) => unknown>;
    const wrap = (name: string, body: (args: unknown[], result: unknown) => Mutation | null) => {
      const orig = self[name] as (...a: unknown[]) => unknown;
      self[name] = (...args: unknown[]) => { const result = orig.apply(this, args); const m = body(args, result); if (m) void this.send(m); return result; };
    };
    const id = (r: unknown) => (r as { id?: string } | undefined)?.id;
    const withId = (input: unknown, r: unknown) => ({ ...(input as Json), id: id(r) });
    // (actorId, projectId, input)
    for (const n of ["addDocument", "addCostItem", "raiseChangeOrder", "raiseIssue", "createCommissioning", "reportHse", "raiseWarrantyClaim", "logVisit"])
      wrap(n, (a, r) => ({ name: n, body: { projectId: a[1], input: withId(a[2], r) } }));
    wrap("addAttachment", (a, r) => { const inp = a[2] as { blob?: Blob; fileName?: string }; const { blob, ...rest } = inp; return { name: "addAttachment", body: { projectId: a[1], input: withId(rest, r) }, blob, fileName: inp.fileName }; });
    wrap("addEvidence", (a, r) => { const inp = a[1] as { blob?: Blob; fileName?: string }; const { blob, ...rest } = inp; return { name: "addEvidence", body: { input: withId(rest, r) }, blob, fileName: inp.fileName }; });
    wrap("createProject", (a, r) => ({ name: "createProject", body: { input: withId(a[1], r) } }));
    wrap("createPO", (a, r) => { const po = r as { id: string; items: { id: string }[] }; const inp = a[2] as { items: Json[] };
      return { name: "createPO", body: { projectId: a[1], input: { ...inp, id: po.id, items: inp.items.map((it, i) => ({ ...it, id: po.items[i]?.id })) } } }; });
    wrap("receiveGoods", (a, r) => ({ name: "receiveGoods", body: { poId: a[1], input: withId(a[2], r) } }));
    wrap("grantMembership", (a) => ({ name: "grantMembership", body: { projectId: a[1], userId: a[2], role: a[3] } }));
    wrap("revokeMembership", (a) => ({ name: "revokeMembership", body: { membershipId: a[1] } }));
    wrap("check", (a) => ({ name: "check", body: { kind: a[0], id: a[1], decision: a[3], comment: a[4] } }));
    wrap("requestGate", (a) => ({ name: "requestGate", body: { projectId: a[0] } }));
    wrap("decide", (a) => ({ name: "decide", body: { approvalId: a[0], decision: a[2], comment: a[3] } }));
    wrap("requestRetentionRelease", (a) => ({ name: "requestRetentionRelease", body: { projectId: a[1] } }));
    for (const n of ["issueStock", "returnStock", "writeOff", "addLocation", "transferStock"]) wrap(n, (a, r) => ({ name: n, body: { input: withId(a[1], r) } }));
    wrap("matchBill", (a) => ({ name: "matchBill", body: { billId: a[1], poId: a[2] } }));
    wrap("unmatchBill", (a) => ({ name: "unmatchBill", body: { billId: a[1] } }));
    wrap("startCount", (a, r) => ({ name: "startCount", body: { locationId: a[1], id: id(r) } }));
    wrap("enterCount", (a) => ({ name: "enterCount", body: { countId: a[1], lines: a[2] } }));
    wrap("submitCount", (a) => ({ name: "submitCount", body: { countId: a[1] } }));
    wrap("setIssueStatus", (a) => ({ name: "setIssueStatus", body: { issueId: a[1], status: a[2], assigneeId: a[3] } }));
    wrap("resolveIssue", (a) => ({ name: "resolveIssue", body: { issueId: a[1], input: a[2] } }));
    wrap("updateWarrantyClaim", (a) => ({ name: "updateWarrantyClaim", body: { claimId: a[1], input: a[2] } }));
  }
  /** Remote mode has no demo reset; re-sync from the server instead. */
  reset() { void this.refresh(); }
  isDirty() { return false; }
}
