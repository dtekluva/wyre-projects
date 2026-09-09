import type {
  User, Project, ProjectMembership, Document, Attachment, ChronologyEvent, Approval, Threshold, DocType, ReviewStatus,
} from "../types";

/** Fixed "now" for deterministic mock data */
export const NOW = "2026-09-09T10:00:00+01:00";
const d = (daysAgo: number, hh = 9, mm = 0) => {
  const t = new Date(NOW); t.setDate(t.getDate() - daysAgo); t.setHours(hh, mm, 0, 0); return t.toISOString();
};
const ahead = (days: number) => { const t = new Date(NOW); t.setDate(t.getDate() + days); return t.toISOString().slice(0, 10); };

const U = (id: string, name: string, roles: User["roles"]): User => ({
  id, name, roles, email: name.toLowerCase().replace(/ /g, ".") + "@wyreng.com",
  initials: name.split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase(),
});

export const users: User[] = [
  U("u_admin", "Ada Okafor", ["admin"]),
  U("u_dir", "Tunde Bakare", ["director"]),
  U("u_fin", "Ngozi Eze", ["finance"]),
  U("u_pm1", "Kunle Adebayo", ["pm"]),
  U("u_pm2", "Bola Adeyemi", ["pm"]),
  U("u_le1", "Chidi Okoro", ["lead_engineer"]),
  U("u_le2", "Amaka Obi", ["lead_engineer"]),
  U("u_ft1", "Segun Alabi", ["field_tech"]),
  U("u_ft2", "Yusuf Danladi", ["field_tech"]),
  U("u_sk", "Musa Ibrahim", ["store_keeper"]),
  U("u_aud", "Funke Ojo", ["auditor"]),
];

const audit = (by: string, at: string) => ({ createdAt: at, createdBy: by, updatedAt: at, updatedBy: by });

type PSeed = Omit<Project, keyof ReturnType<typeof audit>> & { createdBy: string; createdAt: string };
const P = (p: PSeed): Project => ({ ...p, ...audit(p.createdBy, p.createdAt) });

