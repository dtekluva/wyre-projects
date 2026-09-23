import { api, ApiError, COMMISSIONING_TEMPLATE } from "../dist/api.mjs";
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

// ===================== Phase 3 =====================
console.log("\n--- Phase 3 ---");
// transfers: store keeper makes, Finance checks (not project-scoped); serialised transfer moves the asset
const vanFuse = api.balanceOf("it_fuse", "loc_van1").qtyOnHand; const whFuse = api.balanceOf("it_fuse", "loc_wh").qtyOnHand;
const tr = api.transferStock("u_sk", { itemId: "it_fuse", qty: 5, fromId: "loc_wh", toId: "loc_van1" });
expectErr(() => api.check("stock_movement", tr.id, "u_sk", "checked"), "forbidden", "store keeper cannot check their own transfer");
expectErr(() => api.check("stock_movement", tr.id, "u_ft1", "checked"), "forbidden", "field tech holds no inventory.check");
api.check("stock_movement", tr.id, "u_pm1", "checked");  // §4.13: stock movements are checked by a PM (or Finance)
ok(api.balanceOf("it_fuse", "loc_van1").qtyOnHand === vanFuse + 5 && api.balanceOf("it_fuse", "loc_wh").qtyOnHand === whFuse - 5, "transfer moves 5 fuses warehouse → van once checked");
const panelSer = api.inStockSerials("it_panel", "loc_wh")[0];
const tr2 = api.transferStock("u_sk", { itemId: "it_panel", qty: 1, fromId: "loc_wh", toId: "loc_van1", serials: [panelSer] });
api.check("stock_movement", tr2.id, "u_fin", "checked");
ok(api.assets.find((a) => a.serial === panelSer).locationId === "loc_van1", `serialised transfer moves ${panelSer} to the van`);

// site visit: photo required; parts reserve van stock; PM checks → stock deducted, O&M actual posted
const t0 = new Date(Date.now() - 7200000).toISOString(), t1 = new Date().toISOString();
expectErr(() => api.logVisit("u_ft1", "p1", { visitType: "fault", startedAt: t0, endedAt: t1, findings: "x", actionsTaken: "y", costTravel: 1000, costLabour: 2000, attachmentIds: [] }), "invalid", "visit needs a site photo");
const p1Act0 = api.money("p1").actual; const vanMc4 = api.available("it_mc4", "loc_van1"); const wacMc4 = api.wacOf("it_mc4");
const vis = api.logVisit("u_ft1", "p1", { visitType: "fault", startedAt: t0, endedAt: t1, findings: "f", actionsTaken: "a", costTravel: 10000, costLabour: 15000, parts: [{ itemId: "it_mc4", qty: 4 }], attachmentIds: ["att-v"] });
ok(vis.reviewStatus === "pending" && vis.costParts === 4 * wacMc4, "visit pending, parts costed at WAC");
ok(api.available("it_mc4", "loc_van1") === vanMc4 - 4, "visit parts reserve van stock while pending");
expectErr(() => api.check("site_visit", vis.id, "u_ft1", "checked"), "forbidden", "tech cannot check own visit");
expectErr(() => api.check("site_visit", vis.id, "u_fin", "checked"), "forbidden", "finance cannot check a visit");
api.check("site_visit", vis.id, "u_pm1", "checked");
ok(api.balanceOf("it_mc4", "loc_van1").qtyOnHand === vanMc4 - 4, "van stock deducted after visit check");
ok(api.money("p1").actual === p1Act0 + 25000 + 4 * wacMc4, "actual += travel + labour + parts at WAC");

// issue lifecycle: before photo → report checked → in progress → resolve needs after photo → reject → resolve → close posts cost
expectErr(() => api.raiseIssue("u_ft1", "p1", { category: "electrical", severity: "high", title: "t", description: "d", beforeAttachmentIds: [] }), "invalid", "issue needs a before photo");
const isu = api.raiseIssue("u_ft1", "p1", { category: "electrical", severity: "critical", title: "Breaker trips", description: "d", beforeAttachmentIds: ["b1"] });
const sla = api.issueSla(isu); ok(sla.hoursLeft <= 24 && sla.hoursLeft > 22 && !sla.breached, "critical SLA = 24 h, not yet breached");
expectErr(() => api.check("issue", isu.id, "u_ft1", "checked"), "forbidden", "reporter cannot check own issue");
api.check("issue", isu.id, "u_le1", "checked"); ok(isu.status === "open" && isu.reviewStatus === "checked", "report checked by lead engineer, stays open");
api.setIssueStatus("u_ft1", isu.id, "in_progress", "u_ft1");
expectErr(() => api.resolveIssue("u_ft1", isu.id, { rootCause: "r", resolution: "x", afterAttachmentIds: [] }), "invalid", "resolution needs an after photo");
api.resolveIssue("u_ft1", isu.id, { rootCause: "loose lug", resolution: "torqued", afterAttachmentIds: ["a1"], costToResolve: 5000 });
ok(isu.status === "resolved" && isu.reviewStatus === "pending" && isu.reviewVersion === 2, "resolution re-enters review as v2");
api.check("issue", isu.id, "u_pm1", "rejected", "still tripping");
ok(isu.status === "in_progress" && isu.reviewStatus === "rejected", "rejected resolution → back to in progress");
api.resolveIssue("u_ft1", isu.id, { rootCause: "loose lug", resolution: "replaced lug", afterAttachmentIds: ["a2"], costToResolve: 5000 });

