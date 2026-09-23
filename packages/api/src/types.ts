// Domain types — mirror spec §2, §3, §4 (project_tracker_spec.md)

// Six roles, and they stack: a User holds many, and `can()` unions their permissions, so one person can be
// techlead + finance without a combined role existing. Keep them narrow for that reason.
export type RoleCode =
  | "director" | "techlead" | "tech"
  | "finance" | "store_keeper" | "auditor";

export const ROLE_LABEL: Record<RoleCode, string> = {
  director: "Director", techlead: "Tech Lead", tech: "Tech",
  finance: "Finance", store_keeper: "Store Keeper", auditor: "Auditor",
};
/** Every role, in the order the UI should offer them: broadest responsibility first. */
/** Mirrors money.UNNAMED_VENDOR on the server. */
export const UNNAMED_VENDOR = "Vendor not recorded";

export const ROLE_CODES: readonly RoleCode[] = ["director", "techlead", "tech", "finance", "store_keeper", "auditor"];
/** Roles that apply to every project without a membership */
export const GLOBAL_ROLES: readonly RoleCode[] = ["director", "finance", "store_keeper", "auditor"];

export interface User {
  id: string; name: string; email: string; roles: RoleCode[]; initials: string; username?: string;
  /** "invited" = account created but the person has never followed their link and set a password */
  status?: "active" | "invited" | "disabled";
}
export type ExtractionStatus = "queued" | "running" | "done" | "failed" | "accepted" | "rejected";
/** What a model read from a file. A proposal — never a record until a person accepts it. */
export interface Extraction {
  id: string; projectId?: string; sourceKind: string; sourceId: string; target: string;
  status: ExtractionStatus; transcript: string; fields: Record<string, string | null> | null;
  modelName: string; costUsd: number; error: string;
  requestedBy: string; requestedAt: string; finishedAt?: string; decidedBy?: string; decidedAt?: string;
}

export interface InviteInput { name: string; email: string; username: string; roles: RoleCode[] }
export interface LinkOwner { name: string; username: string; email: string }

export interface ProjectMembership {
  id: string; projectId: string; userId: string; role: RoleCode; grantedBy: string; grantedAt: string; revokedAt?: string;
}

export type Stage = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type Rag = "green" | "amber" | "red";
export type ReviewStatus = "pending" | "checked" | "rejected";

export interface AuditFields { createdAt: string; createdBy: string; updatedAt: string; updatedBy: string }
/** §4.14 void — wrong data that was entered (and maybe checked) stops counting everywhere but stays on the record,
 *  struck through, with who voided it and why. Never deleted: the chronology and gates must keep their history. */
export interface VoidFields { voidedAt?: string; voidedBy?: string; voidReason?: string }
export type VoidKind = "document" | "attachment" | "stock_movement" | "cost_item" | "client_invoice" | "vat_payment";
export const VOID_KIND_LABEL: Record<VoidKind, string> = { document: "document", attachment: "file", stock_movement: "stock movement", cost_item: "budget line", client_invoice: "invoice", vat_payment: "VAT payment" };

export interface ReviewFields {
  reviewStatus: ReviewStatus; submittedBy: string; submittedAt: string;
  checkedBy?: string; checkedAt?: string; checkComment?: string; reviewVersion: number;
}

export type ProjectType = "solar_battery" | "gen_rightsizing" | "ems" | "pf_correction" | "metering";
export const PROJECT_TYPE_LABEL: Record<ProjectType, string> = {
  solar_battery: "Solar + Battery", gen_rightsizing: "Generator Right-sizing", ems: "EMS",
  pf_correction: "Power-factor Correction", metering: "Metering",
};

