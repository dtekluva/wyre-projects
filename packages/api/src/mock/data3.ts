// Phase 3 seed — field & quality: vehicle location, transfers, visits, issues, commissioning, HSE, warranty, stock count.
import type { StockLocation, StockMovement, Attachment, SiteVisit, Issue, CommissioningRecord, HseIncident, WarrantyClaim, StockCount, ReviewStatus } from "../types";
import { type ClientInvoice, type AuditFields, type ReviewFields, COMMISSIONING_TEMPLATE } from "../types";
import { NOW } from "./data";
import { assets as assets2 } from "./data2";

const d = (daysAgo: number, hh = 10) => { const t = new Date(NOW); t.setDate(t.getDate() - daysAgo); t.setHours(hh, 0, 0, 0); return t.toISOString(); };
const hrs = (iso: string, h: number) => new Date(new Date(iso).getTime() + h * 3600000).toISOString();
const audit = (by: string, at: string) => ({ createdAt: at, createdBy: by, updatedAt: at, updatedBy: by });
const review = (by: string, at: string, rs: ReviewStatus = "checked", checkedBy = "u_pm2", version = 1) =>
  ({ reviewStatus: rs, submittedBy: by, submittedAt: at, reviewVersion: version, checkedBy: rs === "pending" ? undefined : checkedBy, checkedAt: rs === "pending" ? undefined : hrs(at, 20) });
const sha = () => Array.from({ length: 64 }, (_, i) => "0123456789abcdef"[(i * 7 + 3) % 16]).join("");

export const locations: StockLocation[] = [
  { id: "loc_van1", name: "Van 1 — Segun Alabi", type: "vehicle", custodianId: "u_ft1", isActive: true },
];

let aid = 300;
export const attachments: Attachment[] = [];
const att = (p: string, name: string, by: string, daysAgo: number, caption: string, opts: { rs?: ReviewStatus; checkedBy?: string; gps?: { lat: number; lng: number }; link?: Attachment["linkedTo"] } = {}) => {
  const a: Attachment = { id: `att${++aid}`, projectId: p, fileName: name, mime: "image/jpeg", sizeBytes: 1_300_000, kind: "image", capturedAt: d(daysAgo, 11), gps: opts.gps, sha256: sha(),
    uploadedBy: by, uploadedAt: d(daysAgo, 11), linkedTo: opts.link, caption, ...review(by, d(daysAgo, 11), opts.rs ?? "checked", opts.checkedBy ?? "u_pm2") };
  attachments.push(a); return a.id;
};

// ---------------- transfers to Van 1 (checked by Finance — not project-scoped) ----------------
let mid = 900;
export const movements: StockMovement[] = [];
const MV = (m: Omit<StockMovement, "id" | "totalCost" | "reviewStatus" | "submittedBy" | "submittedAt" | "reviewVersion" | "checkedBy" | "checkedAt"> & { rs?: ReviewStatus; checkedBy?: string }) => {
  const { rs, checkedBy, ...rest } = m;
  const row: StockMovement = { ...rest, id: `mv${++mid}`, totalCost: rest.qty * rest.unitCost, ...review(rest.createdBy, rest.createdAt, rs ?? "checked", checkedBy ?? "u_fin") };
  movements.push(row); return row;
};
const vanPanels = Array.from({ length: 12 }, (_, i) => `JKM26-${String(301 + i).padStart(4, "0")}`);
MV({ itemId: "it_panel", movementType: "transfer", qty: 12, locationFromId: "loc_wh", locationToId: "loc_van1", unitCost: 150_000, serials: vanPanels, createdBy: "u_sk", createdAt: d(20, 8), sourceRef: { model: "Transfer", id: "tr-1", label: "Van stock for Sango snag work" } });
vanPanels.forEach((s) => { const a = assets2.find((x) => x.serial === s); if (a) a.locationId = "loc_van1"; });
MV({ itemId: "it_cable", movementType: "transfer", qty: 200, locationFromId: "loc_wh", locationToId: "loc_van1", unitCost: 1_200, createdBy: "u_sk", createdAt: d(20, 8), sourceRef: { model: "Transfer", id: "tr-2", label: "Van consumables" } });
MV({ itemId: "it_mc4", movementType: "transfer", qty: 40, locationFromId: "loc_wh", locationToId: "loc_van1", unitCost: 1_500, createdBy: "u_sk", createdAt: d(20, 8), sourceRef: { model: "Transfer", id: "tr-2", label: "Van consumables" } });
MV({ itemId: "it_fuse", movementType: "transfer", qty: 10, locationFromId: "loc_wh", locationToId: "loc_van1", unitCost: 8_000, createdBy: "u_sk", createdAt: d(20, 8), sourceRef: { model: "Transfer", id: "tr-2", label: "Van consumables" } });