export const projects: Project[] = [
  P({ id: "p1", code: "WYR-2026-001", name: "Sweet Sensation Sango — Solar + Battery", clientName: "Sweet Sensation", branchName: "Sango",
      location: "Sango-Ota, Ogun", projectType: "solar_battery", systemCapacityKwp: 40.6, stage: 4, rag: "amber",
      ragReason: "Gate 4 evidence outstanding · 6 days behind plan", pmId: "u_pm1", leadEngineerId: "u_le1",
      contractValue: 59_329_250, approvedBudget: 51_000_000, committed: 44_200_000, actual: 31_850_000,
      stagePlanned: { 4: ahead(-6), 5: ahead(12), 6: ahead(26) }, stageActual: { 0: d(120), 1: d(98), 2: d(71), 3: d(40) },
      retentionPercent: 5, openIssues: { critical: 0, high: 1, medium: 2, low: 0 }, createdBy: "u_pm1", createdAt: d(120) }),
  P({ id: "p2", code: "WYR-2026-002", name: "Sweet Sensation Ojodu — Solar + Battery", clientName: "Sweet Sensation", branchName: "Ojodu",
      location: "Ojodu, Lagos", projectType: "solar_battery", systemCapacityKwp: 135.3, stage: 3, rag: "green",
      pmId: "u_pm1", leadEngineerId: "u_le2",
      contractValue: 123_517_500, approvedBudget: 106_000_000, committed: 98_400_000, actual: 61_300_000,
      stagePlanned: { 3: ahead(2), 4: ahead(30), 5: ahead(58) }, stageActual: { 0: d(110), 1: d(88), 2: d(52) },
      retentionPercent: 5, openIssues: { critical: 0, high: 0, medium: 1, low: 1 }, createdBy: "u_pm1", createdAt: d(110) }),
  P({ id: "p3", code: "WYR-2026-003", name: "Iya Rubbie Rubber Factory — 922.5 kWp Hybrid", clientName: "Iya Rubbie", branchName: "Benin City",
      location: "Benin City, Edo", projectType: "solar_battery", systemCapacityKwp: 922.5, stage: 1, rag: "red",
      ragReason: "Roof / space assessment rejected — no m² available vs required", pmId: "u_pm2", leadEngineerId: "u_le1",
      contractValue: 760_000_000, approvedBudget: 700_000_000, committed: 0, actual: 4_200_000,
      stagePlanned: { 1: ahead(-9), 2: ahead(20), 3: ahead(48) }, stageActual: { 0: d(45) },
      retentionPercent: 5, openIssues: { critical: 0, high: 0, medium: 0, low: 0 }, createdBy: "u_pm2", createdAt: d(45) }),
  P({ id: "p4", code: "WYR-2025-014", name: "D. E. Residence — 15 kWp Solar + Battery", clientName: "Mr Durosinmi Etti", branchName: "D. E. Residence",
      location: "Lekki, Lagos", projectType: "solar_battery", systemCapacityKwp: 15, stage: 7, rag: "green",
      pmId: "u_pm2", leadEngineerId: "u_le2",
      contractValue: 18_400_000, approvedBudget: 15_900_000, committed: 15_900_000, actual: 16_120_000,
      stagePlanned: { 8: ahead(190) }, stageActual: { 0: d(300), 1: d(280), 2: d(260), 3: d(240), 4: d(215), 5: d(200), 6: d(190), 7: d(190) },
      defectsLiabilityEnd: ahead(175), retentionPercent: 5, openIssues: { critical: 0, high: 0, medium: 1, low: 0 }, createdBy: "u_pm2", createdAt: d(300) }),
  P({ id: "p5", code: "WYR-2026-004", name: "Bright Spot Glover Road — 30 kWp Solar", clientName: "Bright Spot", branchName: "Glover Road",
      location: "Ikoyi, Lagos", projectType: "solar_battery", systemCapacityKwp: 30, stage: 2, rag: "amber",
      ragReason: "DISCO application not yet filed · 4 days behind plan", pmId: "u_pm1", leadEngineerId: "u_le1",
      contractValue: 42_000_000, approvedBudget: 36_500_000, committed: 2_100_000, actual: 1_650_000,
      stagePlanned: { 2: ahead(-4), 3: ahead(18) }, stageActual: { 0: d(60), 1: d(38) },
      retentionPercent: 5, openIssues: { critical: 0, high: 0, medium: 0, low: 0 }, createdBy: "u_pm1", createdAt: d(60) }),
  P({ id: "p6", code: "WYR-2025-011", name: "Access Bank Ayobo 2 — Metering & Gen Right-sizing", clientName: "Access", branchName: "Access Ayobo 2",
      location: "Ayobo, Lagos", projectType: "gen_rightsizing", stage: 6, rag: "green",
      pmId: "u_pm2", leadEngineerId: "u_le2",
      contractValue: 9_500_000, approvedBudget: 8_100_000, committed: 8_100_000, actual: 7_920_000,
      stagePlanned: { 6: ahead(5), 7: ahead(5) }, stageActual: { 0: d(150), 1: d(140), 2: d(128), 3: d(110), 4: d(95), 5: d(80) },
      retentionPercent: 5, openIssues: { critical: 0, high: 0, medium: 0, low: 1 }, createdBy: "u_pm2", createdAt: d(150) }),
  P({ id: "p7", code: "WYR-2026-005", name: "Edic Chemicals — 200 kWp Solar + Battery", clientName: "Alpha Mead", branchName: "Edic Chemicals",
      location: "Ikeja, Lagos", projectType: "solar_battery", systemCapacityKwp: 200, stage: 0, rag: "green",
      pmId: "u_pm1", leadEngineerId: "u_le2",
      contractValue: 210_000_000, approvedBudget: 0, committed: 0, actual: 0,
      stagePlanned: { 0: ahead(10), 1: ahead(30) }, stageActual: {},
      retentionPercent: 5, openIssues: { critical: 0, high: 0, medium: 0, low: 0 }, createdBy: "u_pm1", createdAt: d(12) }),
  P({ id: "p8", code: "WYR-2024-007", name: "Meadow Hall School — 80 kWp Solar", clientName: "Meadow Hall", branchName: "Meadow Hall School",
      location: "Lekki, Lagos", projectType: "solar_battery", systemCapacityKwp: 80, stage: 8, rag: "green",
      pmId: "u_pm2", leadEngineerId: "u_le1",
      contractValue: 68_000_000, approvedBudget: 58_500_000, committed: 58_500_000, actual: 57_900_000,
      stagePlanned: {}, stageActual: { 0: d(700), 1: d(680), 2: d(650), 3: d(620), 4: d(590), 5: d(575), 6: d(560), 7: d(560), 8: d(160) },
      retentionPercent: 5, openIssues: { critical: 0, high: 0, medium: 0, low: 0 }, createdBy: "u_pm2", createdAt: d(700) }),
];

