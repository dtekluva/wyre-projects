// Period summaries: the report builder, spend in a date range, and the 48 h narrative cache (demo build).
import { MockApi, ApiError, spendInRange, buildProjectReport, windowKeyFor, rangeFor, narrativeFor, installedOn, installedSentence, wattsOf, activityBuckets, activityGroupOf } from "../dist/api.mjs";
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

// installed = issued to the project and checked, less checked returns; pending apart; tools and PPE left out
ok(wattsOf("Jinko solar panels, 650 W") === 650 && wattsOf("Tiger Neo 615W panel") === 615 && wattsOf("JA 580Wp") === 580 && wattsOf("400 Watt mono") === 400, "panel wattage from the name");
ok(wattsOf("Deye inverter 10 kW") === undefined && wattsOf("650 ways") === undefined, "not from a kW rating or a word");
const fresh = new MockApi();
const sk = "u_sk", fin = "u_fin";
const before = installedOn(fresh, "p2");
const cable = fresh.items.find((i) => i.id === "it_cable");
const iss = fresh.issueStock(sk, { itemId: cable.id, qty: 40, projectId: "p2" });
let inst = installedOn(fresh, "p2"); let row = inst.lines.find((l) => l.itemId === cable.id);
ok(row && row.pending - (before.lines.find((l) => l.itemId === cable.id)?.pending ?? 0) === 40 && row.net === (before.lines.find((l) => l.itemId === cable.id)?.net ?? 0), "an unchecked issue is pending, not installed");
fresh.check("stock_movement", iss.id, fin, "checked");
const ret = fresh.returnStock(sk, { itemId: cable.id, qty: 5, projectId: "p2", reason: "spare" }); fresh.check("stock_movement", ret.id, fin, "checked");
inst = installedOn(fresh, "p2"); row = inst.lines.find((l) => l.itemId === cable.id);
const b0 = before.lines.find((l) => l.itemId === cable.id);
ok(row.issued - (b0?.issued ?? 0) === 40 && row.returned - (b0?.returned ?? 0) === 5 && row.net - (b0?.net ?? 0) === 35, "checked issue counts, checked return comes off");
ok(inst.byCategory.find((c) => c.category === "cable").net === inst.lines.filter((l) => l.category === "cable").reduce((s, l) => s + l.net, 0), "category totals add up");
ok(inst.lines.every((l) => !["tool", "ppe"].includes(l.category)), "tools and PPE are never 'installed'");
const ip1 = installedOn(fresh, "p1"); const pan = ip1.lines.find((l) => l.category === "panel");
ok(!pan || ip1.panelsKwp === Math.round(ip1.lines.reduce((s, l) => s + (l.watts ? l.net * l.watts : 0), 0) / 10) / 100, "kWp = panels × watts");
ok(installedSentence({ lines: [{ itemId: "x", name: "Jinko solar panels, 650 W", category: "panel", unit: "pcs", issued: 13, returned: 0, net: 13, pending: 0, watts: 650 }], byCategory: [], panelsKwp: 8.45, capacityKwp: 40, pct: 21 })
   === "13 pcs Jinko solar panels, 650 W — panels 8.45 kWp of 40 kWp (21%)", "the sentence the PDF prints");
ok(buildProjectReport(fresh, "p2", all, { money: false }).installed.lines.length === inst.lines.length, "the report carries the same installed figures");

// activity chart buckets: day ≤ 45 days, week ≤ a year, month beyond; every event in range lands once
const evs = fresh.listEvents("p1");
const wk7 = buildProjectReport(fresh, "p1", { from: "2026-09-01", to: "2026-09-07" }, { money: false });
ok(wk7.activity.length === 7 && wk7.activity.every((b) => b.unit === "day"), "a week is seven daily columns");
ok(wk7.activity.reduce((s, b) => s + b.total, 0) === wk7.events.length, "every event in the week is counted once");
ok(wk7.activity.every((b) => b.total === Object.values(b.counts).reduce((s, k) => s + k, 0)), "kinds add up to each column");
const two = activityBuckets(evs, { from: "2026-07-01", to: "2026-09-08" });
ok(two.every((b) => b.unit === "week") && two[0].start === "2026-07-01" && two[two.length - 1].end === "2026-09-08", "two months are weekly columns, clipped to the range");
const yr = activityBuckets(evs, { from: "2025-01-01", to: "2026-09-30" });
ok(yr.every((b) => b.unit === "month") && yr.length === 21, "over a year is monthly");
ok(activityGroupOf("visit") === "site" && activityGroupOf("check_passed") === "evidence" && activityGroupOf("expense") === "money" && activityGroupOf("stock_request") === "stock" && activityGroupOf("note") === "other", "event kinds");
ok(wk7.stage === fresh.projects.find((p) => p.id === "p1").stage && typeof wk7.activeDays === "number", "stage and active days on the report");

if (fails) { console.log(`\n${fails} failing`); process.exit(1); }
console.log("\nreport: all passed");