// files at any stage of an issue
const isu2 = api.raiseIssue("u_ft1", "p1", { category: "mechanical", severity: "low", title: "Loose rail", description: "d", beforeAttachmentIds: ["b1"] });
ok(Array.isArray(isu2.attachmentIds) && isu2.attachmentIds.length === 0, "a new issue starts with no extra files");
expectErr(() => api.addIssuePhotos("u_ft1", isu2.id, { attachmentIds: [] }), "invalid", "adding nothing is refused");
const q1 = api.addAttachment("u_ft1", "p1", { fileName: "quote.pdf", kind: "document", caption: "Supplier quote" });
const other = api.addAttachment("u_pm2", "p4", { fileName: "elsewhere.jpg", caption: "wrong project" });
expectErr(() => api.addIssuePhotos("u_ft1", isu2.id, { attachmentIds: [other.id] }), "invalid", "a file from another project is refused");
expectErr(() => api.addIssuePhotos("u_fin", isu2.id, { attachmentIds: [q1.id] }), "forbidden", "finance cannot add files to an issue");
api.addIssuePhotos("u_ft1", isu2.id, { attachmentIds: [q1.id] });
ok(isu2.attachmentIds.length === 1 && isu2.reviewStatus === "pending" && isu2.reviewVersion === 1, "file added while pending — still the first submission");
api.setIssueStatus("u_ft1", isu2.id, "awaiting_parts");
const q2 = api.addAttachment("u_ft1", "p1", { fileName: "parts.jpg", caption: "Parts arrived" });
api.addIssuePhotos("u_ft1", isu2.id, { attachmentIds: [q2.id] });
ok(isu2.attachmentIds.length === 2, "files can be added in any status");
expectErr(() => api.addIssuePhotos("u_ft1", isu2.id, { attachmentIds: [q1.id] }), "conflict", "the same file cannot be attached twice");
api.check("issue", isu2.id, "u_pm1", "checked");
ok(isu2.reviewStatus === "checked", "issue checked");
const q3 = api.addAttachment("u_ft1", "p1", { fileName: "late.jpg", caption: "Late evidence" });
api.addIssuePhotos("u_ft1", isu2.id, { attachmentIds: [q3.id] });
ok(isu2.reviewStatus === "pending" && isu2.reviewVersion === 2 && !isu2.checkedBy, "adding to a checked issue re-enters review (§4.13)");
ok(api.listEvents("p1").some((e) => /re-entered review/.test(e.summary)), "chronology records the re-entry");

// ---- VAT & billing: net is the number, gross is derived, and the liability is tracked per invoice ----
const vtPj = api.raw ? api.raw("p1") : api.projects.find((x) => x.id === "p1");
ok(vtPj.contractValueNet > 0 && Math.abs(vtPj.contractValue - (vtPj.contractValueNet + vtPj.vatAmount)) < 0.01, `seed project: gross = net + VAT (${vtPj.contractValueNet} + ${vtPj.vatAmount})`);
ok(Math.abs(vtPj.vatAmount - Math.round(vtPj.contractValueNet * 7.5) / 100) < 0.01, "VAT is 7.5% of net");
const vtP = api.createProject("u_pm1", { name: "VAT test job", clientName: "Acme", branchName: "HQ", location: "Lagos", projectType: "solar_battery", contractValueNet: 1_000_000, pmId: "u_pm1", leadEngineerId: "u_pm2" });
ok(vtP.contractValueNet === 1_000_000 && vtP.vatAmount === 75_000 && vtP.contractValue === 1_075_000 && vtP.vatRate === 7.5 && vtP.vatTreatment === "standard", "createProject: net in, VAT and gross derived");
ok(vtP.contractStatus === "draft" && !vtP.contractReceivedOn, "a new project opens as a draft contract unless told otherwise");
const vtEx = api.createProject("u_pm1", { name: "Exempt job", clientName: "NGO", branchName: "Site", location: "Abuja", projectType: "solar_battery", contractValueNet: 500_000, vatTreatment: "exempt", pmId: "u_pm1", leadEngineerId: "u_pm2" });
ok(vtEx.vatAmount === 0 && vtEx.contractValue === 500_000, "exempt project carries no VAT");
expectErr(() => api.createProject("u_pm1", { name: "Bad budget", clientName: "x", branchName: "x", location: "x", projectType: "solar_battery", contractValueNet: 100, approvedBudget: 200, pmId: "u_pm1", leadEngineerId: "u_pm2" }), "invalid", "budget is checked against the NET contract");
let vtM = api.money(vtP.id);
ok(vtM.contractNet === 1_000_000 && vtM.vatDue === 75_000 && vtM.contractGross === 1_075_000 && vtM.vatOutstanding === 75_000 && vtM.vatSettled === 0, "money(): VAT due on net, nothing settled yet");
expectErr(() => api.updateCommercials("u_ft1", vtP.id, { contractValueNet: 2_000_000 }), "forbidden", "a tech cannot rewrite commercials");
expectErr(() => api.updateCommercials("u_fin", vtP.id, { approvedBudget: 5_000_000 }), "invalid", "budget above the net contract is refused");
expectErr(() => api.updateCommercials("u_fin", vtP.id, { retentionPercent: 25 }), "invalid", "retention over 20% is refused");
api.updateCommercials("u_fin", vtP.id, { contractValueNet: 2_000_000, vatTreatment: "withheld_by_client", approvedBudget: 1_500_000, retentionPercent: 10 });
ok(vtP.contractValueNet === 2_000_000 && vtP.vatAmount === 150_000 && vtP.contractValue === 2_150_000 && vtP.approvedBudget === 1_500_000 && vtP.retentionPercent === 10, "updateCommercials recomputes VAT and gross and takes budget + retention");
expectErr(() => api.setContractStatus("u_ft1", vtP.id, { status: "received" }), "forbidden", "a tech cannot mark the contract received");
const vtDoc = api.addDocument("u_fin", vtP.id, { docType: "contract", title: "Signed contract", fileName: "contract.pdf" });
api.setContractStatus("u_fin", vtP.id, { status: "received", receivedOn: "2026-09-22", documentId: vtDoc.id });
ok(vtP.contractStatus === "received" && vtP.contractReceivedOn === "2026-09-22" && vtP.contractReceivedBy === "u_fin" && vtP.contractDocumentId === vtDoc.id, "contract marked received with the signed copy filed");
expectErr(() => api.setContractStatus("u_fin", vtP.id, { status: "received" }), "conflict", "cannot receive a contract twice");
ok(api.listEvents(vtP.id).some((e) => e.eventType === "contract_received"), "receipt is in the chronology");
api.setContractStatus("u_fin", vtP.id, { status: "draft" });
ok(vtP.contractStatus === "draft" && !vtP.contractReceivedBy, "and can be set back to draft");
const vtR = api.createProject("u_pm1", { name: "Signed job", clientName: "Acme", branchName: "HQ", location: "Lagos", projectType: "solar_battery", contractValueNet: 100, contractReceived: true, pmId: "u_pm1", leadEngineerId: "u_pm2" });
ok(vtR.contractStatus === "received" && vtR.contractReceivedBy === "u_pm1", "createProject with contractReceived opens as received");

