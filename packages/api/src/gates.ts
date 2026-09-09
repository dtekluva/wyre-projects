import type { Stage, DocType, RoleCode } from "./types";

export interface StageDef { stage: Stage; name: string; short: string; evidence: DocType[]; approverRoles: RoleCode[]; terminal?: boolean }

/** Spec §3 — stage gates with required evidence and approvers */
export const STAGES: StageDef[] = [
  { stage: 0, name: "Lead / Proposal",     short: "Proposal",     evidence: ["proposal", "sizing", "roi_model"], approverRoles: ["director"] },
  { stage: 1, name: "Site Survey",         short: "Survey",       evidence: ["survey", "roof_assessment", "structural_cert", "load_audit", "site_photos"], approverRoles: ["lead_engineer"] },
  { stage: 2, name: "Design & Approvals",  short: "Design",       evidence: ["sld", "bom", "permit", "disco_approval", "insurance"], approverRoles: ["lead_engineer", "finance"] },
  { stage: 3, name: "Procurement",         short: "Procurement",  evidence: ["procurement_pack", "serial_register"], approverRoles: ["finance"] },
  { stage: 4, name: "Installation",        short: "Install",      evidence: ["site_log", "hse_checklist", "progress_photos", "variation_register"], approverRoles: ["pm"] },
  { stage: 5, name: "Commissioning",       short: "Commission",   evidence: ["commissioning_record", "client_witness", "commissioning_photos", "meter_integrity"], approverRoles: ["lead_engineer"] },
  { stage: 6, name: "Handover",            short: "Handover",     evidence: ["acceptance", "om_manual", "warranty", "as_built", "final_account"], approverRoles: ["director"] },
  { stage: 7, name: "O&M / Post-install",  short: "O&M",          evidence: ["dlp_release", "snag_list", "retention_release", "final_reconciliation"], approverRoles: ["finance", "director"] },
  { stage: 8, name: "Closed",              short: "Closed",       evidence: [], approverRoles: [], terminal: true },
];

export const stageDef = (s: Stage) => STAGES[s];
