// Phase 2 seed — money, assets, stock. Generated so committed / actual / stock reconcile with each other.
import type {
  Vendor, InventoryItem, StockLocation, CostItem, PurchaseOrder, PurchaseItem, GoodsReceipt, Asset, StockMovement, Actual,
  ChangeOrder, Retention, QbBill, CostCategory, AssetType, ReviewStatus,
} from "../types";
import { NOW } from "./data";

const d = (daysAgo: number, hh = 10) => { const t = new Date(NOW); t.setDate(t.getDate() - daysAgo); t.setHours(hh, 0, 0, 0); return t.toISOString(); };
const ahead = (days: number) => { const t = new Date(NOW); t.setDate(t.getDate() + days); return t.toISOString().slice(0, 10); };
const audit = (by: string, at: string) => ({ createdAt: at, createdBy: by, updatedAt: at, updatedBy: by });
const review = (by: string, at: string, rs: ReviewStatus = "checked", checkedBy = "u_fin") =>
  ({ reviewStatus: rs, submittedBy: by, submittedAt: at, reviewVersion: 1, checkedBy: rs === "pending" ? undefined : checkedBy, checkedAt: rs === "pending" ? undefined : at });

export const vendors: Vendor[] = [
  { id: "v_solarmax", name: "Solarmax Global Multi Concept", category: "Panels" },
  { id: "v_fouani", name: "Fouani Nigeria Ltd", category: "Inverters & batteries" },
  { id: "v_bluecarbon", name: "Blue Carbon Tech", category: "Batteries" },
  { id: "v_acrel", name: "Acrel Electrical Manufacturing", category: "Metering" },
  { id: "v_dixsen", name: "Zhejiang Dixsen Electrical", category: "Switchgear" },
  { id: "v_adekunle", name: "Adekunle & Partners", category: "Civil / structural" },
  { id: "v_freight", name: "Lagos Freight Co", category: "Logistics" },
  { id: "v_consult", name: "Gridwise Consulting", category: "Engineering services" },
];

export const locations: StockLocation[] = [
  { id: "loc_wh", name: "Main warehouse — Ikeja", type: "warehouse", custodianId: "u_sk", isActive: true },
];

const I = (id: string, sku: string, name: string, category: InventoryItem["category"], unit: string, isSerialised: boolean, reorderLevel: number, reorderQty: number, extra: Partial<InventoryItem> = {}): InventoryItem =>
  ({ id, sku, name, category, unit, isSerialised, reorderLevel, reorderQty, isActive: true, ...extra });

export const items: InventoryItem[] = [
  I("it_panel", "JKM-615", "Jinko Tiger Neo 615W panel", "panel", "pcs", true, 40, 100, { defaultVendorId: "v_solarmax", make: "Jinko", model: "JKM615N-78HL4-V", warrantyMonths: 144 }),
  I("it_inv50", "DEYE-50K", "Deye SUN-50K hybrid inverter", "inverter", "pcs", true, 1, 2, { defaultVendorId: "v_fouani", make: "Deye", model: "SUN-50K-SG01HP3", warrantyMonths: 120 }),
  I("it_inv80", "DEYE-80K", "Deye SUN-80K hybrid inverter", "inverter", "pcs", true, 0, 2, { defaultVendorId: "v_fouani", make: "Deye", model: "SUN-80K-SG01HP3", warrantyMonths: 120 }),
  I("it_bat16", "DEYE-BAT16", "Deye 16 kWh LFP battery", "battery", "pcs", true, 2, 4, { defaultVendorId: "v_fouani", make: "Deye", model: "SE-G5.3 ×3", warrantyMonths: 120 }),
  I("it_meter", "AWT200", "Acrel AWT200 energy meter", "meter", "pcs", true, 5, 10, { defaultVendorId: "v_acrel", make: "Acrel", model: "AWT200", warrantyMonths: 24 }),
  I("it_ct", "CT-1200-5", "Current transformer 1200/5 A", "ct", "pcs", false, 6, 12, { defaultVendorId: "v_acrel" }),
  I("it_cable", "DC-6MM", "DC solar cable 6 mm²", "cable", "m", false, 500, 1000, { defaultVendorId: "v_dixsen" }),
  I("it_mc4", "MC4", "MC4 connector pair", "consumable", "pcs", false, 100, 200, { defaultVendorId: "v_dixsen" }),
  I("it_rail", "RAIL-4M", "Aluminium mounting rail 4.2 m", "mounting", "pcs", false, 40, 80, { defaultVendorId: "v_dixsen" }),
  I("it_mccb", "MCCB-250", "Schneider NSX 250A MCCB", "other", "pcs", false, 2, 4, { defaultVendorId: "v_dixsen" }),
  I("it_fuse", "DCFUSE-15", "DC fuse 15 A", "consumable", "pcs", false, 20, 50, { defaultVendorId: "v_dixsen" }),
];
const itemAssetType = (it: InventoryItem): AssetType => (["panel","inverter","battery","meter","ct","ats","cable","mounting"].includes(it.category) ? it.category as AssetType : "other");