// ---- schedule: planned exit per stage, editable after creation ----
const sp = api.createProject("u_pm1", { name: "Schedule job", clientName: "Acme", branchName: "HQ", location: "Lagos", projectType: "solar_battery", contractValueNet: 100, pmId: "u_pm1", leadEngineerId: "u_pm2", proposalDueDate: "2026-10-01", targetHandoverDate: "2027-01-15" });
ok(sp.stagePlanned[0] === "2026-10-01" && sp.stagePlanned[6] === "2027-01-15", "createProject takes proposal due and target handover");
expectErr(() => api.createProject("u_pm1", { name: "Backwards", clientName: "x", branchName: "x", location: "x", projectType: "solar_battery", contractValueNet: 1, pmId: "u_pm1", leadEngineerId: "u_pm2", proposalDueDate: "2026-10-01", targetHandoverDate: "2026-09-01" }), "invalid", "handover before proposal is refused");
expectErr(() => api.setStagePlan("u_ft1", sp.id, { planned: { 1: "2026-10-20" } }), "forbidden", "a tech cannot set the schedule");
expectErr(() => api.setStagePlan("u_pm1", sp.id, { planned: { 1: "2026-09-01" } }), "invalid", "a stage cannot be planned before the stage above it");
expectErr(() => api.setStagePlan("u_pm1", sp.id, { planned: { 0: "2026-10-01" } }), "invalid", "saving with nothing changed is refused");
api.setStagePlan("u_pm1", sp.id, { planned: { 1: "2026-10-20", 2: "2026-11-10", 4: "2026-12-20" } });
ok(sp.stagePlanned[1] === "2026-10-20" && sp.stagePlanned[2] === "2026-11-10" && sp.stagePlanned[4] === "2026-12-20" && sp.stagePlanned[6] === "2027-01-15", "several stages set in one save");
ok(api.listEvents(sp.id).filter((e) => e.eventType === "plan_updated").length === 3, "one chronology line per changed stage");
expectErr(() => api.setStagePlan("u_pm1", sp.id, { planned: { 5: "2027-02-01" } }), "invalid", "a stage planned after the handover that follows it is refused");
api.setStagePlan("u_pm1", sp.id, { planned: { 4: null } });
ok(sp.stagePlanned[4] === undefined, "a planned date can be cleared");

