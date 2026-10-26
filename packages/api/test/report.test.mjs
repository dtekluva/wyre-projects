// Period summaries: the report builder, spend in a date range, and the 48 h narrative cache (demo build).
import { MockApi, ApiError, spendInRange, buildProjectReport, windowKeyFor, rangeFor, narrativeFor } from "../dist/api.mjs";
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok  :", m); };
const throws = (fn, code, m) => { try { fn(); ok(false, `${m} (no throw)`); } catch (e) { ok(e instanceof ApiError && e.code === code, `${m} → ${e.code ?? e.message}`); } };

const api = new MockApi();
const all = { from: "2000-01-01", to: "2100-01-01" };
const s = spendInRange(api, all);
ok(Math.abs(s.total - api.actuals.reduce((t, a) => t + a.amount, 0)) < 0.01, "an open range spends every actual");
ok(Math.abs(s.byCategory.reduce((t, c) => t + c.amount, 0) - s.total) < 0.01 && Math.abs(s.byProject.reduce((t, c) => t + c.amount, 0) - s.total) < 0.01, "categories and projects both add up to the total");
const none = spendInRange(api, { from: "1999-01-01", to: "1999-01-02" });
ok(none.total === 0 && none.lines.length === 0, "a range with nothing in it spends nothing");
const p1 = spendInRange(api, all, new Set(["p1"]));
ok(p1.lines.every((l) => l.projectId === "p1") && p1.total <= s.total, "the project filter holds");

// a logged, unchecked expense is pending, not spent; checked, it is spent on its own date
const rid = api.addAttachment("u_ft1", "p1", { fileName: "fuel.jpg", blob: new Blob(["x"], { type: "image/jpeg" }) }).id;
const e = api.logExpense("u_ft1", "p1", { amount: 7000, description: "Fuel", category: "logistics", date: "2026-10-20", attachmentIds: [rid] });
const day = { from: "2026-10-20", to: "2026-10-20" };
let d = spendInRange(api, day, new Set(["p1"]));
ok(d.pendingTotal === 7000 && d.pending.length === 1 && !d.lines.some((l) => l.label === "Fuel"), "unchecked expense shows as pending only");
api.check("expense", e.id, "u_fin", "checked");
d = spendInRange(api, day, new Set(["p1"]));
ok(d.pendingTotal === 0 && d.lines.some((l) => l.label === "Fuel" && l.amount === 7000), "checked expense is spent on the day the money left");
ok(spendInRange(api, { from: "2026-10-21", to: "2026-10-21" }, new Set(["p1"])).lines.every((l) => l.label !== "Fuel"), "and not the next day");

const r = buildProjectReport(api, "p1", all, { money: true });
ok(r.name && r.code === "WYR-2026-001" && r.stageName, "header carries name, code and stage name");
ok(r.events.length === api.listEvents("p1").length && r.days.reduce((t, g) => t + g.items.length, 0) === r.events.length, "every event lands in exactly one day");
ok(r.visits.every((v) => v.projectId === "p1" && !v.voidedAt), "visits are the project's own, voided left out");
ok(r.money && Math.abs(r.money.spend.total - p1.total - 7000) < 0.01, "money section spends what the range spends");
ok(buildProjectReport(api, "p1", all, { money: false }).money === undefined, "no money section without money rights");
ok(r.open.issues.every((i) => !["closed", "wont_fix"].includes(i.status)), "open issues are open");

const wk = rangeFor("7d");
ok(windowKeyFor("7d", wk) === "7d" && windowKeyFor("custom", { from: "2026-10-01", to: "2026-10-07" }) === "custom:2026-10-01:2026-10-07", "window keys");
throws(() => api.requestNarratives("u_dir", { from: wk.to, to: wk.from, windowKey: "7d", items: [{ projectId: "p1" }] }), "invalid", "a backwards period is refused");
const first = api.requestNarratives("u_dir", { from: wk.from, to: wk.to, windowKey: "7d", items: [{ projectId: "p1" }, { projectId: "p2" }] });
ok(first.length === 2 && first.every((n) => n.status === "done" && n.text.startsWith("Demo build")), "demo build writes a plain, labelled paragraph");
const again = api.requestNarratives("u_fin", { from: wk.from, to: wk.to, windowKey: "7d", items: [{ projectId: "p1" }] });
ok(again[0].id === first[0].id && api.narratives.length === 2, "asked again within 48 h — same paragraph, nothing new written");
const month = api.requestNarratives("u_dir", { ...rangeFor("30d"), windowKey: "30d", items: [{ projectId: "p1" }] });
ok(month[0].id !== first[0].id && api.narratives.length === 3, "a different window is a different paragraph");
first[0].requestedAt = new Date(Date.now() - 49 * 3600_000).toISOString();
const later = api.requestNarratives("u_dir", { from: wk.from, to: wk.to, windowKey: "7d", items: [{ projectId: "p1" }] });
ok(later[0].id !== first[0].id && api.narratives.length === 4, "after 48 h a fresh one is written");
ok(narrativeFor(api.narratives, "p1", "7d").id === later[0].id, "the newest one is the one shown");

if (fails) { console.log(`\n${fails} failing`); process.exit(1); }
console.log("\nreport: all passed");