// ---------------- cost items (budget lines) ----------------
const SPLIT: [CostCategory, number][] = [["equipment", .62], ["civil", .12], ["labour", .12], ["logistics", .05], ["permits", .04], ["contingency", .05]];
const BUDGET: Record<string, number> = { p1: 51_000_000, p2: 106_000_000, p3: 700_000_000, p4: 15_900_000, p5: 36_500_000, p6: 8_100_000, p8: 58_500_000 };
let cid = 0;
export const costItems: CostItem[] = Object.entries(BUDGET).flatMap(([p, b]) =>
  SPLIT.map(([cat, f]) => ({ id: `ci${++cid}`, projectId: p, category: cat, label: `${cat[0].toUpperCase()}${cat.slice(1)} — ${p === "p6" ? "metering" : "solar"}`, plannedAmount: Math.round(b * f / 1000) * 1000,
    ...audit("u_pm1", d(100)), ...review("u_pm1", d(100)) })));
// one pending line (Finance to check)
costItems.push({ id: `ci${++cid}`, projectId: "p1", category: "labour", label: "Site security (nights, 3 weeks)", plannedAmount: 420_000, ...audit("u_pm1", d(2)), ...review("u_pm1", d(2), "pending") });
const ci = (p: string, cat: CostCategory) => costItems.find((c) => c.projectId === p && c.category === cat)!.id;

// ---------------- purchase orders ----------------
let pid = 0;
const line = (description: string, qty: number, unitCost: number, inventoryItemId?: string, costItemId?: string, qtyReceived = 0): PurchaseItem =>
  ({ id: `pi${++pid}`, description, qty, unitCost, lineTotal: qty * unitCost, inventoryItemId, costItemId, qtyReceived });
const PO = (id: string, projectId: string, poNumber: string, vendorId: string, status: PurchaseOrder["status"], daysAgo: number, items: PurchaseItem[], approvalId?: string, notes?: string): PurchaseOrder =>
  ({ id, projectId, poNumber, vendorId, status, raisedBy: "u_pm1", raisedAt: d(daysAgo), items, total: items.reduce((s, i) => s + i.lineTotal, 0), approvalId, notes, ...audit("u_pm1", d(daysAgo)) });