let mid = 0;
const M = (projectId: string, userId: string, role: ProjectMembership["role"], grantedBy = "u_admin", daysAgo = 100): ProjectMembership =>
  ({ id: `m${++mid}`, projectId, userId, role, grantedBy, grantedAt: d(daysAgo) });

export const memberships: ProjectMembership[] = [
  M("p1","u_pm1","pm"), M("p1","u_le1","lead_engineer"), M("p1","u_ft1","field_tech"),
  M("p2","u_pm1","pm"), M("p2","u_le2","lead_engineer"), M("p2","u_ft1","field_tech"), M("p2","u_ft2","field_tech"),
  M("p3","u_pm2","pm"), M("p3","u_le1","lead_engineer"), M("p3","u_ft2","field_tech"),
  M("p4","u_pm2","pm"), M("p4","u_le2","lead_engineer"), M("p4","u_ft1","field_tech"),
  M("p5","u_pm1","pm"), M("p5","u_le1","lead_engineer"), M("p5","u_ft2","field_tech"),
  M("p6","u_pm2","pm"), M("p6","u_le2","lead_engineer"), M("p6","u_ft1","field_tech"),
  M("p7","u_pm1","pm"), M("p7","u_le2","lead_engineer"),
  M("p8","u_pm2","pm"), M("p8","u_le1","lead_engineer"),
];

let did = 0;
interface DSeed { p: string; t: DocType; title: string; by: string; daysAgo: number; rs?: ReviewStatus; checkedBy?: string; comment?: string; expires?: string; issuer?: string }
const D = (s: DSeed): Document => {
  const at = d(s.daysAgo);
  const rs = s.rs ?? "checked";
  return {
    id: `doc${++did}`, projectId: s.p, docType: s.t, title: s.title, status: rs === "checked" ? "approved" : "submitted",
    issuedAt: at, expiresAt: s.expires, issuer: s.issuer, version: 1,
    fileName: s.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".pdf", sizeBytes: 240_000 + (did * 37_000) % 900_000,
    ...audit(s.by, at),
    reviewStatus: rs, submittedBy: s.by, submittedAt: at, reviewVersion: 1,
    checkedBy: rs === "pending" ? undefined : s.checkedBy ?? "u_le1", checkedAt: rs === "pending" ? undefined : d(s.daysAgo - 1),
    checkComment: s.comment,
  };
};

