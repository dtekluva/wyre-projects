// Stock requests: the ops team asks, the store keeper hands over (that IS the check), the project updates itself.
import { MockApi, ApiError } from "../dist/api.mjs";
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok  :", m); };
const throws = (fn, code, m) => { try { fn(); ok(false, `${m} (no throw)`); } catch (e) { ok(e instanceof ApiError && e.code === code, `${m} → ${e.code ?? e.message}`); } };

const api = new MockApi();
const tech = "u_ft1", sk = "u_sk", pm = "u_pm1";
const cable = api.items.find((i) => i.id === "it_cable"); const panel = api.items.find((i) => i.id === "it_panel");
ok(!!cable && !!panel && panel.isSerialised, "seed has cable (plain) and panels (serialised)");
const availCable = api.available(cable.id), availPanel = api.available(panel.id);
ok(availCable > 10 && availPanel > 2, `stock on hand: cable ${availCable}, panels ${availPanel}`);

throws(() => api.requestStock(sk, "p1", { lines: [{ itemId: cable.id, qty: 1 }] }), "forbidden", "the store keeper does not request");
const off = api.getUsers().find((u) => u.roles.length === 1 && u.roles[0] === "tech" && !api.can(u.id, "inventory.request", "p1"));
if (off) throws(() => api.requestStock(off.id, "p1", { lines: [{ itemId: cable.id, qty: 1 }] }), "forbidden", `a tech off the project (${off.name}) cannot request on it`);
throws(() => api.requestStock(tech, "p1", { lines: [] }), "invalid", "empty request");
throws(() => api.requestStock(tech, "p1", { lines: [{ itemId: cable.id, qty: 0 }] }), "invalid", "zero quantity");
const r = api.requestStock(tech, "p1", { lines: [{ itemId: cable.id, qty: 6 }, { itemId: cable.id, qty: 4 }, { itemId: panel.id, qty: 2 }], note: "String 3" });
ok(r.status === "requested" && r.lines.length === 2 && r.lines[0].qty === 10, "lines merge, status requested");
ok(api.available(cable.id) === availCable, "a request reserves nothing");
const actuals0 = api.actuals.filter((a) => a.projectId === "p1").length;
ok(api.listEvents("p1")[0].eventType === "stock_request" && api.listEvents("p1")[0].summary.startsWith("Stock requested"), "chronology: requested");

throws(() => api.fulfilRequest(tech, r.id, { lines: [{ itemId: cable.id, qty: 10 }] }), "forbidden", "a tech cannot fulfil");
throws(() => api.fulfilRequest(pm, r.id, { lines: [{ itemId: cable.id, qty: 10 }] }), "forbidden", "a PM cannot fulfil");
throws(() => api.fulfilRequest(sk, r.id, { lines: [] }), "invalid", "nothing supplied");
throws(() => api.fulfilRequest(sk, r.id, { lines: [{ itemId: cable.id, qty: 11 }] }), "invalid", "over-supply rejected");
throws(() => api.fulfilRequest(sk, r.id, { lines: [{ itemId: panel.id, qty: 2 }] }), "invalid", "serialised line needs serials");
throws(() => api.fulfilRequest(sk, r.id, { lines: [{ itemId: "it_mccb", qty: 1 }] }), "invalid", "an item that was not requested");
const serials = api.inStockSerials(panel.id).slice(0, 2);
const f = api.fulfilRequest(sk, r.id, { lines: [{ itemId: cable.id, qty: 8 }, { itemId: panel.id, qty: 2, serials }], note: "2 m short" });
ok(f.status === "fulfilled" && f.movementIds.length === 2 && f.fulfilledBy === sk, "fulfilled with two movements");
const ms = f.movementIds.map((id) => api.movements.find((m) => m.id === id));
ok(ms.every((m) => m.reviewStatus === "checked" && m.checkedBy === sk && m.submittedBy === tech && m.movementType === "issue"), "each movement is a CHECKED issue, requester = maker, store = checker");
ok(api.available(cable.id) === availCable - 8 && api.available(panel.id) === availPanel - 2, "stock dropped at once");
ok(serials.every((s) => api.assets.find((a) => a.serial === s)?.status === "installed"), "serialised units installed on the project");
ok(api.actuals.filter((a) => a.projectId === "p1").length === actuals0 + 2, "two actuals posted to the project");
ok(f.lines.find((l) => l.itemId === cable.id).suppliedQty === 8, "short supply recorded on the line");
ok(/Short: .*8\/10/.test(api.listEvents("p1")[0].detail ?? ""), "chronology notes the shortfall");
throws(() => api.fulfilRequest(sk, r.id, { lines: [{ itemId: cable.id, qty: 1 }] }), "conflict", "cannot fulfil twice");

// nobody fulfils their own request, whatever roles they stack
const admin = api.getUsers().find((u) => api.can(u.id, "users.manage")).id;
api.setUserRoles(admin, pm, [...api.getUsers().find((u) => u.id === pm).roles, "store_keeper"]);
ok(api.can(pm, "inventory.write") && api.can(pm, "inventory.request", "p1"), "a PM who also keeps the store can both request and fulfil");
const own = api.requestStock(pm, "p1", { lines: [{ itemId: cable.id, qty: 1 }] });
throws(() => api.fulfilRequest(pm, own.id, { lines: [{ itemId: cable.id, qty: 1 }] }), "forbidden", "self-fulfilment refused");
api.fulfilRequest(sk, own.id, { lines: [{ itemId: cable.id, qty: 1 }] });

const r2 = api.requestStock(tech, "p1", { lines: [{ itemId: cable.id, qty: 1 }] });
throws(() => api.declineRequest(sk, r2.id, "  "), "invalid", "decline needs a reason");
throws(() => api.declineRequest(tech, r2.id, "no"), "forbidden", "only the store declines");
ok(api.declineRequest(sk, r2.id, "Out until Friday").status === "declined", "declined with reason");
const r3 = api.requestStock(tech, "p1", { lines: [{ itemId: cable.id, qty: 1 }] });
throws(() => api.cancelRequest("u_le1", r3.id), "forbidden", "a third party cannot withdraw");
ok(api.cancelRequest(tech, r3.id).status === "cancelled", "requester withdraws");
throws(() => api.declineRequest(sk, r3.id, "x"), "conflict", "cannot decline a withdrawn request");
ok(api.listStockRequests({ projectId: "p1", status: "requested" }).every((x) => x.id === "sr1"), "only the seed request still waits on p1");

if (fails) { console.log(`\n${fails} failing`); process.exit(1); }
console.log("\nrequests: all passed");