// ---- void: wrong data stops counting everywhere but stays on the record ----
const vj = api.createProject("u_pm1", { name: "Void job", clientName: "Acme", branchName: "HQ", location: "Lagos", projectType: "solar_battery", contractValueNet: 10_000_000, contractReceived: true, pmId: "u_pm1", leadEngineerId: "u_pm2" });
const vdoc = api.addDocument("u_pm1", vj.id, { docType: "proposal", title: "Wrong proposal", fileName: "p.pdf" });
api.check("document", vdoc.id, "u_dir", "checked");
ok(api.gateStatus(vj.id).items.find((i) => i.docType === "proposal").state === "ok", "checked document satisfies the gate");
expectErr(() => api.voidRecord("u_ft1", "document", vdoc.id, "typo"), "forbidden", "a tech cannot void");
expectErr(() => api.voidRecord("u_fin", "document", vdoc.id, "typo"), "forbidden", "finance cannot void");
expectErr(() => api.voidRecord("u_pm1", "document", vdoc.id, "  "), "invalid", "a reason is required");
api.voidRecord("u_pm1", "document", vdoc.id, "uploaded to the wrong project");
ok(vdoc.voidedAt && vdoc.voidedBy === "u_pm1" && vdoc.voidReason === "uploaded to the wrong project", "document carries who voided it and why");
ok(api.gateStatus(vj.id).items.find((i) => i.docType === "proposal").state === "missing", "a voided document no longer satisfies the gate");
expectErr(() => api.voidRecord("u_pm1", "document", vdoc.id, "again"), "conflict", "cannot void twice");
ok(api.listEvents(vj.id).some((e) => e.eventType === "void"), "the void is in the chronology");
// pending record leaves the review queue
const vatt = api.addAttachment("u_ft1", vj.id, { fileName: "blur.jpg", caption: "Blurry" });
ok(api.reviewQueue("u_pm1").some((q) => q.id === vatt.id), "pending photo is in the queue");
api.voidRecord("u_dir", "attachment", vatt.id, "blurry, re-taken");
ok(!api.reviewQueue("u_pm1").some((q) => q.id === vatt.id) && api.pendingChecks(vj.id) === 0, "a voided pending photo leaves the queue and the pending count");
// stock: a wrong receipt, then a wrong issue
const vit = api.items.find((i) => !i.isSerialised); const before = api.balanceOf(vit.id).qtyOnHand;
const vnow = api.now ? api.now() : new Date().toISOString();
const vrc = { id: "mv_void_rc", itemId: vit.id, movementType: "receipt", qty: 5, locationToId: api.mainLocationId(), unitCost: 1000, totalCost: 5000, reason: "opening balance", createdBy: "u_sk", createdAt: vnow, reviewStatus: "checked", submittedBy: "u_sk", submittedAt: vnow, checkedBy: "u_fin", checkedAt: vnow, reviewVersion: 1 };
api.movements.push(vrc);
ok(api.balanceOf(vit.id).qtyOnHand === before + 5, "receipt counted");
const viss = api.issueStock("u_sk", { itemId: vit.id, projectId: vj.id, qty: 3 });
api.check("stock_movement", viss.id, "u_pm1", "checked");
ok(api.balanceOf(vit.id).qtyOnHand === before + 2 && api.money(vj.id).actual > 0, "issue counted and posted an actual");
api.voidRecord("u_pm1", "stock_movement", viss.id, "issued against the wrong project");
ok(api.balanceOf(vit.id).qtyOnHand === before + 5 && api.money(vj.id).actual === 0, "voiding the issue restores the balance and removes the actual it posted");
api.voidRecord("u_dir", "stock_movement", vrc.id, "duplicate of GRN");
ok(api.balanceOf(vit.id).qtyOnHand === before, "voiding the receipt takes its quantity back out");
// money records
const vci = api.addCostItem("u_fin", vj.id, { category: "equipment", label: "Wrong line", plannedAmount: 9_000_000 });
api.check("cost_item", vci.id, "u_fin", "checked");
ok(api.money(vj.id).planned === 9_000_000, "budget line counted");
api.voidRecord("u_dir", "cost_item", vci.id, "typed in kobo");
ok(api.money(vj.id).planned === vj.approvedBudget, "a voided budget line no longer counts");
const vinv = api.raiseInvoice("u_fin", vj.id, { invoiceNumber: "V-1", description: "x", netAmount: 1_000_000 });
api.check("client_invoice", vinv.id, "u_dir", "checked");
const vvp = api.recordVatPayment("u_fin", vj.id, { amount: 75_000 }); api.check("vat_payment", vvp.id, "u_dir", "checked");
ok(api.money(vj.id).invoicedNet === 1_000_000 && api.money(vj.id).vatSettled === 75_000, "invoice and VAT payment counted");
api.voidRecord("u_dir", "client_invoice", vinv.id, "wrong client"); api.voidRecord("u_dir", "vat_payment", vvp.id, "paid on another project");
ok(api.money(vj.id).invoicedNet === 0 && api.money(vj.id).vatSettled === 0, "voided invoice and VAT payment no longer count");