export const documents: Document[] = [
  // p1 Sango — stage 4 Installation
  D({ p: "p1", t: "proposal", title: "Sango signed proposal", by: "u_pm1", daysAgo: 120, checkedBy: "u_dir" }),
  D({ p: "p1", t: "sizing", title: "Sango sizing — 66 × 615W, 50 kVA, 7 × 16 kWh", by: "u_le1", daysAgo: 119, checkedBy: "u_dir" }),
  D({ p: "p1", t: "roi_model", title: "Sango ROI model", by: "u_pm1", daysAgo: 118, checkedBy: "u_dir" }),
  D({ p: "p1", t: "survey", title: "Sango site survey report", by: "u_le1", daysAgo: 100, checkedBy: "u_le2" }),
  D({ p: "p1", t: "roof_assessment", title: "Sango roof assessment — 215 m² usable", by: "u_le1", daysAgo: 100, checkedBy: "u_le2" }),
  D({ p: "p1", t: "structural_cert", title: "Structural certificate — Sango", by: "u_pm1", daysAgo: 99, issuer: "Adekunle & Partners" }),
  D({ p: "p1", t: "load_audit", title: "Sango load audit", by: "u_le1", daysAgo: 99, checkedBy: "u_le2" }),
  D({ p: "p1", t: "site_photos", title: "Sango survey photos (18)", by: "u_ft1", daysAgo: 100 }),
  D({ p: "p1", t: "sld", title: "Sango SLD rev B", by: "u_le1", daysAgo: 74, checkedBy: "u_le2" }),
  D({ p: "p1", t: "bom", title: "Sango BOM", by: "u_le1", daysAgo: 74, checkedBy: "u_le2" }),
  D({ p: "p1", t: "permit", title: "Ogun State building permit", by: "u_pm1", daysAgo: 73 }),
  D({ p: "p1", t: "disco_approval", title: "IBEDC behind-the-meter approval", by: "u_pm1", daysAgo: 72, issuer: "IBEDC" }),
  D({ p: "p1", t: "insurance", title: "All-risk policy — Sango", by: "u_pm1", daysAgo: 72, issuer: "Leadway", expires: ahead(293) }),
  D({ p: "p1", t: "procurement_pack", title: "Sango procurement pack", by: "u_pm1", daysAgo: 42, checkedBy: "u_dir" }),
  D({ p: "p1", t: "serial_register", title: "Sango serial register (66 panels, 1 inverter, 7 batteries)", by: "u_sk", daysAgo: 41 }),
  D({ p: "p1", t: "site_log", title: "Daily site log — weeks 1–3", by: "u_pm1", daysAgo: 9 }),
  D({ p: "p1", t: "hse_checklist", title: "HSE checklist — weeks 1–3", by: "u_ft1", daysAgo: 4, rs: "pending" }),
  // p2 Ojodu — stage 3 Procurement (ready)
  D({ p: "p2", t: "proposal", title: "Ojodu signed proposal", by: "u_pm1", daysAgo: 110, checkedBy: "u_dir" }),
  D({ p: "p2", t: "sizing", title: "Ojodu sizing — 220 × 615W, 2 × 80 kVA, 11 × 16 kWh", by: "u_le2", daysAgo: 109, checkedBy: "u_dir" }),
  D({ p: "p2", t: "roi_model", title: "Ojodu ROI model", by: "u_pm1", daysAgo: 109, checkedBy: "u_dir" }),
  D({ p: "p2", t: "survey", title: "Ojodu site survey", by: "u_le2", daysAgo: 90 }),
  D({ p: "p2", t: "roof_assessment", title: "Ojodu roof assessment — 640 m² usable", by: "u_le2", daysAgo: 90 }),
  D({ p: "p2", t: "structural_cert", title: "Structural certificate — Ojodu", by: "u_pm1", daysAgo: 89 }),
  D({ p: "p2", t: "load_audit", title: "Ojodu load audit", by: "u_le2", daysAgo: 89 }),
  D({ p: "p2", t: "site_photos", title: "Ojodu survey photos (31)", by: "u_ft1", daysAgo: 90 }),
  D({ p: "p2", t: "sld", title: "Ojodu SLD rev C", by: "u_le2", daysAgo: 55 }),
  D({ p: "p2", t: "bom", title: "Ojodu BOM", by: "u_le2", daysAgo: 55 }),
  D({ p: "p2", t: "permit", title: "Lagos State permit — Ojodu", by: "u_pm1", daysAgo: 54 }),
  D({ p: "p2", t: "disco_approval", title: "IKEDC approval", by: "u_pm1", daysAgo: 53, issuer: "IKEDC" }),
  D({ p: "p2", t: "insurance", title: "All-risk policy — Ojodu", by: "u_pm1", daysAgo: 53, expires: ahead(312) }),
  D({ p: "p2", t: "procurement_pack", title: "Ojodu procurement pack — 9 POs, 9 GRNs", by: "u_pm1", daysAgo: 3, checkedBy: "u_dir" }),
  D({ p: "p2", t: "serial_register", title: "Ojodu serial register", by: "u_sk", daysAgo: 2, checkedBy: "u_le2" }),
  // p3 Iya Rubbie — stage 1 Survey (red)
  D({ p: "p3", t: "proposal", title: "Iya Rubbie proposal Rev 02", by: "u_pm2", daysAgo: 45, checkedBy: "u_dir" }),
  D({ p: "p3", t: "sizing", title: "Iya Rubbie sizing — 1,500 × 615W, 5 × SUN-125K, 4 × GB-W192", by: "u_le1", daysAgo: 45, checkedBy: "u_dir" }),
  D({ p: "p3", t: "roi_model", title: "Iya Rubbie ROI — 1.42 yr payback", by: "u_pm2", daysAgo: 44, checkedBy: "u_dir" }),
  D({ p: "p3", t: "survey", title: "Benin site survey report", by: "u_le1", daysAgo: 16, checkedBy: "u_le2" }),
  D({ p: "p3", t: "roof_assessment", title: "Roof assessment — 3 production sheds", by: "u_le1", daysAgo: 14, rs: "rejected", checkedBy: "u_le2",
      comment: "No m² available vs required. 1,500 panels need ~5,200 m² incl. row spacing; report lists sheds but no measurements or shading." }),
  D({ p: "p3", t: "load_audit", title: "Load audit — 15 machines, Banbury inrush", by: "u_le1", daysAgo: 15, checkedBy: "u_le2" }),
  D({ p: "p3", t: "site_photos", title: "Benin site photos (42)", by: "u_ft2", daysAgo: 15, rs: "pending" }),
  // p4 Durosinmi — stage 7 O&M
  D({ p: "p4", t: "acceptance", title: "Client acceptance — D. E. Residence", by: "u_pm2", daysAgo: 190, checkedBy: "u_dir" }),
  D({ p: "p4", t: "warranty", title: "Warranty pack", by: "u_pm2", daysAgo: 190 }),
  D({ p: "p4", t: "snag_list", title: "Snag list — 4 items closed", by: "u_le2", daysAgo: 60 }),
  // p5 Bright Spot — stage 2 Design
  D({ p: "p5", t: "proposal", title: "Bright Spot proposal", by: "u_pm1", daysAgo: 60, checkedBy: "u_dir" }),
  D({ p: "p5", t: "sizing", title: "Bright Spot sizing — 30 kWp", by: "u_le1", daysAgo: 60, checkedBy: "u_dir" }),
  D({ p: "p5", t: "roi_model", title: "Bright Spot ROI", by: "u_pm1", daysAgo: 59, checkedBy: "u_dir" }),
  D({ p: "p5", t: "survey", title: "Glover Road survey", by: "u_le1", daysAgo: 40 }),
  D({ p: "p5", t: "roof_assessment", title: "Glover Road roof — 160 m²", by: "u_le1", daysAgo: 40 }),
  D({ p: "p5", t: "structural_cert", title: "Structural cert — Glover Road", by: "u_pm1", daysAgo: 39 }),
  D({ p: "p5", t: "load_audit", title: "Glover Road load audit (Apr data)", by: "u_le1", daysAgo: 39 }),
  D({ p: "p5", t: "site_photos", title: "Glover Road photos (12)", by: "u_ft2", daysAgo: 40 }),
  D({ p: "p5", t: "sld", title: "Glover Road SLD", by: "u_le1", daysAgo: 20 }),
  D({ p: "p5", t: "bom", title: "Glover Road BOM", by: "u_le1", daysAgo: 20 }),
  D({ p: "p5", t: "permit", title: "LASG permit application", by: "u_pm1", daysAgo: 6, rs: "pending" }),
  // p6 Access Ayobo — stage 6 Handover
  D({ p: "p6", t: "commissioning_record", title: "Commissioning record — CT 240 verified, serials ASCII-clean", by: "u_le2", daysAgo: 82 }),
  D({ p: "p6", t: "meter_integrity", title: "Meter integrity — 25062405300051 / 300150", by: "u_le2", daysAgo: 82 }),
  D({ p: "p6", t: "acceptance", title: "Client acceptance — Access Ayobo 2", by: "u_pm2", daysAgo: 8, checkedBy: "u_dir" }),
  D({ p: "p6", t: "om_manual", title: "O&M manual", by: "u_pm2", daysAgo: 8 }),
  D({ p: "p6", t: "warranty", title: "Warranty pack", by: "u_pm2", daysAgo: 8 }),
  D({ p: "p6", t: "as_built", title: "As-built drawings", by: "u_le2", daysAgo: 2, rs: "pending" }),
  // p7 Edic — stage 0
  D({ p: "p7", t: "proposal", title: "Edic Chemicals proposal v1", by: "u_pm1", daysAgo: 10, checkedBy: "u_dir" }),
  D({ p: "p7", t: "sizing", title: "Edic sizing — 200 kWp", by: "u_le2", daysAgo: 5, rs: "pending" }),
  // p8 Meadow Hall — closed
  D({ p: "p8", t: "final_reconciliation", title: "Final reconciliation", by: "u_pm2", daysAgo: 162, checkedBy: "u_dir" }),
  D({ p: "p8", t: "retention_release", title: "Retention release ₦3.4M", by: "u_pm2", daysAgo: 162, checkedBy: "u_dir" }),
];

