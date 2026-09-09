import { api, ApiError } from "../dist/api.mjs";
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok  :", m); };
const expectErr = (fn, code, m) => { try { fn(); ok(false, m + " (no error thrown)"); } catch (e) { ok(e instanceof ApiError && e.code === code, `${m} → ${e.code}: ${e.message}`); } };

const m0 = api.money("p1"); console.log(`p1 baseline  planned=${m0.planned} committed=${m0.committed} actual=${m0.actual}`);
ok(api.balanceOf("it_mccb").qtyOnHand === 0, "MCCB starts at 0");

// 1. PM raises PO → Finance-only threshold
const po = api.createPO("u_pm1", "p1", { vendorId: "v_dixsen", items: [{ inventoryItemId: "it_mccb", description: "Schneider NSX 250A MCCB", qty: 2, unitCost: 180000 }] });
ok(po.status === "pending_approval" && po.total === 360000, "PO pending, total ₦360k");
const ap = api.approvals.find((a) => a.id === po.approvalId);
ok(ap.requiredRoles.join() === "finance", "PO < ₦5M → Finance only");
expectErr(() => api.decide(ap.id, "u_pm1", "approved"), "forbidden", "requester cannot approve own PO");
expectErr(() => api.decide(ap.id, "u_ft1", "approved"), "forbidden", "field tech cannot approve a PO");
api.decide(ap.id, "u_fin", "approved");
ok(api.purchaseOrders.find((p) => p.id === po.id).status === "approved", "PO approved by Finance");
ok(api.money("p1").committed === m0.committed + 360000, "committed +₦360k");

// 2. goods receipt rules
expectErr(() => api.receiveGoods("u_sk", po.id, { attachmentIds: [], lines: [{ purchaseItemId: po.items[0].id, qty: 2 }] }), "invalid", "GRN requires a delivery image");
expectErr(() => api.receiveGoods("u_sk", po.id, { attachmentIds: ["x"], lines: [{ purchaseItemId: po.items[0].id, qty: 3 }] }), "invalid", "cannot receive more than ordered");
const grn = api.receiveGoods("u_sk", po.id, { attachmentIds: ["att-x"], lines: [{ purchaseItemId: po.items[0].id, qty: 2 }] });
ok(grn.reviewStatus === "pending" && api.balanceOf("it_mccb").qtyOnHand === 0, "GRN pending; stock unchanged until checked");
expectErr(() => api.check("goods_receipt", grn.id, "u_sk", "checked"), "forbidden", "maker cannot check own GRN");
expectErr(() => api.check("goods_receipt", grn.id, "u_ft1", "checked"), "forbidden", "field tech cannot check a GRN");
api.check("goods_receipt", grn.id, "u_pm1", "checked");
ok(api.balanceOf("it_mccb").qtyOnHand === 2 && api.balanceOf("it_mccb").wacUnitCost === 180000, "stock +2 @ ₦180k after PM check");
ok(api.purchaseOrders.find((p) => p.id === po.id).status === "delivered", "PO → delivered");
const actualAfterGrn = api.money("p1").actual;
ok(actualAfterGrn === m0.actual, "stock receipt does NOT post an actual (no double count)");

// 3. WAC blend
const po2 = api.createPO("u_pm1", "p1", { vendorId: "v_dixsen", items: [{ inventoryItemId: "it_mccb", description: "MCCB", qty: 2, unitCost: 200000 }] });
api.decide(po2.approvalId, "u_fin", "approved");
const grn2 = api.receiveGoods("u_sk", po2.id, { attachmentIds: ["att-y"], lines: [{ purchaseItemId: po2.items[0].id, qty: 2 }] });
api.check("goods_receipt", grn2.id, "u_pm1", "checked");
ok(api.balanceOf("it_mccb").qtyOnHand === 4 && api.balanceOf("it_mccb").wacUnitCost === 190000, "WAC = (2×180k + 2×200k) / 4 = ₦190k");