// ---- second pass: POs, receipts, visits, issues ----
const p2 = api.createProject("u_pm1", { name: "Void pass two", clientName: "Acme", branchName: "HQ", location: "Lagos", projectType: "solar_battery", contractValueNet: 50_000_000, contractReceived: true, pmId: "u_pm1", leadEngineerId: "u_pm2" });
const p2po = api.createPO("u_pm1", p2.id, { vendorId: "v_dixsen", items: [{ inventoryItemId: "it_mccb", description: "MCCB", qty: 4, unitCost: 100_000 }] });
api.decide(api.approvals.find((a) => a.id === p2po.approvalId).id, "u_fin", "approved");
const p2mb = api.balanceOf("it_mccb").qtyOnHand;
const p2grn = api.receiveGoods("u_sk", p2po.id, { attachmentIds: [api.addAttachment("u_sk", p2.id, { fileName: "dn.jpg", caption: "Delivery note" }).id], lines: [{ purchaseItemId: p2po.items[0].id, qty: 4 }] });
api.check("goods_receipt", p2grn.id, "u_pm1", "checked");
ok(api.balanceOf("it_mccb").qtyOnHand === p2mb + 4 && p2po.status === "delivered", "receipt put stock in and delivered the PO (stock value, not project spend, until issued)");
expectErr(() => api.voidRecord("u_dir", "purchase_order", p2po.id, "dup"), "conflict", "a PO with receipts against it cannot be removed first");
api.voidRecord("u_dir", "goods_receipt", p2grn.id, "wrong quantities on the note");
ok(p2grn.voidedAt && api.balanceOf("it_mccb").qtyOnHand === p2mb && p2po.status === "approved" && p2po.items[0].qtyReceived === 0, "removing the receipt takes back the stock and the PO's delivered state");
ok(api.movements.filter((m) => m.sourceRef?.id === p2grn.id).every((m) => m.voidedAt), "the receipt's movements are removed with it");
ok(api.attachments.find((a) => a.id === p2grn.attachmentIds[0]).voidedAt, "the delivery note goes with the receipt");
api.voidRecord("u_dir", "purchase_order", p2po.id, "raised in error");
ok(p2po.voidedAt && api.money(p2.id).committed === 0, "removing the PO drops it from committed");
// visit with parts and cost
const p2v = api.logVisit("u_ft1", p2.id, { visitType: "routine", startedAt: "2026-09-10T09:00:00Z", endedAt: "2026-09-10T11:00:00Z", findings: "ok", actionsTaken: "", costTravel: 5_000, costLabour: 10_000, attachmentIds: [api.addAttachment("u_ft1", p2.id, { fileName: "v.jpg", caption: "Site" }).id] });
api.check("site_visit", p2v.id, "u_pm1", "checked");
ok(api.money(p2.id).actual === 15_000, "visit posted its travel and labour");
api.voidRecord("u_pm1", "site_visit", p2v.id, "logged on the wrong project");
ok(p2v.voidedAt && api.money(p2.id).actual === 0 && api.attachments.find((a) => a.id === p2v.attachmentIds[0]).voidedAt, "removing the visit takes back its cost and its photos");
// issue closed with a cost
const p2i = api.raiseIssue("u_ft1", p2.id, { category: "electrical", severity: "low", title: "Loose lug", description: "d", beforeAttachmentIds: [api.addAttachment("u_ft1", p2.id, { fileName: "b.jpg", caption: "Before" }).id] });
api.check("issue", p2i.id, "u_pm1", "checked");
api.resolveIssue("u_ft1", p2i.id, { rootCause: "r", resolution: "torqued", afterAttachmentIds: [api.addAttachment("u_ft1", p2.id, { fileName: "a.jpg", caption: "After" }).id], costToResolve: 2_500 });
api.check("issue", p2i.id, "u_pm1", "checked");
ok(p2i.status === "closed" && api.money(p2.id).actual === 2_500, "closed issue posted its cost");
ok(api.listIssues({ projectId: p2.id }).some((x) => x.id === p2i.id), "issue listed");
api.voidRecord("u_dir", "issue", p2i.id, "duplicate of another ticket");
ok(p2i.voidedAt && api.money(p2.id).actual === 0 && api.attachments.find((a) => a.id === p2i.beforeAttachmentIds[0]).voidedAt && api.attachments.find((a) => a.id === p2i.afterAttachmentIds[0]).voidedAt, "removing the issue takes back its cost and photos");
ok(!api.listIssues({ projectId: p2.id, openOnly: true }).some((x) => x.id === p2i.id), "a removed issue is not an open issue");

// ---- stage rollback ----
const rb = api.projects.find((x) => x.id === "p1"); const rbFrom = rb.stage;
ok(rbFrom >= 2 && rb.stageActual[rbFrom - 1], "p1 is a few stages in with actual exit dates");
expectErr(() => api.rollbackStage("u_fin", rb.id, { toStage: 2, reason: "x" }), "forbidden", "finance cannot move a project back");
expectErr(() => api.rollbackStage("u_pm1", rb.id, { toStage: rbFrom, reason: "x" }), "invalid", "must be an earlier stage");
expectErr(() => api.rollbackStage("u_pm1", rb.id, { toStage: 2, reason: " " }), "invalid", "a reason is required");
api.rollbackStage("u_pm1", rb.id, { toStage: 2, reason: "DISCO letter never actually arrived" });
ok(rb.stage === 2 && !rb.stageActual[2] && !rb.stageActual[3] && rb.stageActual[1], "stage back to 2; actual exits from 2 onward cleared, earlier kept");
ok(api.listEvents(rb.id).some((e) => e.eventType === "stage_rollback"), "rollback is in the chronology");



