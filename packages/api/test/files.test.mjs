// Guard for the file gallery: every attachment the snapshot carries appears in exactly one section of exactly one
// scope — its project, or the warehouse when it has none. Eleven of thirteen production uploads had no project and
// rendered nowhere; this is what stops that from coming back.
import { MockApi, sectionFiles, flattenFiles } from "../dist/api.mjs";
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok  :", m); };

const api = new MockApi();
const scopes = [...api.projects.map((p) => ({ projectId: p.id })), "warehouse"];
const seen = new Map();
for (const sc of scopes) for (const e of flattenFiles(sectionFiles(api, sc))) seen.set(`${e.kind}:${e.id}`, (seen.get(`${e.kind}:${e.id}`) ?? 0) + 1);

const attIds = api.attachments.map((a) => `attachment:${a.id}`);
const docIds = api.documents.map((d) => `document:${d.id}`);
ok(attIds.every((k) => seen.get(k) === 1), `every seed attachment lands in exactly one section (${attIds.filter((k) => seen.get(k) !== 1).length} misplaced)`);
ok(docIds.every((k) => seen.get(k) === 1), `every seed document lands in exactly one section (${docIds.filter((k) => seen.get(k) !== 1).length} misplaced)`);
ok([...seen.keys()].every((k) => attIds.includes(k) || docIds.includes(k)), "nothing appears that is not in the store");

// The production shape: a delivery photo uploaded from the Inventory screen — no project, no linkedTo, but a
// receipt movement points at it. It must surface under the warehouse as a delivery, captioned by its receipt.
const now = new Date().toISOString();
const base = { fileName: "delivery.png", mime: "image/png", sizeBytes: 1, kind: "image", sha256: "0".repeat(64), uploadedBy: "u_sk", uploadedAt: now, reviewStatus: "pending", submittedBy: "u_sk", submittedAt: now, reviewVersion: 1 };
api.attachments.push({ ...base, id: "att_orphan_a", projectId: null }, { ...base, id: "att_orphan_b", projectId: null }, { ...base, id: "att_orphan_c", projectId: null, caption: "Just a photo" });
const item = api.items[0];
const mv = { itemId: item.id, movementType: "receipt", qty: 3, locationToId: api.mainLocationId(), unitCost: 1, totalCost: 3, createdBy: "u_sk", createdAt: now, reviewStatus: "checked", submittedBy: "u_sk", submittedAt: now, reviewVersion: 1 };
api.movements.push({ ...mv, id: "mv_x1", attachmentIds: ["att_orphan_a"] }, { ...mv, id: "mv_x2", attachmentIds: ["att_orphan_b"] }, { ...mv, id: "mv_x3", itemId: api.items[1].id, attachmentIds: ["att_orphan_b"] });

const wh = sectionFiles(api, "warehouse");
const del = wh.find((s) => s.key === "deliveries"); const up = wh.find((s) => s.key === "uploads");
const a = del?.entries.find((e) => e.id === "att_orphan_a"); const b = del?.entries.find((e) => e.id === "att_orphan_b");
ok(!!a && a.via?.label.includes(item.name), `orphan delivery photo files under warehouse → Deliveries, captioned by its receipt (${a?.via?.label})`);
ok(!!b && /\+1 more$/.test(b.via?.label ?? ""), `one note photographed for two lines is one tile, not two (${b?.via?.label})`);
ok(up?.entries.some((e) => e.id === "att_orphan_c"), "an upload nothing points at → Photos & files");
ok(!api.projects.some((p) => flattenFiles(sectionFiles(api, { projectId: p.id })).some((e) => e.id.startsWith("att_orphan"))), "warehouse files never leak into a project gallery");
ok(wh.every((s) => s.entries.every((e, i, arr) => i === 0 || arr[i - 1].at >= e.at)), "sections are newest first");

// Issue photos — before, during, after — belong together under "Issues", captioned by what they are.
const pj = api.projects[0].id;
const pa = { ...base, projectId: pj, uploadedBy: "u_ft1", submittedBy: "u_ft1" };
api.attachments.push({ ...pa, id: "att_iss_b", caption: "Before — Loose rail" }, { ...pa, id: "att_iss_m", caption: "Supplier quote" }, { ...pa, id: "att_iss_a", caption: "After — Loose rail" });
api.issues.push({ id: "iss_x", projectId: pj, category: "mechanical", severity: "low", title: "Loose rail", description: "", raisedBy: "u_ft1", raisedAt: now, source: "manual", status: "resolved",
  costToResolve: 0, attachmentIds: ["att_iss_m"], beforeAttachmentIds: ["att_iss_b"], afterAttachmentIds: ["att_iss_a"], isSnag: false, slaDueAt: now,
  createdAt: now, createdBy: "u_ft1", updatedAt: now, updatedBy: "u_ft1", reviewStatus: "pending", submittedBy: "u_ft1", submittedAt: now, reviewVersion: 1 });
const isec = sectionFiles(api, { projectId: pj }).find((s) => s.key === "issues");
const lab = (id) => isec?.entries.find((e) => e.id === id)?.via?.label;
ok(!!isec && ["att_iss_b", "att_iss_m", "att_iss_a"].every((id) => isec.entries.some((e) => e.id === id)), "before, during and after all file under Issues");
ok(lab("att_iss_b") === "Before · Loose rail" && lab("att_iss_m") === "Loose rail" && lab("att_iss_a") === "After · Loose rail", `issue tiles say what they are (${lab("att_iss_b")} / ${lab("att_iss_m")} / ${lab("att_iss_a")})`);
ok(!sectionFiles(api, { projectId: pj }).find((s) => s.key === "uploads")?.entries.some((e) => e.id.startsWith("att_iss")), "issue photos no longer land in Photos & files");

// Invoice files — the invoice itself, remittance advices, VAT evidence — file together under "Invoices & receipts".
const isec2 = sectionFiles(api, { projectId: "p1" }).find((s) => s.key === "invoices");
const invLabels = (isec2?.entries ?? []).map((e) => e.via?.label ?? "");
ok(!!isec2 && isec2.entries.length >= 3, `seed invoice files land under Invoices & receipts (${isec2?.entries.length ?? 0})`);
ok(invLabels.some((l) => l.startsWith("Invoice ")) && invLabels.some((l) => l.startsWith("Receipt · ")) && invLabels.some((l) => l.startsWith("VAT · ")), `tiles say invoice / receipt / VAT (${invLabels.join(", ")})`);

console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
