// Regression: the engine must never assume the demo warehouse id exists.
//
// Production's warehouse is "Yaba" (id loc_<hex>), not the seed's `loc_wh`. Every stock read
// defaulted its locationId to the literal "loc_wh", so on production balanceOf/available/
// inStockSerials looked up a location that does not exist and reported 0 for everything —
// the "Issue stock to this project" picker showed 0 pcs beside items with 90 panels in stock.
// This test renames the warehouse the way production is named and asserts the real figures.
import { MockApi, ApiError } from "../dist/api.mjs";
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok  :", m); };

const api = new MockApi();
const wh = api.locations.find((l) => l.id === "loc_wh");
ok(!!wh, "seed has a warehouse to rename");

// Rename it exactly as production does: a generated id and a real branch name.
const PROD_ID = "loc_3f9c1a02";
for (const m of api.movements) {
  if (m.locationFromId === "loc_wh") m.locationFromId = PROD_ID;
  if (m.locationToId === "loc_wh") m.locationToId = PROD_ID;
}
wh.id = PROD_ID; wh.name = "Yaba";
ok(api.mainLocationId() === PROD_ID, "mainLocationId derives the renamed warehouse");
ok(!JSON.stringify(api.locations).includes("loc_wh"), "no location is called loc_wh any more");

// Receive stock into it, the way a checked goods receipt does.
const po = api.createPO("u_pm1", "p1", { vendorId: "v_dixsen", items: [{ inventoryItemId: "it_mccb", description: "MCCB", qty: 5, unitCost: 100000 }] });
api.decide(api.approvals.find((a) => a.id === po.approvalId).id, "u_fin", "approved");
const grn = api.receiveGoods("u_sk", po.id, { attachmentIds: ["att-x"], lines: [{ purchaseItemId: po.items[0].id, qty: 5 }] });
api.check("goods_receipt", grn.id, "u_pm1", "checked");

// The three reads that were returning 0 on production.
ok(api.balanceOf("it_mccb").qtyOnHand === 5, `balanceOf sees the stock (${api.balanceOf("it_mccb").qtyOnHand})`);
ok(api.available("it_mccb") === 5, `available sees the stock (${api.available("it_mccb")})`);
ok(api.balanceOf("it_mccb").wacUnitCost === 100000, "WAC is carried, not zeroed");

// A zero-stock item must report against the real warehouse, not a phantom one.
const zero = api.balances().find((b) => b.qtyOnHand === 0);
ok(!zero || zero.locationId === PROD_ID, "synthesised zero rows carry the real location id");

// Issuing must draw down from the same place, and stock out when it runs dry.
api.issueStock("u_sk", { itemId: "it_mccb", projectId: "p1", qty: 2 });
ok(api.available("it_mccb") === 3, `issue reserves against the real warehouse (${api.available("it_mccb")})`);
try { api.issueStock("u_sk", { itemId: "it_mccb", projectId: "p1", qty: 99 }); ok(false, "over-issue should be refused"); }
catch (e) { ok(e instanceof ApiError, `over-issue refused → ${e.code}: ${e.message}`); }

console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