export interface Project extends AuditFields {
  id: string; code: string; name: string; clientName: string; branchName: string; location: string;
  projectType: ProjectType; systemCapacityKwp?: number;
  stage: Stage; rag: Rag; ragReason?: string;
  pmId: string; leadEngineerId: string;
  /** delegated per site: this person may record commissioning here, whatever their role */
  commissioningAssigneeId?: string;
  /** the number the contract is written in — net of VAT. Budgets, margin and retention are measured against this */
  contractValueNet: number;
  /** percent, per project (7.5 by default; 0 for zero-rated work) */
  vatRate: number;
  vatTreatment: VatTreatment;
  /** derived: VAT on the net contract at vatRate; 0 when exempt */
  vatAmount: number;
  /** derived: net + VAT. Always labelled "gross" or "incl. VAT" wherever it is shown */
  contractValue: number;
  /** draft: project opened before the final contract is in hand — figures are provisional · received: signed contract received */
  contractStatus: ContractStatus; contractReceivedOn?: string; contractReceivedBy?: string; contractDocumentId?: string;
  approvedBudget: number; committed: number; actual: number;
  stagePlanned: Partial<Record<Stage, string>>; stageActual: Partial<Record<Stage, string>>;
  defectsLiabilityEnd?: string; retentionPercent: number;
  openIssues: { critical: number; high: number; medium: number; low: number };
}

export type DocType =
  | "proposal" | "sizing" | "roi_model"
  | "survey" | "roof_assessment" | "structural_cert" | "load_audit" | "site_photos"
  | "sld" | "bom" | "permit" | "disco_approval" | "insurance"
  | "procurement_pack" | "serial_register"
  | "site_log" | "hse_checklist" | "progress_photos" | "variation_register"
  | "commissioning_record" | "client_witness" | "commissioning_photos" | "meter_integrity"
  | "acceptance" | "om_manual" | "warranty" | "as_built" | "final_account"
  | "dlp_release" | "snag_list" | "retention_release" | "final_reconciliation"
  | "contract" | "other";

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  proposal: "Signed proposal", sizing: "Sizing document", roi_model: "ROI model",
  survey: "Survey report", roof_assessment: "Roof / space assessment", structural_cert: "Structural certificate",
  load_audit: "Load audit", site_photos: "Site photos",
  sld: "Single-line diagram", bom: "Bill of materials", permit: "Permits", disco_approval: "DISCO application / approval",
  insurance: "Insurance policy",
  procurement_pack: "Procurement pack (PO → GRN → receipts)", serial_register: "Serial register",
  site_log: "Daily site log", hse_checklist: "HSE checklist", progress_photos: "Progress photos", variation_register: "Variations approved",
  commissioning_record: "Commissioning record", client_witness: "Client witness sign-off", commissioning_photos: "Commissioning photos",
  meter_integrity: "Meter data-integrity checks",
  acceptance: "Client acceptance", om_manual: "O&M manual", warranty: "Warranty pack", as_built: "As-built drawings", final_account: "Final account",
  dlp_release: "DLP release", snag_list: "Snag list closed", retention_release: "Retention release", final_reconciliation: "Final reconciliation",
  contract: "Contract", other: "Other",
};

export interface Document extends AuditFields, ReviewFields, VoidFields {
  id: string; projectId: string; docType: DocType; title: string;
  status: "draft" | "submitted" | "approved" | "expired";
  issuedAt?: string; expiresAt?: string; issuer?: string; version: number;
  fileName: string; sizeBytes: number; sha256?: string;
  /** short-lived signed download link, present in live mode only */
  url?: string;
}

export interface Attachment extends ReviewFields, VoidFields {
  id: string; projectId: string; fileName: string; mime: string; sizeBytes: number;
  kind: "image" | "document"; capturedAt?: string; gps?: { lat: number; lng: number };
  sha256: string; uploadedBy: string; uploadedAt: string;
  linkedTo?: { model: string; id: string; label: string }; caption?: string;
  /** short-lived signed download link, present in live mode only */
  url?: string;
}

export type EventType =
  | "project_created" | "stage_change" | "gate_requested" | "approval_decided"
  | "document_added" | "attachment_added" | "check_passed" | "check_rejected"
  | "po_raised" | "po_approved" | "delivery" | "bill_received" | "payment"
  | "visit" | "issue_raised" | "issue_closed" | "change_order"
  | "role_granted" | "role_revoked" | "commissioning_assigned" | "note"
  | "stock_movement" | "cost_item" | "retention" | "reconciliation"
  | "issue" | "commissioning" | "hse" | "warranty" | "stock_count"
  | "contract_updated" | "contract_received" | "invoice" | "plan_updated" | "void";