export const purchaseOrders: PurchaseOrder[] = [
  PO("po1", "p1", "PO-2026-027", "v_solarmax", "delivered", 46, [line("Jinko 615W panel", 66, 150_000, "it_panel", ci("p1","equipment"), 66)]),
  PO("po2", "p1", "PO-2026-028", "v_fouani", "delivered", 45, [line("Deye 16 kWh battery", 7, 4_500_000, "it_bat16", ci("p1","equipment"), 7)]),
  PO("po3", "p1", "PO-2026-029", "v_adekunle", "delivered", 30, [line("Roof reinforcement & inverter plinth (civil)", 1, 2_800_000, undefined, ci("p1","civil"), 1)]),
  PO("po4", "p1", "PO-2026-031", "v_fouani", "pending_approval", 44, [line("Deye SUN-50K hybrid inverter", 1, 7_400_000, "it_inv50", ci("p1","equipment"))], "ap2"),
  PO("po5", "p2", "PO-2026-033", "v_solarmax", "delivered", 12, [line("Jinko 615W panel", 220, 150_000, "it_panel", ci("p2","equipment"), 220)]),
  PO("po6", "p2", "PO-2026-034", "v_fouani", "approved", 10, [line("Deye SUN-80K hybrid inverter", 2, 12_200_000, "it_inv80", ci("p2","equipment"))]),
  PO("po7", "p2", "PO-2026-035", "v_fouani", "approved", 9, [line("Deye 16 kWh battery", 11, 4_500_000, "it_bat16", ci("p2","equipment"))]),
  PO("po8", "p4", "PO-2025-061", "v_fouani", "delivered", 240, [line("Jinko 615W panel", 12, 120_000, "it_panel", ci("p4","equipment"), 12), line("Deye SUN-50K inverter", 1, 6_200_000, "it_inv50", ci("p4","equipment"), 1), line("Deye 16 kWh battery", 2, 3_900_000, "it_bat16", ci("p4","equipment"), 2)]),
  PO("po9", "p5", "PO-2026-030", "v_adekunle", "delivered", 38, [line("Structural survey & roof load report", 1, 2_100_000, undefined, ci("p5","civil"), 1)]),
  PO("po10", "p6", "PO-2025-072", "v_acrel", "delivered", 108, [line("Acrel AWT200 meter", 8, 180_000, "it_meter", ci("p6","equipment"), 8), line("CT 1200/5 A", 8, 25_000, "it_ct", ci("p6","equipment"), 8)]),
  PO("po11", "p6", "PO-2025-073", "v_consult", "delivered", 100, [line("Generator right-sizing study & ATS commissioning", 1, 6_200_000, undefined, ci("p6","labour"), 1)]),
  PO("po12", "p8", "PO-2024-019", "v_consult", "closed", 620, [line("EPC turnkey — 80 kWp (legacy contract)", 1, 57_900_000, undefined, ci("p8","equipment"), 1)]),
];
const pi = (poId: string, idx = 0) => purchaseOrders.find((p) => p.id === poId)!.items[idx];

// ---------------- goods receipts ----------------
let gid = 0;
const GRN = (projectId: string, poId: string, daysAgo: number, by: string, lines: GoodsReceipt["lines"], rs: ReviewStatus = "checked", checkedBy = "u_pm1"): GoodsReceipt =>
  ({ id: `grn${++gid}`, projectId, poId, grnNumber: `GRN-${2026 - (daysAgo > 300 ? 1 : 0)}-${String(10 + gid).padStart(3, "0")}`, receivedAt: d(daysAgo), receivedBy: by,
     lines, attachmentIds: ["att3"], locationId: "loc_wh", ...audit(by, d(daysAgo)), ...review(by, d(daysAgo), rs, checkedBy) });