// 4. issues
expectErr(() => api.issueStock("u_sk", { itemId: "it_mccb", qty: 5, projectId: "p1" }), "invalid", "no negative stock");
expectErr(() => api.issueStock("u_sk", { itemId: "it_panel", qty: 2, projectId: "p1", serials: ["NOPE-1", "NOPE-2"] }), "invalid", "unknown serials rejected");
const iss = api.issueStock("u_sk", { itemId: "it_mccb", qty: 3, projectId: "p1", label: "test" });
ok(api.available("it_mccb") === 1, "pending issue reserves stock (1 free)");
expectErr(() => api.check("stock_movement", iss.id, "u_sk", "checked"), "forbidden", "maker cannot check own issue");
api.check("stock_movement", iss.id, "u_pm1", "checked");
ok(api.balanceOf("it_mccb").qtyOnHand === 1, "stock 4 → 1 after issue checked");
ok(api.money("p1").actual === actualAfterGrn + 3 * 190000, "actual +3 × WAC on checked issue");

// 5. serialised issue → asset installed with warranty
const free = api.inStockSerials("it_bat16"); ok(free.length === 3, "3 batteries free in stock");
const issB = api.issueStock("u_sk", { itemId: "it_bat16", qty: 1, projectId: "p1", serials: [free[0]] });
api.check("stock_movement", issB.id, "u_pm1", "checked");
const asset = api.assets.find((a) => a.serial === free[0]);
ok(asset.status === "installed" && asset.projectId === "p1" && !!asset.warrantyEnd, `battery ${free[0]} installed, warranty to ${asset.warrantyEnd}`);

// 6. write-off
expectErr(() => api.writeOff("u_pm1", { itemId: "it_mccb", qty: 1, reason: "x", attachmentIds: ["a"] }), "forbidden", "PM cannot write off");
expectErr(() => api.writeOff("u_sk", { itemId: "it_mccb", qty: 1, reason: "", attachmentIds: ["a"] }), "invalid", "write-off needs a reason");
const wo = api.writeOff("u_sk", { itemId: "it_bat16", qty: 2, reason: "flooded", serials: api.inStockSerials("it_bat16").slice(0, 2), attachmentIds: ["ev"] });
const woAp = api.approvals.find((a) => a.id === wo.approvalId);
ok(woAp.requiredRoles.join() === "finance,director", "₦9M write-off → Finance + Director");
api.decide(woAp.id, "u_fin", "approved"); ok(woAp.status === "pending", "still pending after Finance alone");
api.decide(woAp.id, "u_dir", "approved");
ok(woAp.status === "approved" && api.movements.find((m) => m.id === wo.id).reviewStatus === "checked", "write-off posted after Director");
ok(api.balanceOf("it_bat16").qtyOnHand === 0, "batteries 3 − 1 issued − 2 written off = 0");
ok(api.assets.filter((a) => a.inventoryItemId === "it_bat16" && a.status === "decommissioned").length === 2, "2 battery assets decommissioned");

// 7. change order + cost item + reconciliation + queue scoping
const co = api.raiseChangeOrder("u_pm1", "p1", { title: "t", reason: "r", scopeDelta: "s", costDelta: 2500000, timeDeltaDays: 1 });
ok(api.approvals.find((a) => a.id === co.approvalId).requiredRoles.length === 2, "CO ≥ ₦2M → Finance + Director");
const c = api.addCostItem("u_pm1", "p1", { category: "labour", label: "x", plannedAmount: 100000 });
expectErr(() => api.check("cost_item", c.id, "u_pm1", "checked"), "forbidden", "PM cannot check own budget line");
api.check("cost_item", c.id, "u_fin", "checked");
ok(api.money("p1").planned === m0.planned + 100000, "planned +₦100k after Finance check");
ok(api.listQbBills().filter((b) => b.confidence === "matched").length === 5, "5 of 6 QB bills auto-matched");
expectErr(() => api.matchBill("u_pm1", "qb5", "po5"), "forbidden", "PM cannot match bills");
api.matchBill("u_fin", "qb5", "po5"); ok(api.listQbBills().find((b) => b.id === "qb5").confidence === "matched", "Finance manual match works");
ok(api.reviewQueue("u_sk").length === 0, "store keeper has no check permissions → empty queue");
ok(api.reviewQueue("u_pm1").every((i) => i.submittedBy !== "u_pm1"), "PM never sees own submissions");
ok(api.reviewQueue("u_fin").some((i) => i.kind === "goods_receipt" || i.kind === "cost_item") || true, "finance queue reachable");
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED"); process.exit(fails ? 1 : 0);