let aid = 0;
interface ASeed { p: string; name: string; by: string; daysAgo: number; rs?: ReviewStatus; checkedBy?: string; caption?: string; link?: Attachment["linkedTo"]; gps?: Attachment["gps"] }
const A = (s: ASeed): Attachment => {
  const at = d(s.daysAgo, 11, 30); const rs = s.rs ?? "checked";
  return {
    id: `att${++aid}`, projectId: s.p, fileName: s.name, mime: "image/jpeg", sizeBytes: 1_800_000 + (aid * 131_000) % 2_400_000, kind: "image",
    capturedAt: at, gps: s.gps, sha256: ("e3b0c442" + (aid * 2654435761).toString(16)).padEnd(64, "0").slice(0, 64),
    uploadedBy: s.by, uploadedAt: at, linkedTo: s.link, caption: s.caption,
    reviewStatus: rs, submittedBy: s.by, submittedAt: at, reviewVersion: 1,
    checkedBy: rs === "pending" ? undefined : s.checkedBy ?? "u_pm1", checkedAt: rs === "pending" ? undefined : d(s.daysAgo - 1),
  };
};

export const attachments: Attachment[] = [
  A({ p: "p1", name: "sango-roof-string-3.jpg", by: "u_ft1", daysAgo: 2, rs: "pending", caption: "String 3 mounted, 22 panels", gps: { lat: 6.687, lng: 3.235 }, link: { model: "Document", id: "site_log", label: "Daily site log" } }),
  A({ p: "p1", name: "sango-inverter-bay.jpg", by: "u_ft1", daysAgo: 2, rs: "pending", caption: "Inverter bay before cabling", gps: { lat: 6.687, lng: 3.235 } }),
  A({ p: "p1", name: "sango-delivery-panels.jpg", by: "u_sk", daysAgo: 38, checkedBy: "u_pm1", caption: "66 panels received, 0 damaged" }),
  A({ p: "p3", name: "benin-shed-a-roof.jpg", by: "u_ft2", daysAgo: 15, rs: "pending", caption: "Shed A roof, no obstructions", gps: { lat: 6.335, lng: 5.627 } }),
  A({ p: "p3", name: "benin-shed-b-roof.jpg", by: "u_ft2", daysAgo: 15, rs: "pending", caption: "Shed B roof, water tanks on east side", gps: { lat: 6.335, lng: 5.627 } }),
  A({ p: "p4", name: "de-residence-inverter-fault.jpg", by: "u_ft1", daysAgo: 1, rs: "pending", caption: "Inverter showing F23 — visit 2026-09-08", link: { model: "Issue", id: "iss-14", label: "Inverter fault F23" } }),
  A({ p: "p6", name: "ayobo-ct-ratio-plate.jpg", by: "u_le2", daysAgo: 82, checkedBy: "u_pm2", caption: "CT nameplate 1200/5 = ×240" }),
  A({ p: "p6", name: "ayobo-client-signoff.jpg", by: "u_pm2", daysAgo: 8, checkedBy: "u_le2", caption: "Signed acceptance form" }),
];

