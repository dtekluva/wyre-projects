// Date ranges: inclusive local days, Monday-start weeks, day buckets.
import { rangeFor, inRange, groupByDay } from "../dist/api.mjs";
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok  :", m); };
const thu = new Date(2026, 9, 15, 14, 30);               // Thu 15 Oct 2026, local
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
ok(eq(rangeFor("today", thu), { from: "2026-10-15", to: "2026-10-15" }), "today");
ok(eq(rangeFor("yesterday", thu), { from: "2026-10-14", to: "2026-10-14" }), "yesterday");
ok(eq(rangeFor("week", thu), { from: "2026-10-12", to: "2026-10-15" }), "this week starts on Monday");
ok(eq(rangeFor("week", new Date(2026, 9, 12, 9)), { from: "2026-10-12", to: "2026-10-12" }), "a Monday is a one-day week so far");
ok(eq(rangeFor("week", new Date(2026, 9, 18, 9)), { from: "2026-10-12", to: "2026-10-18" }), "a Sunday closes the week");
ok(eq(rangeFor("7d", thu), { from: "2026-10-09", to: "2026-10-15" }), "last 7 days includes today");
ok(eq(rangeFor("30d", thu), { from: "2026-09-16", to: "2026-10-15" }), "last 30 days");
ok(eq(rangeFor("all", thu), {}), "all is open");
const at = (y, m, d, h = 10) => new Date(y, m - 1, d, h).toISOString();
ok(inRange(at(2026, 10, 15, 0), rangeFor("today", thu)) && inRange(at(2026, 10, 15, 23), rangeFor("today", thu)), "midnight to 23:00 are today");
ok(!inRange(at(2026, 10, 16, 0), rangeFor("today", thu)) && !inRange(at(2026, 10, 14, 23), rangeFor("today", thu)), "neighbours are not");
ok(inRange(at(2026, 10, 12), rangeFor("week", thu)) && !inRange(at(2026, 10, 11), rangeFor("week", thu)), "week edge");
ok(inRange(at(2020, 1, 1), {}) && !inRange(undefined, {}), "open range takes anything with a date");
ok(inRange(at(2026, 10, 10), { from: "2026-10-10" }) && !inRange(at(2026, 10, 9), { from: "2026-10-10" }), "from only");
ok(inRange(at(2026, 10, 10), { to: "2026-10-10" }) && !inRange(at(2026, 10, 11), { to: "2026-10-10" }), "to only");
const g = groupByDay([{ t: at(2026, 10, 15, 9), n: 1 }, { t: at(2026, 10, 15, 8), n: 2 }, { t: at(2026, 10, 14, 9), n: 3 }], (x) => x.t);
ok(g.length === 2 && g[0].day === "2026-10-15" && g[0].items.map((x) => x.n).join() === "1,2" && g[1].items[0].n === 3, "grouped by day, order kept");
if (fails) { console.log(`\n${fails} failing`); process.exit(1); }
console.log("\ndates: all passed");