export interface ChronologyEvent {
  id: string; projectId: string; occurredAt: string; actorId: string; eventType: EventType;
  summary: string; detail?: string; ref?: { model: string; id: string };
  before?: Record<string, unknown>; after?: Record<string, unknown>;
}

export type ApprovalKind = "gate" | "po" | "change_order" | "retention" | "write_off" | "stock_count";
export interface ApprovalDecision { approverId: string; role: RoleCode; decision: "approved" | "rejected"; at: string; comment?: string }
export interface Approval {
  id: string; projectId?: string; kind: ApprovalKind; title: string; description: string;
  requestedBy: string; requestedAt: string;
  /** every listed role must approve once; any rejection rejects */
  requiredRoles: RoleCode[]; decisions: ApprovalDecision[];
  status: "pending" | "approved" | "rejected";
  amount?: number; targetStage?: Stage;
}

export type NotificationKind =
  | "document_expiring" | "document_expired" | "check_overdue" | "approval_pending" | "gate_ready"
  | "issue_sla_breach" | "budget_warn" | "budget_over" | "stock_below_reorder" | "qb_unmatched";
export interface AppNotification {
  id: string; kind: NotificationKind | string; severity: "critical" | "warning" | "info";
  title: string; body: string; link: string; projectId?: string | null;
  ref?: { model: string; id: string } | null; createdAt: string; updatedAt: string; readAt?: string | null;
}

export interface Threshold { key: string; label: string; value: number | string; unit?: string; effectiveFrom: string; updatedBy: string }

export type EvidenceState = "ok" | "pending" | "rejected" | "missing";
export interface GateEvidenceItem { docType: DocType; label: string; state: EvidenceState; document?: Document }
export interface GateStatus {
  stage: Stage; name: string; nextStage?: Stage; items: GateEvidenceItem[];
  ready: boolean; approverRoles: RoleCode[]; pendingApproval?: Approval; terminal: boolean;
}

// ============================ Phase 2 — money, assets, stock (spec §4.4, §4.5, §4.10, §4.15) ============================

export interface Vendor { id: string; name: string; category?: string }

export type CostCategory = "equipment" | "civil" | "labour" | "logistics" | "permits" | "contingency" | "om";
export const COST_CATEGORY_LABEL: Record<CostCategory, string> = {
  equipment: "Equipment", civil: "Civil & structural", labour: "Labour & install", logistics: "Logistics",
  permits: "Permits & approvals", contingency: "Contingency", om: "O&M",
};

/** Budget line — maker-checked (Finance checks) */
export interface CostItem extends AuditFields, ReviewFields, VoidFields { id: string; projectId: string; category: CostCategory; label: string; plannedAmount: number }

export type PoStatus = "pending_approval" | "approved" | "rejected" | "partially_delivered" | "delivered" | "closed";
export interface PurchaseItem {
  id: string; costItemId?: string; inventoryItemId?: string; description: string;
  qty: number; unitCost: number; lineTotal: number; qtyReceived: number;
}
/** PO — the Approval IS its check (spec §4.13) */
export interface PurchaseOrder extends AuditFields {
  id: string; projectId: string; poNumber: string; vendorId: string; status: PoStatus;
  raisedBy: string; raisedAt: string; items: PurchaseItem[]; total: number; notes?: string; approvalId?: string;
}

export interface GoodsReceiptLine { purchaseItemId: string; qty: number; serials?: string[]; condition: "good" | "damaged" }
/** GRN — maker-checked (PM / Finance). On check: posts receipt movements, creates assets, recognises actuals. */
export interface GoodsReceipt extends AuditFields, ReviewFields {
  id: string; projectId: string; poId: string; grnNumber: string; receivedAt: string; receivedBy: string;
  lines: GoodsReceiptLine[]; attachmentIds: string[]; locationId: string; notes?: string;
}