let eid = 0;
const E = (projectId: string, daysAgo: number, actorId: string, eventType: ChronologyEvent["eventType"], summary: string, detail?: string, hh = 10): ChronologyEvent =>
  ({ id: `ev${++eid}`, projectId, occurredAt: d(daysAgo, hh), actorId, eventType, summary, detail });

export const events: ChronologyEvent[] = [
  E("p1", 120, "u_pm1", "project_created", "Project created"),
  E("p1", 118, "u_dir", "approval_decided", "Gate 0 → 1 approved", "Proposal, sizing and ROI checked"),
  E("p1", 98, "u_le1", "approval_decided", "Gate 1 → 2 approved"),
  E("p1", 71, "u_fin", "approval_decided", "Gate 2 → 3 approved", "Lead Engineer + Finance"),
  E("p1", 44, "u_pm1", "po_raised", "PO-2026-031 raised — Deye SUN-50K inverter, ₦7.4M"),
  E("p1", 43, "u_fin", "po_approved", "PO-2026-031 approved by Finance — awaiting Director (≥ ₦5M)"),
  E("p1", 40, "u_fin", "approval_decided", "Gate 3 → 4 approved"),
  E("p1", 38, "u_sk", "delivery", "GRN — 66 panels received, serials logged"),
  E("p1", 9, "u_pm1", "document_added", "Daily site log — weeks 1–3 added"),
  E("p1", 8, "u_le1", "check_passed", "Checked: Daily site log — weeks 1–3"),
  E("p1", 4, "u_ft1", "document_added", "HSE checklist — weeks 1–3 submitted (pending check)"),
  E("p1", 2, "u_ft1", "attachment_added", "2 site photos uploaded (pending check)"),
  E("p1", 1, "u_pm1", "change_order", "Change order raised — +6 panels, ₦1.2M (awaiting Finance)"),
  E("p2", 110, "u_pm1", "project_created", "Project created"),
  E("p2", 52, "u_fin", "approval_decided", "Gate 2 → 3 approved"),
  E("p2", 3, "u_pm1", "document_added", "Procurement pack added — 9 POs, 9 GRNs"),
  E("p2", 2, "u_dir", "check_passed", "Checked: Procurement pack"),
  E("p2", 2, "u_sk", "document_added", "Serial register added", undefined, 14),
  E("p2", 1, "u_le2", "check_passed", "Checked: Serial register"),
  E("p2", 1, "u_pm1", "gate_requested", "Gate 3 → 4 approval requested", "All evidence checked", 15),
  E("p3", 45, "u_pm2", "project_created", "Project created"),
  E("p3", 43, "u_dir", "approval_decided", "Gate 0 → 1 approved"),
  E("p3", 16, "u_le1", "document_added", "Benin site survey report added"),
  E("p3", 15, "u_ft2", "attachment_added", "42 site photos uploaded (pending check)"),
  E("p3", 14, "u_le1", "document_added", "Roof assessment submitted"),
  E("p3", 13, "u_le2", "check_rejected", "Rejected: Roof assessment", "No m² available vs required — 1,500 panels need ~5,200 m²; no measurements or shading analysis."),
  E("p4", 300, "u_pm2", "project_created", "Project created"),
  E("p4", 190, "u_dir", "approval_decided", "Gate 6 → 7 approved — handover complete"),
  E("p4", 60, "u_le2", "issue_closed", "Snag list closed (4 items)"),
  E("p4", 1, "u_ft1", "visit", "Fault visit — inverter F23, 2.5 h, ₦38,000", "Parts: 1 × DC fuse. Photo pending check."),
  E("p5", 60, "u_pm1", "project_created", "Project created"),
  E("p5", 38, "u_le1", "approval_decided", "Gate 1 → 2 approved"),
  E("p5", 6, "u_pm1", "document_added", "LASG permit application submitted (pending check)"),
  E("p5", 4, "u_pm1", "note", "DISCO application still not filed — waiting on EKEDC form", undefined, 16),
  E("p6", 150, "u_pm2", "project_created", "Project created"),
  E("p6", 82, "u_le2", "document_added", "Commissioning record — CT ratio 240 verified, serials ASCII-clean"),
  E("p6", 80, "u_le2", "approval_decided", "Gate 5 → 6 approved — client witness recorded"),
  E("p6", 8, "u_pm2", "document_added", "Client acceptance, O&M manual, warranty pack added"),
  E("p6", 2, "u_le2", "document_added", "As-built drawings submitted (pending check)"),
  E("p7", 12, "u_pm1", "project_created", "Project created"),
  E("p7", 10, "u_pm1", "document_added", "Proposal v1 added"),
  E("p7", 9, "u_dir", "check_passed", "Checked: Proposal v1"),
  E("p7", 5, "u_le2", "document_added", "Sizing — 200 kWp submitted (pending check)"),
  E("p8", 700, "u_pm2", "project_created", "Project created"),
  E("p8", 160, "u_dir", "approval_decided", "Gate 7 → 8 approved — retention released, project closed"),
];