// ---------------- site visits ----------------
export const visits: SiteVisit[] = [];
const V = (id: string, projectId: string, by: string, daysAgo: number, v: Partial<SiteVisit> & Pick<SiteVisit, "visitType" | "findings" | "actionsTaken" | "costTravel" | "costLabour">, rs: ReviewStatus = "checked", checkedBy = "u_pm2"): SiteVisit => {
  const start = d(daysAgo, 9); const end = hrs(start, v.durationHrs ?? 3);
  const parts = v.parts ?? []; const costParts = parts.reduce((s, p) => s + p.qty * (movements.find((m) => m.id === p.movementId)?.unitCost ?? 0), 0);
  const row: SiteVisit = { id, projectId, visitType: v.visitType, startedAt: start, endedAt: end, technicianIds: v.technicianIds ?? [by], durationHrs: v.durationHrs ?? 3, findings: v.findings, actionsTaken: v.actionsTaken,
    costTravel: v.costTravel, costLabour: v.costLabour, costParts, costTotal: v.costTravel + v.costLabour + costParts, parts, locationId: "loc_van1", attachmentIds: v.attachmentIds ?? [], issueIds: v.issueIds ?? [],
    clientSignoff: v.clientSignoff, gps: v.gps, ...audit(by, start), ...review(by, end, rs, checkedBy) };
  visits.push(row); return row;
};
// p4 Durosinmi — fault call-out 20 days ago (checked by PM Bola)
const mc4Visit = MV({ itemId: "it_mc4", movementType: "issue", qty: 2, locationFromId: "loc_van1", unitCost: 1_500, projectId: "p4", createdBy: "u_ft1", createdAt: d(20, 12), sourceRef: { model: "SiteVisit", id: "vis1", label: "Parts used on visit" }, checkedBy: "u_pm2" });
V("vis1", "p4", "u_ft1", 20, { visitType: "fault", durationHrs: 3.5, findings: "Inverter fault F23 — battery CAN comms lost. Loose plug at BMS side, connector corroded.", actionsTaken: "Re-seated and secured CAN plug, replaced 2 MC4 pairs on string 1, updated inverter firmware to 1.4.2, verified SoC reporting.",
  costTravel: 25_000, costLabour: 40_000, parts: [{ movementId: mc4Visit.id, itemId: "it_mc4", qty: 2 }], issueIds: ["iss2"],
  attachmentIds: [att("p4", "de-visit-bms-plug-before.jpg", "u_ft1", 20, "BMS CAN plug corroded (before)"), att("p4", "de-visit-bms-plug-after.jpg", "u_ft1", 20, "Plug replaced and secured (after)")],
  clientSignoff: { name: "Mr Durosinmi Etti", signatureAttachmentId: att("p4", "de-visit-signoff.png", "u_ft1", 20, "Client sign-on-glass"), rating: 5 }, gps: { lat: 6.6018, lng: 3.3515 } });
// p6 Access Ayobo — routine 90 days ago
V("vis2", "p6", "u_ft1", 90, { visitType: "routine", durationHrs: 2, findings: "AWT200 25062405300051 offline since 03:00; gateway had lost SIM registration. CT nameplate confirmed 1200/5 (×240).", actionsTaken: "Power-cycled gateway, re-registered SIM, verified live readings on platform for both meters.",
  costTravel: 18_000, costLabour: 30_000, attachmentIds: [att("p6", "ayobo-gateway-status.jpg", "u_ft1", 90, "Gateway online after reset")], gps: { lat: 6.6531, lng: 3.2486 } });