export type AssetType = "panel" | "inverter" | "battery" | "meter" | "ct" | "ats" | "cable" | "mounting" | "other";
/** Runtime list, same order as backend/tracker/constants.py ASSET_TYPES. */
export const ASSET_TYPES: readonly AssetType[] = ["panel", "inverter", "battery", "meter", "ct", "ats", "cable", "mounting", "other"];
export type AssetStatus = "in_stock" | "installed" | "faulty" | "replaced" | "decommissioned";
export interface Asset extends AuditFields {
  id: string; projectId?: string; inventoryItemId: string; assetType: AssetType; make: string; model: string; serial: string;
  unitCost: number; vendorId?: string; purchaseItemId?: string; grnId?: string;
  installDate?: string; locationOnSite?: string; warrantyStart?: string; warrantyEnd?: string; status: AssetStatus; locationId?: string;
}

export type ItemCategory = AssetType | "consumable" | "tool";
export interface InventoryItem {
  id: string; sku: string; name: string; category: ItemCategory; unit: string; isSerialised: boolean;
  reorderLevel: number; reorderQty: number; defaultVendorId?: string; isActive: boolean; make?: string; model?: string; warrantyMonths?: number;
}
export interface StockLocation { id: string; name: string; type: "warehouse" | "vehicle" | "site" | "quarantine"; custodianId?: string; isActive: boolean }

export type MovementType = "receipt" | "issue" | "return" | "transfer" | "adjustment" | "write_off";
export const MOVEMENT_LABEL: Record<MovementType, string> = {
  receipt: "Receipt", issue: "Issue to project", return: "Return from site", transfer: "Transfer", adjustment: "Adjustment", write_off: "Write-off",
};
/** Append-only ledger row. qty is a magnitude; sign comes from movementType. */
export interface StockMovement extends ReviewFields, VoidFields {
  id: string; itemId: string; movementType: MovementType; qty: number;
  locationFromId?: string; locationToId?: string; unitCost: number; totalCost: number;
  projectId?: string; sourceRef?: { model: string; id: string; label: string }; reason?: string;
  serials?: string[]; attachmentIds?: string[]; createdBy: string; createdAt: string; approvalId?: string;
}
export interface StockBalance { itemId: string; locationId: string; qtyOnHand: number; wacUnitCost: number; value: number; lastMovementAt?: string; belowReorder: boolean }

export type ActualSource = "goods_receipt" | "issue" | "return" | "visit" | "change_order" | "bill" | "payment" | "warranty";
/** Unified actuals ledger (spec §4.10). Only produced by checked / approved events. */
export interface Actual {
  id: string; projectId: string; costItemId?: string; category: CostCategory; source: ActualSource;
  sourceRef: { model: string; id: string; label: string }; amount: number; date: string; vendorId?: string;
  attachmentIds: string[]; qbBillId?: string; createdBy: string;
}

export interface ChangeOrder extends AuditFields {
  id: string; projectId: string; coNumber: string; title: string; reason: string; scopeDelta: string;
  costDelta: number; timeDeltaDays: number; status: "pending_approval" | "approved" | "rejected"; approvalId: string;
}
export interface Retention { projectId: string; percent: number; amountHeld: number; releaseConditions: string; releasedAt?: string; releasedBy?: string; approvalId?: string }

export type ContractStatus = "draft" | "received";
export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = { draft: "Draft — contract not yet received", received: "Contract received" };

