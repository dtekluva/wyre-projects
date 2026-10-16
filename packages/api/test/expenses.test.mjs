// Expenses: receipted spend outside a PO, Finance checks, then an actual. Plus: a video upload is a video.
import { MockApi, ApiError, kindOfFile } from "../dist/api.mjs";
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok  :", m); };
const throws = (fn, code, m) => { try { fn(); ok(false, `${m} (no throw)`); } catch (e) { ok(e instanceof ApiError && e.code === code, `${m} → ${e.code ?? e.message}`); } };

ok(kindOfFile("video/mp4") === "video" && kindOfFile(undefined, "site-walk.MOV") === "video", "video by mime or by name");
ok(kindOfFile("image/heic") === "image" && kindOfFile(undefined, "x.png") === "image" && kindOfFile("application/pdf", "a.pdf") === "document", "image / document");

const api = new MockApi();
const tech = "u_ft1", fin = "u_fin", dir = api.getUsers().find((u) => u.roles.includes("director")).id;
const clip = api.addAttachment(tech, "p1", { fileName: "inverter-noise.mp4", caption: "Inverter buzzing under load", blob: new Blob(["00"], { type: "video/mp4" }) });
ok(clip.kind === "video" && clip.mime === "video/mp4", "an uploaded clip is a video attachment");
ok(api.reviewQueue("u_pm1").some((i) => i.id === clip.id && i.subtitle === "Video"), "the review queue calls it a video");

const receipt = () => api.addAttachment(tech, "p1", { fileName: "fuel.jpg", caption: "Fuel receipt", blob: new Blob(["x"], { type: "image/jpeg" }) }).id;
const logistics = api.costItems.find((c) => c.projectId === "p1" && c.reviewStatus === "checked" && !c.voidedAt && c.category === "logistics")
  ?? api.costItems.find((c) => c.projectId === "p1" && c.reviewStatus === "checked" && !c.voidedAt);
ok(!!logistics, `p1 has a checked budget line to log against (${logistics?.label})`);
const other = api.costItems.find((c) => c.projectId !== "p1" && c.reviewStatus === "checked");

throws(() => api.logExpense("u_aud", "p1", { amount: 1, description: "x", attachmentIds: [receipt()], category: "logistics" }), "forbidden", "an auditor cannot log expenses");
throws(() => api.logExpense(tech, "p1", { amount: 0, description: "x", attachmentIds: [receipt()], category: "logistics" }), "invalid", "amount must be positive");
throws(() => api.logExpense(tech, "p1", { amount: 5000, description: " ", attachmentIds: [receipt()], category: "logistics" }), "invalid", "description required");
throws(() => api.logExpense(tech, "p1", { amount: 5000, description: "Diesel", attachmentIds: [], category: "logistics" }), "invalid", "receipt required");
throws(() => api.logExpense(tech, "p1", { amount: 5000, description: "Diesel", attachmentIds: [receipt()], costItemId: other.id }), "invalid", "a budget line from another project is refused");
throws(() => api.logExpense(tech, "p1", { amount: 5000, description: "Diesel", attachmentIds: [receipt()], category: "snacks" }), "invalid", "unknown category");

const before = api.money("p1").actual; const ids = [receipt()];
const e = api.logExpense(tech, "p1", { amount: 18500, description: "Diesel for the Sango run", payee: "Total, Ota", date: "2026-10-15", attachmentIds: ids, costItemId: logistics.id });
ok(e.reviewStatus === "pending" && e.category === logistics.category && e.costItemId === logistics.id, "logged pending, category taken from the line");
ok(api.money("p1").actual === before, "nothing posts until Finance checks");
ok(api.listEvents("p1").some((ev) => ev.eventType === "expense" && ev.ref?.id === e.id && ev.summary.startsWith("Expense logged")), "chronology: logged");
ok(api.reviewQueue(fin).some((i) => i.kind === "expense" && i.id === e.id && i.amount === 18500), "Finance sees it in the queue");
ok(!api.reviewQueue(tech).some((i) => i.id === e.id), "the tech does not");
throws(() => api.check("expense", e.id, tech, "checked"), "forbidden", "a tech cannot check an expense");
api.check("expense", e.id, fin, "checked");
const act = api.actuals.find((a) => a.sourceRef.model === "Expense" && a.sourceRef.id === e.id);
ok(!!act && act.amount === 18500 && act.category === logistics.category && act.costItemId === logistics.id && act.source === "expense" && act.date.startsWith("2026-10-15"), "checked → an actual against the line, on the spend date");
ok(api.money("p1").actual === before + 18500, "the project's actual spend moved by the receipt");
ok(api.money("p1").byCategory[logistics.category].actual > 0, "and the category chart sees it");
const sec = api.sectionFiles ? null : null; // gallery is covered by files.test.mjs
const e2 = api.logExpense(tech, "p1", { amount: 2000, description: "Okada to site", attachmentIds: [receipt()], category: "logistics" });
api.check("expense", e2.id, fin, "rejected", "No receipt visible");
ok(e2.reviewStatus === "rejected" && !api.actuals.some((a) => a.sourceRef.id === e2.id), "rejected posts nothing");
throws(() => api.voidRecord(tech, "expense", e.id, "wrong"), "forbidden", "a tech cannot void");
api.voidRecord(dir, "expense", e.id, "Duplicate of the PO receipt");
ok(e.voidedAt && !api.actuals.some((a) => a.sourceRef.id === e.id) && api.money("p1").actual === before, "void removes the actual");
ok(api.attachments.find((a) => a.id === ids[0]).voidedAt, "and the receipt goes with it");

if (fails) { console.log(`\n${fails} failing`); process.exit(1); }
console.log("\nexpenses: all passed");