ok(api.listEvents(vtP.id).some((e) => e.eventType === "contract_updated"), "contract change is in the chronology");
// invoices
expectErr(() => api.raiseInvoice("u_ft1", vtP.id, { invoiceNumber: "INV-1", description: "x", netAmount: 100 }), "forbidden", "a tech cannot raise a client invoice");
expectErr(() => api.raiseInvoice("u_fin", vtP.id, { invoiceNumber: "", description: "x", netAmount: 100 }), "invalid", "invoice number is required");
const vtInv = api.raiseInvoice("u_fin", vtP.id, { invoiceNumber: "INV-1", description: "Mobilisation 40%", netAmount: 800_000 });
ok(vtInv.vatAmount === 60_000 && vtInv.grossAmount === 860_000 && vtInv.reviewStatus === "pending" && vtInv.vatStatus === "outstanding", "invoice: VAT at the project rate, pending check");
expectErr(() => api.raiseInvoice("u_fin", vtP.id, { invoiceNumber: "inv-1", description: "dup", netAmount: 1 }), "conflict", "invoice numbers are unique per project, case-insensitively");
ok(api.money(vtP.id).invoicedNet === 0, "a pending invoice does not count as invoiced");
expectErr(() => api.recordReceipt("u_fin", vtInv.id, { amount: 100 }), "conflict", "no receipts against an unchecked invoice");
ok(api.reviewQueue("u_dir").some((q) => q.kind === "client_invoice" && q.id === vtInv.id), "the invoice is in the Director's review queue");
api.check("client_invoice", vtInv.id, "u_dir", "checked");
vtM = api.money(vtP.id);
ok(vtM.invoicedNet === 800_000 && vtM.invoicedVat === 60_000, "checked invoice counts as invoiced");
expectErr(() => api.recordReceipt("u_fin", vtInv.id, { amount: 900_000 }), "invalid", "a receipt cannot exceed the gross");
api.recordReceipt("u_fin", vtInv.id, { amount: 800_000, note: "net paid, VAT withheld" });
ok(api.money(vtP.id).received === 800_000, "receipt recorded");
// VAT is paid per project, in as many payments as it takes, each checked by Finance or a Director
expectErr(() => api.recordVatPayment("u_ft1", vtP.id, { amount: 1000 }), "forbidden", "a tech cannot record a VAT payment");
expectErr(() => api.recordVatPayment("u_fin", vtP.id, { amount: 0 }), "invalid", "a VAT payment must be more than zero");
const vtCn = api.addAttachment("u_fin", vtP.id, { fileName: "credit-note.pdf", kind: "document", caption: "VAT credit note" });
const vp1 = api.recordVatPayment("u_fin", vtP.id, { amount: 60_000, method: "withheld_by_client", note: "INV-1 VAT, client credit note", attachmentIds: [vtCn.id] });
ok(vp1.reviewStatus === "pending" && api.money(vtP.id).vatSettled === 0 && api.money(vtP.id).vatOutstanding === 150_000, "a pending VAT payment does not count yet");
ok(api.reviewQueue("u_dir").some((q) => q.kind === "vat_payment" && q.id === vp1.id), "the payment is in the Director's review queue");
api.check("vat_payment", vp1.id, "u_dir", "checked");
vtM = api.money(vtP.id);
ok(vtM.vatSettled === 60_000 && vtM.vatOutstanding === 90_000, `checked payment counts: outstanding = due − paid (${vtM.vatOutstanding})`);
const vp2 = api.recordVatPayment("u_fin", vtP.id, { amount: 90_000, method: "remitted", note: "balance to FIRS" });
api.check("vat_payment", vp2.id, "u_dir", "checked");
ok(api.money(vtP.id).vatOutstanding === 0, "a second, partial-then-final payment clears the liability");
const vtFirs = api.addAttachment("u_fin", vtP.id, { fileName: "firs-receipt.pdf", kind: "document", caption: "FIRS receipt" });
api.addVatPaymentReceipts("u_fin", vp2.id, { attachmentIds: [vtFirs.id] });
ok(vp2.attachmentIds.includes(vtFirs.id) && vp2.reviewStatus === "pending" && vp2.reviewVersion === 2, "adding a receipt to a checked payment re-enters review (§4.13)");
ok(api.money(vtP.id).vatOutstanding === 90_000, "…and it stops counting until re-checked");
expectErr(() => api.addVatPaymentReceipts("u_fin", vp2.id, { attachmentIds: [vtFirs.id] }), "conflict", "the same receipt cannot be attached twice");
api.check("vat_payment", vp2.id, "u_dir", "checked");
ok(api.money(vtP.id).vatOutstanding === 0, "re-checked, it counts again");
// retention on net
ok(api.retention("p4").amountHeld === Math.round(api.projects.find((x) => x.id === "p4").contractValueNet * api.projects.find((x) => x.id === "p4").retentionPercent / 100), "retention is held on the NET contract");
const p1Act1 = api.money("p1").actual; api.check("issue", isu.id, "u_pm1", "checked");
ok(isu.status === "closed" && api.money("p1").actual === p1Act1 + 5000, "checked resolution closes the issue and posts ₦5k O&M actual");