// ---------- VAT & client billing ----------
/** standard: we collect VAT and remit it · withheld_by_client: the client (oil & gas, MDAs) remits it on our behalf · exempt: zero-rated */
export type VatTreatment = "standard" | "withheld_by_client" | "exempt";
export const VAT_TREATMENT_LABEL: Record<VatTreatment, string> = { standard: "Standard — we collect and remit", withheld_by_client: "Withheld by client — they remit to FIRS", exempt: "Exempt / zero-rated" };
/** outstanding: nothing settled · collected: client paid it to us, we still owe FIRS · withheld_by_client / remitted: settled with FIRS */
export type VatStatus = "outstanding" | "collected" | "withheld_by_client" | "remitted";
export const VAT_STATUS_LABEL: Record<VatStatus, string> = { outstanding: "Outstanding", collected: "Collected — to remit", withheld_by_client: "Withheld by client", remitted: "Remitted to FIRS" };
export const VAT_SETTLED: readonly VatStatus[] = ["withheld_by_client", "remitted"];
export interface InvoiceReceipt { id: string; date: string; amount: number; note?: string; attachmentIds: string[]; recordedBy: string; recordedAt: string }
/** What we billed the client, what came in against it, and where its VAT stands. Maker-checked like everything else. */
export interface ClientInvoice extends AuditFields, ReviewFields, VoidFields {
  id: string; projectId: string; invoiceNumber: string; issuedAt: string; description: string;
  netAmount: number; vatAmount: number; grossAmount: number;
  receipts: InvoiceReceipt[];
  vatStatus: VatStatus; vatSettledAt?: string; vatSettledBy?: string; vatNote?: string; vatEvidenceIds: string[];
  /** the invoice itself */
  attachmentIds: string[];
}
/** VAT paid on a project — a partial or the lot — with its receipts. Checked by Finance or a Director before it counts. */
export type VatPaymentMethod = "remitted" | "withheld_by_client";
export const VAT_PAYMENT_METHOD_LABEL: Record<VatPaymentMethod, string> = { remitted: "Remitted to FIRS by us", withheld_by_client: "Withheld and remitted by the client" };
export interface VatPayment extends AuditFields, ReviewFields, VoidFields {
  id: string; projectId: string; amount: number; paidOn: string; method: VatPaymentMethod; note?: string;
  /** FIRS receipts, client credit notes — several allowed, more can be added later */
  attachmentIds: string[];
}

export interface QbBill {
  id: string; docNumber: string; vendorName: string; txnDate: string; dueDate: string; totalAmount: number; balance: number;
  currency: string; projectId?: string; matchedPoId?: string; matchStatus: "matched" | "suggested" | "unmatched"; syncedAt: string;
}

export interface ProjectMoney {
  planned: number; committed: number; actual: number; variance: number; burnPct: number; forecast: number;
  byCategory: Record<CostCategory, { planned: number; committed: number; actual: number }>;
  changeOrders: number; retentionHeld: number;
  /** VAT & billing — net contract (+ approved COs) is the base; gross is derived; everything is labelled */
  contractNet: number; vatRate: number; vatDue: number; contractGross: number;
  invoicedNet: number; invoicedVat: number; received: number;
  vatSettled: number; vatOutstanding: number;
}

// ============================ Phase 3 — field & quality (spec §4.6, §4.8, §4.9, §4.14, §4.15 phase 3) ============================

export type VisitType = "routine" | "fault" | "warranty" | "inspection" | "upgrade" | "commissioning";
export const VISIT_TYPE_LABEL: Record<VisitType, string> = { routine: "Routine maintenance", fault: "Fault call-out", warranty: "Warranty", inspection: "Inspection", upgrade: "Upgrade", commissioning: "Commissioning" };
export interface VisitPart { movementId: string; itemId: string; qty: number; serials?: string[] }
/** Post-commissioning site visit — maker-checked (PM / Lead Engineer). On check: parts movements post, travel+labour posts as an O&M actual. */
export interface SiteVisit extends AuditFields, ReviewFields {
  id: string; projectId: string; stationId?: string; visitType: VisitType; startedAt: string; endedAt: string;
  technicianIds: string[]; durationHrs: number; findings: string; actionsTaken: string;
  costTravel: number; costLabour: number; costParts: number; costTotal: number; parts: VisitPart[]; locationId: string;
  attachmentIds: string[]; issueIds: string[]; clientSignoff?: { name: string; signatureAttachmentId?: string; rating?: number };
  gps?: { lat: number; lng: number }; offlineCapturedAt?: string;
}