const serials = (prefix: string, from: number, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${String(from + i).padStart(4, "0")}`);

export const goodsReceipts: GoodsReceipt[] = [
  GRN("p1", "po1", 38, "u_sk", [{ purchaseItemId: pi("po1").id, qty: 66, serials: serials("JKM26-", 1, 66), condition: "good" }]),
  GRN("p1", "po2", 37, "u_sk", [{ purchaseItemId: pi("po2").id, qty: 7, serials: serials("DBAT-", 101, 7), condition: "good" }]),
  GRN("p1", "po3", 20, "u_pm1", [{ purchaseItemId: pi("po3").id, qty: 1, condition: "good" }], "checked", "u_fin"),
  GRN("p2", "po5", 4, "u_sk", [{ purchaseItemId: pi("po5").id, qty: 220, serials: serials("JKM26-", 201, 220), condition: "good" }]),
  GRN("p4", "po8", 235, "u_sk", [{ purchaseItemId: pi("po8",0).id, qty: 12, serials: serials("JKM25-", 1, 12), condition: "good" }, { purchaseItemId: pi("po8",1).id, qty: 1, serials: ["DINV-0007"], condition: "good" }, { purchaseItemId: pi("po8",2).id, qty: 2, serials: ["DBAT-0031","DBAT-0032"], condition: "good" }]),
  GRN("p5", "po9", 34, "u_pm1", [{ purchaseItemId: pi("po9").id, qty: 1, condition: "good" }], "checked", "u_fin"),
  GRN("p6", "po10", 104, "u_sk", [{ purchaseItemId: pi("po10",0).id, qty: 8, serials: ["25062405300051","25062405300150","25062405300134","25062405300109","25062405300144","25062405300183","25062405300079","25062405300043"], condition: "good" }, { purchaseItemId: pi("po10",1).id, qty: 8, condition: "good" }]),
  GRN("p6", "po11", 84, "u_pm2", [{ purchaseItemId: pi("po11").id, qty: 1, condition: "good" }], "checked", "u_fin"),
  GRN("p8", "po12", 590, "u_pm2", [{ purchaseItemId: pi("po12").id, qty: 1, condition: "good" }], "checked", "u_fin"),
];

// ---------------- stock ledger, assets, actuals ----------------
let mid = 0, aid = 0, acid = 0;
export const movements: StockMovement[] = [];
export const assets: Asset[] = [];
export const actuals: Actual[] = [];

const MV = (m: Omit<StockMovement, "id" | "totalCost" | keyof ReturnType<typeof review>> & { rs?: ReviewStatus; checkedBy?: string }): StockMovement => {
  const { rs, checkedBy, ...rest } = m;
  const row: StockMovement = { ...rest, id: `mv${++mid}`, totalCost: rest.qty * rest.unitCost, ...review(rest.createdBy, rest.createdAt, rs ?? "checked", checkedBy ?? "u_pm1") };
  movements.push(row); return row;
};
const ASSET = (itemId: string, serial: string, unitCost: number, opts: Partial<Asset> & { createdAt: string }): Asset => {
  const it = items.find((i) => i.id === itemId)!;
  const a: Asset = { id: `as${++aid}`, inventoryItemId: itemId, assetType: itemAssetType(it), make: it.make ?? "", model: it.model ?? it.name, serial, unitCost,
    status: "in_stock", locationId: "loc_wh", ...audit("u_sk", opts.createdAt), ...opts };
  assets.push(a); return a;
};
const ACT = (a: Omit<Actual, "id">) => { actuals.push({ id: `act${++acid}`, ...a }); };

// receipts from checked GRNs (stock lines) + service actuals (non-stock lines)
for (const g of goodsReceipts) {
  if (g.reviewStatus !== "checked") continue;
  const po = purchaseOrders.find((p) => p.id === g.poId)!;
  for (const l of g.lines) {
    const item = po.items.find((i) => i.id === l.purchaseItemId)!;
    if (item.inventoryItemId) {
      MV({ itemId: item.inventoryItemId, movementType: "receipt", qty: l.qty, locationToId: g.locationId, unitCost: item.unitCost, projectId: g.projectId,
        sourceRef: { model: "GoodsReceipt", id: g.id, label: g.grnNumber }, serials: l.serials, createdBy: g.receivedBy, createdAt: g.receivedAt, checkedBy: g.checkedBy });
      (l.serials ?? []).forEach((s) => ASSET(item.inventoryItemId!, s, item.unitCost, { vendorId: po.vendorId, purchaseItemId: item.id, grnId: g.id, createdAt: g.receivedAt }));
    } else {
      ACT({ projectId: g.projectId, costItemId: item.costItemId, category: costItems.find((c) => c.id === item.costItemId)?.category ?? "equipment", source: "goods_receipt",
        sourceRef: { model: "GoodsReceipt", id: g.id, label: `${g.grnNumber} · ${item.description}` }, amount: l.qty * item.unitCost, date: g.receivedAt, vendorId: po.vendorId,
        attachmentIds: g.attachmentIds, createdBy: g.checkedBy ?? g.receivedBy });
    }
  }
}
// opening stock (consumables + a few meters) — checked by Finance
const opening = (itemId: string, qty: number, unitCost: number, serialsList?: string[]) => {
  MV({ itemId, movementType: "receipt", qty, locationToId: "loc_wh", unitCost, reason: "Opening stock count — Jan 2026",
    sourceRef: { model: "StockCount", id: "sc-2026-01", label: "Opening balance" }, serials: serialsList, createdBy: "u_sk", createdAt: d(250), checkedBy: "u_fin" });
  (serialsList ?? []).forEach((s) => ASSET(itemId, s, unitCost, { createdAt: d(250) }));
};
opening("it_cable", 2000, 1_200); opening("it_mc4", 400, 1_500); opening("it_rail", 120, 18_000); opening("it_fuse", 60, 8_000); opening("it_ct", 24, 25_000);
opening("it_meter", 4, 175_000, ["25062405300060", "25062405300063", "25062405300093", "25062405300115"]);

// issues to projects (WAC at time of issue — computed by the client; seed uses the item's receipt cost)
const issue = (itemId: string, qty: number, projectId: string, unitCost: number, daysAgo: number, by: string, opts: { serials?: string[]; rs?: ReviewStatus; checkedBy?: string; label?: string } = {}) => {
  const m = MV({ itemId, movementType: "issue", qty, locationFromId: "loc_wh", unitCost, projectId, serials: opts.serials, createdBy: by, createdAt: d(daysAgo),
    sourceRef: { model: "PickList", id: `pl-${projectId}-${mid}`, label: opts.label ?? "Installation pick list" }, rs: opts.rs, checkedBy: opts.checkedBy });
  if (m.reviewStatus === "checked") {
    (opts.serials ?? []).forEach((s) => { const a = assets.find((x) => x.serial === s)!; a.status = "installed"; a.projectId = projectId; a.installDate = m.createdAt; a.locationId = undefined;
      const it = items.find((i) => i.id === itemId)!; if (it.warrantyMonths) { a.warrantyStart = m.createdAt.slice(0, 10); const e = new Date(m.createdAt); e.setMonth(e.getMonth() + it.warrantyMonths); a.warrantyEnd = e.toISOString().slice(0, 10); } });
    ACT({ projectId, category: "equipment", source: "issue", sourceRef: { model: "StockMovement", id: m.id, label: `${items.find((i) => i.id === itemId)!.name} × ${qty}` },
      amount: m.totalCost, date: m.createdAt, attachmentIds: [], createdBy: m.checkedBy ?? by });
  }
  return m;
};
// p4 (2025, fully installed)
issue("it_panel", 12, "p4", 120_000, 230, "u_sk", { serials: serials("JKM25-", 1, 12), checkedBy: "u_pm2" });
issue("it_inv50", 1, "p4", 6_200_000, 230, "u_sk", { serials: ["DINV-0007"], checkedBy: "u_pm2" });
issue("it_bat16", 2, "p4", 3_900_000, 230, "u_sk", { serials: ["DBAT-0031", "DBAT-0032"], checkedBy: "u_pm2" });
issue("it_cable", 180, "p4", 1_200, 229, "u_sk", { checkedBy: "u_pm2" });
// p6 metering (installed)
issue("it_meter", 8, "p6", 180_000, 98, "u_sk", { serials: ["25062405300051","25062405300150","25062405300134","25062405300109","25062405300144","25062405300183","25062405300079","25062405300043"], checkedBy: "u_pm2" });
issue("it_ct", 8, "p6", 25_000, 98, "u_sk", { checkedBy: "u_pm2" });
// p1 Sango (installation in progress)
issue("it_panel", 44, "p1", 150_000, 8, "u_sk", { serials: serials("JKM26-", 1, 44) });
issue("it_bat16", 4, "p1", 4_500_000, 7, "u_sk", { serials: serials("DBAT-", 101, 4) });
issue("it_cable", 600, "p1", 1_200, 8, "u_sk"); issue("it_mc4", 140, "p1", 1_500, 8, "u_sk"); issue("it_rail", 40, "p1", 18_000, 9, "u_sk");
// pending issues (in PM's review queue)
issue("it_panel", 22, "p1", 150_000, 1, "u_sk", { serials: serials("JKM26-", 45, 22), rs: "pending", label: "Pick list — roof edge row" });
issue("it_panel", 100, "p2", 150_000, 1, "u_sk", { serials: serials("JKM26-", 201, 100), rs: "pending", label: "Pick list — strings 1–5" });
// pending write-off (Finance approval): 3 damaged panels
export const pendingWriteOff = MV({ itemId: "it_panel", movementType: "write_off", qty: 3, locationFromId: "loc_wh", unitCost: 150_000, reason: "Cracked glass on delivery — rejected by installer, photos attached",
  serials: serials("JKM26-", 418, 3), attachmentIds: ["att3"], createdBy: "u_sk", createdAt: d(3), rs: "pending", approvalId: "ap6" });

// ---------------- change orders & retention ----------------
export const changeOrders: ChangeOrder[] = [
  { id: "co1", projectId: "p1", coNumber: "CO-04", title: "+6 panels (roof edge row)", reason: "Client requested extra row", scopeDelta: "+6 × 615W panels, +1 rail set", costDelta: 1_200_000, timeDeltaDays: 2, status: "pending_approval", approvalId: "ap3", ...audit("u_pm1", d(1)) },
  { id: "co2", projectId: "p6", coNumber: "CO-02", title: "+2 CTs for kitchen feeder", reason: "Extra sub-metering requested at survey", scopeDelta: "+2 × CT 1200/5, +1 day", costDelta: 350_000, timeDeltaDays: 1, status: "approved", approvalId: "ap7", ...audit("u_pm2", d(120)) },
];
export const retentions: Retention[] = [
  { projectId: "p4", percent: 5, amountHeld: 920_000, releaseConditions: "DLP ends " + ahead(175) + " · snag list closed" },
  { projectId: "p6", percent: 5, amountHeld: 475_000, releaseConditions: "DLP 12 months from handover · final account agreed" },
  { projectId: "p8", percent: 5, amountHeld: 3_400_000, releaseConditions: "DLP complete", releasedAt: d(162), releasedBy: "u_dir", approvalId: "ap8" },
];

// ---------------- QuickBooks bills (synced) ----------------
export const qbBills: QbBill[] = [
  { id: "qb1", docNumber: "DESH25616", vendorName: "Solarmax Global Multi Concept", txnDate: "2026-08-28", dueDate: "2026-09-27", totalAmount: 33_000_000, balance: 33_000_000, currency: "NGN", projectId: "p2", matchStatus: "unmatched", syncedAt: d(0, 7) },
  { id: "qb2", docNumber: "FNL-2026-0412", vendorName: "Fouani Nigeria Ltd", txnDate: "2026-07-27", dueDate: "2026-08-26", totalAmount: 31_500_000, balance: 0, currency: "NGN", projectId: "p1", matchStatus: "unmatched", syncedAt: d(0, 7) },
  { id: "qb3", docNumber: "ADK-0117", vendorName: "Adekunle & Partners", txnDate: "2026-08-12", dueDate: "2026-09-11", totalAmount: 2_800_000, balance: 2_800_000, currency: "NGN", projectId: "p1", matchStatus: "unmatched", syncedAt: d(0, 7) },
  { id: "qb4", docNumber: "20250529001", vendorName: "Acrel Electrical Manufacturing", txnDate: "2026-05-25", dueDate: "2026-06-24", totalAmount: 1_640_000, balance: 0, currency: "NGN", projectId: "p6", matchStatus: "unmatched", syncedAt: d(0, 7) },
  { id: "qb5", docNumber: "BCT-0899-2026", vendorName: "Blue Carbon Tech", txnDate: "2026-08-30", dueDate: "2026-09-29", totalAmount: 18_900_000, balance: 18_900_000, currency: "NGN", projectId: "p2", matchStatus: "unmatched", syncedAt: d(0, 7) },
  { id: "qb6", docNumber: "FNL-2026-0455", vendorName: "Fouani Nigeria Ltd", txnDate: "2026-09-05", dueDate: "2026-10-05", totalAmount: 24_200_000, balance: 24_200_000, currency: "NGN", projectId: "p2", matchStatus: "unmatched", syncedAt: d(0, 7) },
];