// p1 Sango — inspection 2 days ago, PENDING (in Kunle's queue); parts from van pending too
const fuseVisit = MV({ itemId: "it_fuse", movementType: "issue", qty: 1, locationFromId: "loc_van1", unitCost: 8_000, projectId: "p1", createdBy: "u_ft1", createdAt: d(2, 12), sourceRef: { model: "SiteVisit", id: "vis3", label: "Parts used on visit" }, rs: "pending" });
V("vis3", "p1", "u_ft1", 2, { visitType: "inspection", durationHrs: 2.5, findings: "String 3 DC fuse blown during first energisation; 3 cracked panels still on roof edge pending replacement.", actionsTaken: "Replaced fuse, isolated cracked panels, tagged string 3 out of service until replacement stock arrives.",
  costTravel: 12_000, costLabour: 20_000, parts: [{ movementId: fuseVisit.id, itemId: "it_fuse", qty: 1 }], issueIds: ["iss3"],
  attachmentIds: [att("p1", "sango-string3-fuse.jpg", "u_ft1", 2, "Blown DC fuse, string 3", { rs: "pending" })], gps: { lat: 6.687, lng: 3.235 } }, "pending");

// ---------------- issues ----------------
const slaH = { critical: 24, high: 72, medium: 168, low: 720 } as const;
export const issues: Issue[] = [];
const I = (id: string, projectId: string, by: string, daysAgo: number, i: Partial<Issue> & Pick<Issue, "category" | "severity" | "title" | "description">, rs: ReviewStatus = "checked", checkedBy = "u_pm2", version = 1): Issue => {
  const at = d(daysAgo, 10);
  const row: Issue = { id, projectId, category: i.category, severity: i.severity, title: i.title, description: i.description, raisedBy: by, raisedAt: at, source: i.source ?? "manual",
    status: i.status ?? "open", assigneeId: i.assigneeId, rootCause: i.rootCause, resolution: i.resolution, resolvedBy: i.resolvedBy, resolvedAt: i.resolvedAt, costToResolve: i.costToResolve ?? 0,
    linkedVisitId: i.linkedVisitId, warrantyClaimId: i.warrantyClaimId, assetId: i.assetId, attachmentIds: i.attachmentIds ?? [], beforeAttachmentIds: i.beforeAttachmentIds ?? [], afterAttachmentIds: i.afterAttachmentIds ?? [], isSnag: i.isSnag ?? false,
    slaDueAt: hrs(at, slaH[i.severity]), ...audit(by, at), ...review(by, i.resolvedAt ?? at, rs, checkedBy, version) };
  issues.push(row); return row;
};
I("iss1", "p6", "u_le2", 15, { category: "data", severity: "high", title: "Utility meter 25062405300150 sends zeroed HISTORY packets", description: "Since the gateway outage the AWT200 replays is_historical frames with time=0 and register ≈0 — un-scaled by CT (×400). Live stream is fine.", source: "telemetry_alert", status: "in_progress", assigneeId: "u_ft1", assetId: assets2.find((a) => a.serial === "25062405300150")?.id });
I("iss2", "p4", "u_ft1", 21, { category: "electrical", severity: "high", title: "Inverter fault F23 — battery comms lost", description: "Inverter shows F23; battery SoC not reporting; site on grid only.", status: "closed", assigneeId: "u_ft1", assetId: assets2.find((a) => a.serial === "DINV-0007")?.id,
  rootCause: "Loose CAN plug at BMS, connector corroded", resolution: "Re-seated and secured plug, replaced MC4 pairs, firmware 1.4.2", resolvedBy: "u_ft1", resolvedAt: d(20, 13), costToResolve: 0, linkedVisitId: "vis1", warrantyClaimId: "war1",
  beforeAttachmentIds: [att("p4", "de-inverter-f23.jpg", "u_ft1", 21, "F23 on inverter display (before)")], afterAttachmentIds: [att("p4", "de-inverter-ok.jpg", "u_ft1", 20, "Inverter normal, SoC 78% (after)")] }, "checked", "u_pm2", 2);
I("iss3", "p1", "u_ft1", 3, { category: "mechanical", severity: "critical", title: "3 panels cracked on delivery — replace before string 3 test", description: "JKM26-0418/0419/0420 glass cracked. Write-off raised; replacements needed from stock.", status: "awaiting_parts", assigneeId: "u_sk",
  beforeAttachmentIds: [att("p1", "sango-cracked-panels.jpg", "u_ft1", 3, "Cracked glass, 3 panels", { rs: "pending" })] }, "pending");