export type IssueCategory = "electrical" | "mechanical" | "performance" | "data" | "safety" | "client" | "other";
export type IssueSeverity = "critical" | "high" | "medium" | "low";
export type IssueStatus = "open" | "in_progress" | "awaiting_parts" | "resolved" | "closed" | "wont_fix";
export const ISSUE_STATUS_LABEL: Record<IssueStatus, string> = { open: "Open", in_progress: "In progress", awaiting_parts: "Awaiting parts", resolved: "Resolved (pending check)", closed: "Closed", wont_fix: "Won't fix" };
/** Issue / defect. Report is maker-checked (v1); resolution re-enters review (v2) and closes on check. */
export interface Issue extends AuditFields, ReviewFields {
  id: string; projectId: string; stationId?: string; assetId?: string; category: IssueCategory; severity: IssueSeverity;
  title: string; description: string; raisedBy: string; raisedAt: string; source: "manual" | "visit" | "telemetry_alert";
  status: IssueStatus; assigneeId?: string; rootCause?: string; resolution?: string; resolvedBy?: string; resolvedAt?: string;
  costToResolve: number; linkedVisitId?: string; warrantyClaimId?: string;
  /** files added while the issue is open — progress photos, quotes, test sheets — each with its own caption */
  attachmentIds: string[];
  beforeAttachmentIds: string[]; afterAttachmentIds: string[]; isSnag: boolean; slaDueAt: string;
}

export interface CommissioningItem { key: string; label: string; measuredValue?: string; unit?: string; pass: boolean | null; comment?: string; attachmentId?: string }
export interface MeterIntegrity { serialAscii: boolean; ctRatioVerified: boolean; firstLiveReading: boolean; historicalOk: boolean }
export const COMMISSIONING_TEMPLATE: { key: string; label: string; unit?: string }[] = [
  { key: "insulation_resistance", label: "Insulation resistance (DC strings)", unit: "MΩ" },
  { key: "earth_resistance", label: "Earth resistance", unit: "Ω" },
  { key: "string_voc", label: "String Voc per string", unit: "V" },
  { key: "string_isc", label: "String Isc per string", unit: "A" },
  { key: "inverter_config", label: "Inverter firmware / configuration" },
  { key: "battery_bms", label: "Battery SoC / BMS communication" },
  { key: "ats_changeover", label: "ATS changeover test" },
  { key: "meter_ct_ratio", label: "Meter CT ratio verified against live reading" },
  { key: "first_live_reading", label: "First live reading received on platform" },
  { key: "labelling", label: "Labelling & signage" },
  { key: "fire_suppression", label: "Fire suppression present & tagged" },
  { key: "hse_walkdown", label: "HSE walk-down complete" },
];
/** Commissioning record — maker Lead Engineer; checker Director or second Lead Engineer. On check (pass) it satisfies gate-5 evidence. */
export interface CommissioningRecord extends AuditFields, ReviewFields {
  id: string; projectId: string; stationId?: string; date: string; engineerId: string; result: "pass" | "conditional" | "fail"; notes: string;
  items: CommissioningItem[]; meter: MeterIntegrity; clientWitness?: { name: string; signatureAttachmentId?: string }; attachmentIds: string[];
}

export type HseType = "near_miss" | "injury" | "property" | "environmental";
export const HSE_TYPE_LABEL: Record<HseType, string> = { near_miss: "Near miss", injury: "Injury", property: "Property damage", environmental: "Environmental" };
export interface HseIncident extends AuditFields, ReviewFields {
  id: string; projectId: string; visitId?: string; type: HseType; severity: IssueSeverity; description: string; actions: string;
  occurredAt: string; reportedBy: string; attachmentIds: string[];
}

export type WarrantyStatus = "raised" | "accepted" | "rejected" | "replaced" | "refunded";
export interface WarrantyClaim extends AuditFields, ReviewFields {
  id: string; projectId: string; assetId: string; issueId?: string; vendorId?: string; claimedAt: string; status: WarrantyStatus;
  outcome?: string; costRecovered: number; notes: string;
}

export interface StockCountLine { itemId: string; expectedQty: number; countedQty: number | null; variance: number; note?: string; attachmentId?: string }
/** Physical count. Submit → Finance approval → variance lines post as `adjustment` movements at WAC. */
export interface StockCount extends AuditFields {
  id: string; locationId: string; countDate: string; countedBy: string; status: "open" | "submitted" | "approved" | "rejected";
  lines: StockCountLine[]; approvalId?: string; notes?: string; varianceValue: number;
}
