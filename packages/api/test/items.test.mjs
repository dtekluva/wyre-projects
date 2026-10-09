// "There is no way to label PPE": the name guess is only a default — the Kind picker and updateItem decide.
import { MockApi, ApiError, guessCategory, CATEGORY_GROUPS, ASSET_TYPES } from "../dist/api.mjs";
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok  :", m); };
const throws = (fn, code, m) => { try { fn(); ok(false, `${m} (no throw)`); } catch (e) { ok(e instanceof ApiError && e.code === code, `${m} → ${e.code ?? e.message}`); } };

ok(guessCategory("Face shield") === "ppe", "face shield is PPE");
ok(guessCategory("Cable tester") === "tool", "cable tester is a tool, not cable");
ok(guessCategory("Clamp meter") === "tool", "clamp meter is a tool, not a meter");
ok(guessCategory("Safety vest") === "ppe", "vest is PPE");
ok(guessCategory("Investment panel") === "panel", "'vest' inside 'investment' is not a vest");
ok(guessCategory("Deye inverter 8kVA") === "inverter", "inverter");
ok(guessCategory("Rubber boats") === "other", "'ats' inside 'boats' is not an ATS");
ok(guessCategory("Something odd") === "other", "unknown → other");
ok(CATEGORY_GROUPS.flatMap((g) => g.categories).length === ASSET_TYPES.length, "every category is in exactly one group");
ok(CATEGORY_GROUPS[1].categories.join() === "tool,ppe", "team kit group is tool + ppe");

const api = new MockApi();
const sk = api.getUsers().find((u) => u.roles.includes("store_keeper"))?.id;
const ft = api.getUsers().find((u) => u.roles.length === 1 && u.roles[0] === "tech")?.id;
ok(!!sk && !!ft, "seed has a store keeper and a field tech");
const it = api.items.find((i) => i.category !== "tool" && i.category !== "ppe");
const before = api.toolHoldings().length;
throws(() => api.updateItem(ft, it.id, { category: "ppe" }), "forbidden", "a field tech cannot relabel");
throws(() => api.updateItem(sk, it.id, { category: "gadget" }), "invalid", "unknown kind rejected");
throws(() => api.updateItem(sk, "it_nope", { category: "ppe" }), "not_found", "unknown item");
throws(() => api.updateItem(sk, it.id, { reorderLevel: -1 }), "invalid", "negative reorder rejected");
throws(() => api.updateItem(sk, it.id, { name: " " }), "invalid", "blank name rejected");
const other = api.items.find((i) => i.id !== it.id);
throws(() => api.updateItem(sk, it.id, { name: other.name.toUpperCase() }), "conflict", "duplicate name rejected");
const after = api.updateItem(sk, it.id, { category: "ppe", reorderLevel: 2, reorderQty: 5 });
ok(after.category === "ppe" && after.reorderLevel === 2 && after.reorderQty === 5, "relabelled with reorder figures");
ok(api.isTool(it.id), "now counts as team kit");
ok(api.toolHoldings().length >= before, "holdings still computes");

if (fails) { console.log(`\n${fails} failing`); process.exit(1); }
console.log("\nitems: all passed");
