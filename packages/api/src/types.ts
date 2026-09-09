// Domain types — mirror spec §2, §3, §4 (project_tracker_spec.md)

export type RoleCode =
  | "admin" | "director" | "finance" | "pm" | "lead_engineer"
  | "field_tech" | "store_keeper" | "auditor";

export const ROLE_LABEL: Record<RoleCode, string> = {
  admin: "Admin", director: "Director", finance: "Finance", pm: "Project Manager",
  lead_engineer: "Lead Engineer", field_tech: "Field Tech", store_keeper: "Store Keeper", auditor: "Auditor",
};
/** Roles that apply to every project without a membership */
export const GLOBAL_ROLES: readonly RoleCode[] = ["admin", "director", "finance", "store_keeper", "auditor"];

export interface User { id: string; name: string; email: string; roles: RoleCode[]; initials: string }

export interface ProjectMembership {
  id: string; projectId: string; userId: string; role: RoleCode; grantedBy: string; grantedAt: string; revokedAt?: string;
}

export type Stage = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type Rag = "green" | "amber" | "red";
export type ReviewStatus = "pending" | "checked" | "rejected";

export interface AuditFields { createdAt: string; createdBy: string; updatedAt: string; updatedBy: string }
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
  contractValue: number; approvedBudget: number; committed: number; actual: number;
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

export interface Document extends AuditFields, ReviewFields {
  id: string; projectId: string; docType: DocType; title: string;
  status: "draft" | "submitted" | "approved" | "expired";
  issuedAt?: string; expiresAt?: string; issuer?: string; version: number;
  fileName: string; sizeBytes: number;
}

export interface Attachment extends ReviewFields {
  id: string; projectId: string; fileName: string; mime: string; sizeBytes: number;
  kind: "image" | "document"; capturedAt?: string; gps?: { lat: number; lng: number };
  sha256: string; uploadedBy: string; uploadedAt: string;
  linkedTo?: { model: string; id: string; label: string }; caption?: string;
}

export type EventType =
  | "project_created" | "stage_change" | "gate_requested" | "approval_decided"
  | "document_added" | "attachment_added" | "check_passed" | "check_rejected"
  | "po_raised" | "po_approved" | "delivery" | "bill_received" | "payment"
  | "visit" | "issue_raised" | "issue_closed" | "change_order"
  | "role_granted" | "role_revoked" | "note"
  | "stock_movement" | "cost_item" | "retention" | "reconciliation";

export interface ChronologyEvent {
  id: string; projectId: string; occurredAt: string; actorId: string; eventType: EventType;
  summary: string; detail?: string; ref?: { model: string; id: string };
  before?: Record<string, unknown>; after?: Record<string, unknown>;
}

export type ApprovalKind = "gate" | "po" | "change_order" | "retention" | "write_off";
export interface ApprovalDecision { approverId: string; role: RoleCode; decision: "approved" | "rejected"; at: string; comment?: string }
export interface Approval {
  id: string; projectId?: string; kind: ApprovalKind; title: string; description: string;
  requestedBy: string; requestedAt: string;
  /** every listed role must approve once; any rejection rejects */
  requiredRoles: RoleCode[]; decisions: ApprovalDecision[];
  status: "pending" | "approved" | "rejected";
  amount?: number; targetStage?: Stage;
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
export interface CostItem extends AuditFields, ReviewFields { id: string; projectId: string; category: CostCategory; label: string; plannedAmount: number }

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
export interface StockMovement extends ReviewFields {
  id: string; itemId: string; movementType: MovementType; qty: number;
  locationFromId?: string; locationToId?: string; unitCost: number; totalCost: number;
  projectId?: string; sourceRef?: { model: string; id: string; label: string }; reason?: string;
  serials?: string[]; attachmentIds?: string[]; createdBy: string; createdAt: string; approvalId?: string;
}
export interface StockBalance { itemId: string; locationId: string; qtyOnHand: number; wacUnitCost: number; value: number; lastMovementAt?: string; belowReorder: boolean }

export type ActualSource = "goods_receipt" | "issue" | "return" | "visit" | "change_order" | "bill" | "payment";
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

export interface QbBill {
  id: string; docNumber: string; vendorName: string; txnDate: string; dueDate: string; totalAmount: number; balance: number;
  currency: string; projectId?: string; matchedPoId?: string; matchStatus: "matched" | "suggested" | "unmatched"; syncedAt: string;
}

export interface ProjectMoney {
  planned: number; committed: number; actual: number; variance: number; burnPct: number; forecast: number;
  byCategory: Record<CostCategory, { planned: number; committed: number; actual: number }>;
  changeOrders: number; retentionHeld: number;
}