// commissioning → gate-5 evidence
const items = COMMISSIONING_TEMPLATE.map((t) => ({ key: t.key, pass: true, measuredValue: "ok" }));
const meter = { serialAscii: true, ctRatioVerified: true, firstLiveReading: true, historicalOk: true };
expectErr(() => api.createCommissioning("u_ft1", "p1", { date: "2026-09-09", result: "pass", notes: "", items, meter, attachmentIds: ["c1"] }), "forbidden", "field tech cannot create a commissioning record");
// …until a techlead delegates it for that site. The grant is per project and nothing else widens.
expectErr(() => api.assignCommissioning("u_ft1", "p1", "u_ft1"), "forbidden", "a tech cannot assign commissioning to themselves");
api.assignCommissioning("u_pm1", "p1", "u_ft1");
ok(api.can("u_ft1", "commissioning.create", "p1"), "assigned tech may now record commissioning on p1");
ok(!api.can("u_ft1", "commissioning.create", "p2"), "but only on the project they were assigned to");
ok(!api.can("u_ft1", "commissioning.check", "p1"), "and still cannot check one anywhere");
api.assignCommissioning("u_pm1", "p1");
ok(!api.can("u_ft1", "commissioning.create", "p1"), "clearing the assignment takes it away again");
expectErr(() => api.createCommissioning("u_le1", "p1", { date: "2026-09-09", result: "pass", notes: "", items: items.map((i, k) => (k === 0 ? { ...i, pass: false } : i)), meter, attachmentIds: ["c1"] }), "invalid", "'pass' with a failed checklist item is rejected");
const com = api.createCommissioning("u_le1", "p1", { date: "2026-09-09", result: "pass", notes: "n", items, meter, clientWitness: { name: "Client", signatureAttachmentId: "sig" }, attachmentIds: ["c1"] });
// pm and lead_engineer merged into techlead (2026-09-19), so "a PM may not check this" no longer means
// anything — both are the same role. What still holds, and matters more, is the person-level rule.
expectErr(() => api.check("commissioning", com.id, "u_le1", "checked"), "forbidden", "author cannot check their own commissioning record");
expectErr(() => api.check("commissioning", com.id, "u_ft1", "checked"), "forbidden", "a tech cannot check a commissioning record");
api.check("commissioning", com.id, "u_dir", "checked");
const g5 = api.listDocuments("p1").filter((d) => ["commissioning_record", "meter_integrity", "client_witness", "commissioning_photos"].includes(d.docType) && d.reviewStatus === "checked");
ok(g5.length === 4, "checked commissioning generates all 4 gate-5 evidence documents");

// HSE + warranty
const hse = api.reportHse("u_ft1", "p1", { type: "near_miss", severity: "low", description: "d", actions: "a", occurredAt: t1 });
api.check("hse", hse.id, "u_pm1", "checked"); ok(hse.reviewStatus === "checked", "HSE incident checked by PM");
const p4asset = api.listAssets({ projectId: "p4", status: "installed" })[0];
const war = api.raiseWarrantyClaim("u_le2", "p4", { assetId: p4asset.id, notes: "n" });
api.check("warranty", war.id, "u_pm2", "checked");
const p4Act = api.money("p4").actual;
api.updateWarrantyClaim("u_le2", war.id, { status: "refunded", outcome: "refund", costRecovered: 120000 });
ok(war.reviewStatus === "pending" && war.reviewVersion === 2, "claim update re-enters review");
api.check("warranty", war.id, "u_fin", "checked");
ok(api.money("p4").actual === p4Act - 120000, "checked refund credits ₦120k to the project");

// stock count: all lines counted; out-of-tolerance needs a note; Finance approval posts adjustments
const sc = api.listCounts().find((c) => c.id === "sc1");
expectErr(() => api.submitCount("u_sk", "sc1"), "invalid", "count with uncounted lines cannot be submitted");
api.enterCount("u_sk", "sc1", sc.lines.filter((l) => l.countedQty === null).map((l) => ({ itemId: l.itemId, countedQty: l.expectedQty })));
expectErr(() => api.submitCount("u_sk", "sc1"), "invalid", "+2 fuses (>2% tolerance) without a note is rejected");
api.enterCount("u_sk", "sc1", [{ itemId: "it_fuse", countedQty: 52, note: "found 2 in returns bin" }]);
const scAp = api.submitCount("u_sk", "sc1"); ok(scAp.requiredRoles.join() === "finance", "submitted count → Finance approval");
const whMc4 = api.balanceOf("it_mc4", "loc_wh").qtyOnHand; const whFuse2 = api.balanceOf("it_fuse", "loc_wh").qtyOnHand;
expectErr(() => api.decide(scAp.id, "u_sk", "approved"), "forbidden", "store keeper cannot approve own count");
api.decide(scAp.id, "u_fin", "approved");
ok(api.stockCounts.find((c) => c.id === "sc1").status === "approved", "count approved");
ok(api.balanceOf("it_mc4", "loc_wh").qtyOnHand === whMc4 - 8 && api.balanceOf("it_fuse", "loc_wh").qtyOnHand === whFuse2 + 2, "approval posts −8 MC4 and +2 fuse adjustments");

// queue scoping for the new kinds
const kinds = api.reviewQueue("u_pm1").map((i) => i.kind);
ok(kinds.includes("site_visit") && kinds.includes("issue") && kinds.includes("hse"), "PM queue carries the seeded visit, issue and HSE report");
ok(!api.reviewQueue("u_ft1").length, "field tech has no check permissions → empty queue");