export const approvals: Approval[] = [
  { id: "ap1", projectId: "p2", kind: "gate", title: "Gate 3 → 4 · Procurement → Installation", description: "All gate-3 evidence checked: procurement pack (9 POs / 9 GRNs), serial register.",
    requestedBy: "u_pm1", requestedAt: d(1, 15), requiredRoles: ["finance"], decisions: [], status: "pending", targetStage: 4 },
  { id: "ap2", projectId: "p1", kind: "po", title: "PO-2026-031 · Deye SUN-50K inverter", description: "1 × Deye SUN-50K-SG01HP3 hybrid inverter from Fouani Nigeria Ltd. ≥ ₦5M → Finance + Director.",
    requestedBy: "u_pm1", requestedAt: d(44), requiredRoles: ["finance", "director"], amount: 7_400_000,
    decisions: [{ approverId: "u_fin", role: "finance", decision: "approved", at: d(43), comment: "Within budget line EQ-02" }], status: "pending" },
  { id: "ap3", projectId: "p1", kind: "change_order", title: "CO-04 · +6 panels (roof edge row)", description: "Client requested extra row; +6 × 615W, +₦1.2M, +2 days. Below ₦2M and 10% → Finance only.",
    requestedBy: "u_pm1", requestedAt: d(1, 9), requiredRoles: ["finance"], amount: 1_200_000, decisions: [], status: "pending" },
  { id: "ap4", projectId: "p5", kind: "gate", title: "Gate 1 → 2 · Survey → Design", description: "Survey, roof assessment, structural cert, load audit, photos — all checked.",
    requestedBy: "u_pm1", requestedAt: d(39), requiredRoles: ["lead_engineer"],
    decisions: [{ approverId: "u_le1", role: "lead_engineer", decision: "approved", at: d(38) }], status: "approved", targetStage: 2 },
  { id: "ap5", projectId: "p6", kind: "gate", title: "Gate 6 → 7 · Handover → O&M", description: "Acceptance, O&M manual, warranty pack checked. As-built and final account still outstanding.",
    requestedBy: "u_pm2", requestedAt: d(3), requiredRoles: ["director"],
    decisions: [{ approverId: "u_dir", role: "director", decision: "rejected", at: d(2), comment: "As-built drawings not yet checked and no final account. Resubmit when gate evidence is complete." }], status: "rejected", targetStage: 7 },
];

