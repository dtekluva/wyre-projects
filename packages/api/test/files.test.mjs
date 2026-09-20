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

console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