I("iss4", "p2", "u_ft2", 6, { category: "other", severity: "low", title: "Cable tray labels missing (snag)", description: "Tray runs on roof B have no circuit labels.", isSnag: true, beforeAttachmentIds: [att("p2", "ojodu-tray-unlabelled.jpg", "u_ft2", 6, "Unlabelled tray", { checkedBy: "u_le2" })] }, "checked", "u_le2");
I("iss5", "p1", "u_ft1", 5, { category: "safety", severity: "medium", title: "No barrier around inverter bay during cabling", description: "Open DC bus accessible while string cabling in progress.", status: "in_progress", assigneeId: "u_le1", beforeAttachmentIds: [att("p1", "sango-inverter-bay-open.jpg", "u_ft1", 5, "Inverter bay unguarded", { checkedBy: "u_pm1" })] }, "checked", "u_pm1");

// ---------------- commissioning ----------------
const items = (vals: Record<string, string | undefined>, fails: string[] = []) => COMMISSIONING_TEMPLATE.map((t) => ({ key: t.key, label: t.label, unit: t.unit, measuredValue: vals[t.key], pass: !fails.includes(t.key) }));
export const commissionings: CommissioningRecord[] = [
  { id: "com1", projectId: "p4", date: d(540).slice(0, 10), engineerId: "u_le2", result: "pass", notes: "All strings within 2% of expected Voc. ATS changeover 1.8 s.", items: items({ insulation_resistance: "> 200", earth_resistance: "0.8", string_voc: "442 / 440 / 441", string_isc: "13.2 / 13.1 / 13.2" }),
    meter: { serialAscii: true, ctRatioVerified: true, firstLiveReading: true, historicalOk: true }, clientWitness: { name: "Mr Durosinmi Etti", signatureAttachmentId: att("p4", "de-commissioning-signoff.png", "u_le2", 540, "Witness signature", { checkedBy: "u_dir" }) },
    attachmentIds: [att("p4", "de-commissioning-inverter.jpg", "u_le2", 540, "Inverter energised", { checkedBy: "u_dir" })], ...audit("u_le2", d(540)), ...review("u_le2", d(540), "checked", "u_dir") },
  { id: "com2", projectId: "p6", date: d(100).slice(0, 10), engineerId: "u_le2", result: "pass", notes: "Metering-only project: 8 × AWT200 on gen and utility feeders. CT ratios verified against clamp meter.", items: items({ earth_resistance: "1.1", meter_ct_ratio: "1200/5 = ×240 (gen) · 2000/5 = ×400 (utility)" }, ["string_voc", "string_isc", "battery_bms"]).map((i) => (["string_voc", "string_isc", "battery_bms", "insulation_resistance", "fire_suppression"].includes(i.key) ? { ...i, pass: true, comment: "N/A — metering project" } : i)),
    meter: { serialAscii: true, ctRatioVerified: true, firstLiveReading: true, historicalOk: false }, clientWitness: { name: "Access Bank facilities — E. Okon", signatureAttachmentId: att("p6", "ayobo-commissioning-signoff.png", "u_le2", 100, "Witness signature", { checkedBy: "u_dir" }) },
    attachmentIds: [att("p6", "ayobo-meter-panel.jpg", "u_le2", 100, "Meter panel labelled", { checkedBy: "u_dir" })], ...audit("u_le2", d(100)), ...review("u_le2", d(100), "checked", "u_dir") },
];

// ---------------- HSE ----------------
export const hseIncidents: HseIncident[] = [
  { id: "hse1", projectId: "p1", visitId: "vis3", type: "near_miss", severity: "medium", description: "Ladder slipped on wet roof edge while accessing string 3 — no injury.", actions: "Anti-slip mats issued; harness anchor point added at roof edge; toolbox talk repeated.",
    occurredAt: d(5, 8), reportedBy: "u_ft1", attachmentIds: [att("p1", "sango-roof-edge-wet.jpg", "u_ft1", 5, "Wet roof edge, no anchor", { rs: "pending" })], ...audit("u_ft1", d(5, 9)), ...review("u_ft1", d(5, 9), "pending") },
  { id: "hse2", projectId: "p6", type: "property", severity: "low", description: "Drill bit slipped and cracked a trunking cover during meter panel install.", actions: "Cover replaced same day; charged to O&M consumables.",
    occurredAt: d(95, 14), reportedBy: "u_ft1", attachmentIds: [], ...audit("u_ft1", d(95, 15)), ...review("u_ft1", d(95, 15), "checked", "u_pm2") },
];