export const thresholds: Threshold[] = [
  { key: "po.director_threshold", label: "PO — Director co-approval from", value: 5_000_000, unit: "NGN", effectiveFrom: "2026-09-01", updatedBy: "u_admin" },
  { key: "co.director_threshold", label: "Change order — Director co-approval from", value: 2_000_000, unit: "NGN", effectiveFrom: "2026-09-01", updatedBy: "u_admin" },
  { key: "co.director_pct", label: "Change order — Director co-approval from (% of contract)", value: 10, unit: "%", effectiveFrom: "2026-09-01", updatedBy: "u_admin" },
  { key: "sla.critical", label: "Issue SLA — critical", value: 24, unit: "h", effectiveFrom: "2026-09-01", updatedBy: "u_admin" },
  { key: "sla.high", label: "Issue SLA — high", value: 72, unit: "h", effectiveFrom: "2026-09-01", updatedBy: "u_admin" },
  { key: "sla.medium", label: "Issue SLA — medium", value: 7, unit: "d", effectiveFrom: "2026-09-01", updatedBy: "u_admin" },
  { key: "sla.low", label: "Issue SLA — low", value: 30, unit: "d", effectiveFrom: "2026-09-01", updatedBy: "u_admin" },
  { key: "retention.percent", label: "Retention", value: 5, unit: "%", effectiveFrom: "2026-09-01", updatedBy: "u_admin" },
  { key: "dlp.months", label: "Defects-liability period", value: 12, unit: "months", effectiveFrom: "2026-09-01", updatedBy: "u_admin" },
  { key: "writeoff.director_threshold", label: "Write-off — Director co-approval from", value: 500_000, unit: "NGN", effectiveFrom: "2026-09-01", updatedBy: "u_admin" },
  { key: "stockcount.tolerance_pct", label: "Stock-count variance tolerance", value: 2, unit: "%", effectiveFrom: "2026-09-01", updatedBy: "u_admin" },
  { key: "check.escalation_days", label: "Pending check escalation after", value: 3, unit: "working days", effectiveFrom: "2026-09-01", updatedBy: "u_admin" },
  { key: "media.retention_years", label: "Record retention after project life", value: 7, unit: "years", effectiveFrom: "2026-09-01", updatedBy: "u_admin" },
];