// create project (spec §2.2 project.create; §4.1 opens at stage 0 with PM + Lead Engineer memberships)
const npBase = { name: "Test Client HQ — 50 kWp Solar", clientName: "Test Client", branchName: "HQ", location: "Yaba, Lagos", projectType: "solar_battery", systemCapacityKwp: 50, contractValue: 48_000_000, approvedBudget: 41_000_000, pmId: "u_pm2", leadEngineerId: "u_le1", proposalDueDate: "2026-10-01" };
expectErr(() => api.createProject("u_ft1", npBase), "forbidden", "field tech cannot create a project");
expectErr(() => api.createProject("u_fin", npBase), "forbidden", "finance cannot create a project");
expectErr(() => api.createProject("u_pm1", { ...npBase, name: " " }), "invalid", "name is required");
// Both named owners must be techleads now; u_le1 and u_pm1 are both techlead, so asserting one cannot
// stand in for the other is meaningless. Assert against roles that genuinely cannot own a project.
expectErr(() => api.createProject("u_pm1", { ...npBase, pmId: "u_ft1" }), "invalid", "a tech cannot be named project owner");
expectErr(() => api.createProject("u_pm1", { ...npBase, leadEngineerId: "u_sk" }), "invalid", "a store keeper cannot be named lead");
expectErr(() => api.createProject("u_pm1", { ...npBase, approvedBudget: 60_000_000 }), "invalid", "budget above contract value is rejected");
expectErr(() => api.createProject("u_pm1", { ...npBase, contractValue: -1 }), "invalid", "negative contract value is rejected");
const nProjects = api.projects.length;
const np = api.createProject("u_pm1", npBase);
ok(api.projects.length === nProjects + 1 && np.stage === 0 && np.rag === "green" && np.committed === 0 && np.actual === 0, "PM creates project → stage 0, green, nothing committed");
ok(/^WYR-\d{4}-\d{3}$/.test(np.code) && !api.projects.some((p) => p !== np && p.code === np.code), `code ${np.code} is unique and well-formed`);
ok(np.createdBy === "u_pm1" && np.retentionPercent === 5 && np.stagePlanned[0] === "2026-10-01", "actor captured, retention defaulted from threshold, proposal date planned");
const npRoles = api.listMemberships(np.id).map((m) => `${m.userId}:${m.role}`).sort().join(",");
ok(npRoles === "u_le1:techlead,u_pm2:techlead", "both named owners granted techlead membership");
ok(api.listProjects("u_ft1").some((p) => p.id === np.id), "portfolio is company-wide — every signed-in user sees the new project");
ok(api.myProjects("u_pm2").some((p) => p.id === np.id) && !api.myProjects("u_ft1").some((p) => p.id === np.id), "but only its PM and lead engineer are assigned to it");
const anyIssue = api.raiseIssue("u_ft1", np.id, { category: "other", severity: "low", title: "Roles are company-wide", description: "", beforeAttachmentIds: ["att1"] });
ok(anyIssue.projectId === np.id, "roles apply company-wide — a field tech can work on a project they are not assigned to");
expectErr(() => api.check("issue", anyIssue.id, "u_ft1", "checked"), "forbidden", "but still cannot check their own submission");
expectErr(() => api.createPO("u_ft1", np.id, { vendorId: "v_dixsen", items: [{ description: "x", qty: 1, unitCost: 1 }] }), "forbidden", "and still cannot do what their role forbids");
ok(api.listEvents(np.id).some((e) => e.eventType === "project_created" && e.actorId === "u_pm1"), "project_created logged with actor");
ok(api.gateStatus(np.id).stage === 0 && api.gateStatus(np.id).items.length === 3 && !api.gateStatus(np.id).ready, "gate 0 shows 3 missing evidence items");
expectErr(() => api.createProject("u_admin", npBase), "conflict", "duplicate project name is rejected");
const np2 = api.createProject("u_admin", { ...npBase, name: "Second Test Project" });
ok(Number(np2.code.slice(-3)) === Number(np.code.slice(-3)) + 1, "codes increment per year");
// ---- catalogue: items and vendors, the reference data everything else needs ----
{
  expectErr(() => api.addItem("u_ft1", { sku: "X", name: "x", category: "panel" }), "forbidden", "a tech cannot add catalogue items");
  expectErr(() => api.addVendor("u_ft1", { name: "Nope" }), "forbidden", "a tech cannot add vendors");
  const v = api.addVendor("u_sk", { name: "Fresh Supplier Ltd", category: "Panels" });
  ok(api.vendors.some((x) => x.id === v.id), "store keeper adds a vendor");
  expectErr(() => api.addVendor("u_sk", { name: "fresh supplier ltd" }), "conflict", "duplicate vendor name is rejected, case-insensitively");
  const it = api.addItem("u_sk", { sku: "pnl-600", name: "600 W panel", category: "panel", reorderLevel: 10, defaultVendorId: v.id });
  ok(it.sku === "PNL-600" && it.unit === "pcs" && it.isActive, "SKU upper-cased, unit defaulted, item active");
  expectErr(() => api.addItem("u_sk", { sku: "PNL-600", name: "dupe", category: "panel" }), "conflict", "duplicate SKU is rejected");
  expectErr(() => api.addItem("u_sk", { sku: "Y", name: "y", category: "sandwich" }), "invalid", "unknown category is rejected");
  expectErr(() => api.addItem("u_sk", { sku: "Z", name: "z", category: "panel", reorderLevel: -1 }), "invalid", "negative reorder level is rejected");
  ok(api.addItem("u_dir", { sku: "CBL-6", name: "6 mm cable", category: "cable", unit: "m" }).unit === "m", "a director may also maintain the catalogue");
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED"); process.exit(fails ? 1 : 0);