// ---------------- warranty ----------------
export const warrantyClaims: WarrantyClaim[] = [
  { id: "war1", projectId: "p4", assetId: assets2.find((a) => a.serial === "DBAT-0031")!.id, issueId: "iss2", vendorId: "v_fouani", claimedAt: d(19), status: "accepted", outcome: "Fouani accepted the claim; replacement BMS harness shipped, no charge.",
    costRecovered: 0, notes: "Corroded CAN connector within 12-month warranty.", ...audit("u_le2", d(19)), ...review("u_le2", d(19), "checked", "u_pm2") },
];

// ---------------- stock count (warehouse, open) ----------------
const line = (itemId: string, expectedQty: number, countedQty: number | null = null, note?: string) => ({ itemId, expectedQty, countedQty, variance: countedQty === null ? 0 : countedQty - expectedQty, note });
export const stockCounts: StockCount[] = [
  { id: "sc1", locationId: "loc_wh", countDate: d(1).slice(0, 10), countedBy: "u_sk", status: "open", varianceValue: 0, notes: "Month-end count — in progress",
    lines: [line("it_panel", 230), line("it_bat16", 3), line("it_meter", 4), line("it_ct", 16), line("it_cable", 1020, 1020), line("it_mc4", 220, 212, "8 pairs used on Sango string 3 not booked"), line("it_rail", 80, 80), line("it_fuse", 50, 52), line("it_mccb", 0), line("it_inv50", 0), line("it_inv80", 0)],
    ...audit("u_sk", d(1)) },
];

// ---------------- client invoices (what we billed p1) ----------------
// One paid with VAT withheld by the client (their credit note is the evidence); one still open.
export const clientInvoices: ClientInvoice[] = [];
const INV = (id: string, projectId: string, by: string, daysAgo: number, i: Omit<ClientInvoice, "id" | "projectId" | keyof AuditFields | keyof ReviewFields | "receipts" | "vatEvidenceIds" | "attachmentIds"> & Partial<Pick<ClientInvoice, "receipts" | "vatEvidenceIds" | "attachmentIds">>, rs: ReviewStatus = "checked", checkedBy = "u_fin"): ClientInvoice => {
  const at = d(daysAgo, 11);
  const row: ClientInvoice = { id, projectId, ...i, receipts: i.receipts ?? [], vatEvidenceIds: i.vatEvidenceIds ?? [], attachmentIds: i.attachmentIds ?? [], ...audit(by, at), ...review(by, at, rs, checkedBy, 1) };
  clientInvoices.push(row); return row;
};
INV("inv1", "p1", "u_fin", 60, { invoiceNumber: "WYR-INV-2026-014", issuedAt: d(60, 9), description: "Mobilisation — 40% of contract", netAmount: 23_731_700, vatAmount: 1_779_877.5, grossAmount: 25_511_577.5,
  receipts: [{ id: "rcpt1", date: d(45, 9), amount: 23_731_700, note: "Net paid; VAT withheld", attachmentIds: [att("p1", "sango-mobilisation-remittance.pdf", "u_fin", 45, "Remittance advice — WYR-INV-2026-014")], recordedBy: "u_fin", recordedAt: d(45, 9) }],
  vatStatus: "withheld_by_client", vatSettledAt: d(40, 9), vatSettledBy: "u_fin", vatNote: "Client withholds VAT and remits to FIRS", vatEvidenceIds: [att("p1", "sango-vat-credit-note.pdf", "u_fin", 40, "WHT-VAT credit note — WYR-INV-2026-014")],
  attachmentIds: [att("p1", "WYR-INV-2026-014.pdf", "u_fin", 60, "Invoice WYR-INV-2026-014")] });
INV("inv2", "p1", "u_fin", 12, { invoiceNumber: "WYR-INV-2026-031", issuedAt: d(12, 9), description: "Installation complete — 40% of contract", netAmount: 23_731_700, vatAmount: 1_779_877.5, grossAmount: 25_511_577.5,
  vatStatus: "outstanding", attachmentIds: [att("p1", "WYR-INV-2026-031.pdf", "u_fin", 12, "Invoice WYR-INV-2026-031")] });
