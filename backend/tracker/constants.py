"""Labels and templates — mirror packages/api/src/types.ts so summaries and generated titles match the web app."""
from __future__ import annotations

# Six roles, and people stack them: a User has many Roles and `can()` unions their permissions, so one
# person can be techlead + finance without a combined role existing. That is why these stay narrow —
# admin folded into director (2026-09-19), and pm + lead_engineer became the single techlead.
ROLE_CODES = ["director", "techlead", "tech", "finance", "store_keeper", "auditor"]
ROLE_LABEL = {
    "director": "Director", "techlead": "Tech Lead", "tech": "Tech",
    "finance": "Finance", "store_keeper": "Store Keeper", "auditor": "Auditor",
}
GLOBAL_ROLES = ["director", "finance", "store_keeper", "auditor"]

PROJECT_TYPE_LABEL = {
    "solar_battery": "Solar + Battery", "gen_rightsizing": "Generator Right-sizing", "ems": "EMS",
    "pf_correction": "Power-factor Correction", "metering": "Metering",
}

DOC_TYPE_LABEL = {
    "proposal": "Signed proposal", "sizing": "Sizing document", "roi_model": "ROI model",
    "survey": "Survey report", "roof_assessment": "Roof / space assessment", "structural_cert": "Structural certificate",
    "load_audit": "Load audit", "site_photos": "Site photos",
    "sld": "Single-line diagram", "bom": "Bill of materials", "permit": "Permits", "disco_approval": "DISCO application / approval",
    "insurance": "Insurance policy",
    "procurement_pack": "Procurement pack (PO → GRN → receipts)", "serial_register": "Serial register",
    "site_log": "Daily site log", "hse_checklist": "HSE checklist", "progress_photos": "Progress photos", "variation_register": "Variations approved",
    "commissioning_record": "Commissioning record", "client_witness": "Client witness sign-off", "commissioning_photos": "Commissioning photos",
    "meter_integrity": "Meter data-integrity checks",
    "acceptance": "Client acceptance", "om_manual": "O&M manual", "warranty": "Warranty pack", "as_built": "As-built drawings", "final_account": "Final account",
    "dlp_release": "DLP release", "snag_list": "Snag list closed", "retention_release": "Retention release", "final_reconciliation": "Final reconciliation",
    "contract": "Contract", "other": "Other",
}

COST_CATEGORIES = ["equipment", "civil", "labour", "logistics", "permits", "contingency", "om"]
COST_CATEGORY_LABEL = {
    "equipment": "Equipment", "civil": "Civil & structural", "labour": "Labour & install", "logistics": "Logistics",
    "permits": "Permits & approvals", "contingency": "Contingency", "om": "O&M",
}
MOVEMENT_LABEL = {
    "receipt": "Receipt", "issue": "Issue to project", "return": "Return from site", "transfer": "Transfer",
    "adjustment": "Adjustment", "write_off": "Write-off",
}
ASSET_TYPES = ["panel", "inverter", "battery", "meter", "ct", "ats", "cable", "mounting", "other"]
VISIT_TYPE_LABEL = {
    "routine": "Routine maintenance", "fault": "Fault call-out", "warranty": "Warranty", "inspection": "Inspection",
    "upgrade": "Upgrade", "commissioning": "Commissioning",
}
HSE_TYPE_LABEL = {"near_miss": "Near miss", "injury": "Injury", "property": "Property damage", "environmental": "Environmental"}
ISSUE_SEVERITIES = ["critical", "high", "medium", "low"]
ISSUE_OPEN_STATUSES = ["open", "in_progress", "awaiting_parts", "resolved"]

COMMISSIONING_TEMPLATE = [
    {"key": "insulation_resistance", "label": "Insulation resistance (DC strings)", "unit": "MΩ"},
    {"key": "earth_resistance", "label": "Earth resistance", "unit": "Ω"},
    {"key": "string_voc", "label": "String Voc per string", "unit": "V"},
    {"key": "string_isc", "label": "String Isc per string", "unit": "A"},
    {"key": "inverter_config", "label": "Inverter firmware / configuration"},
    {"key": "battery_bms", "label": "Battery SoC / BMS communication"},
    {"key": "ats_changeover", "label": "ATS changeover test"},
    {"key": "meter_ct_ratio", "label": "Meter CT ratio verified against live reading"},
    {"key": "first_live_reading", "label": "First live reading received on platform"},
    {"key": "labelling", "label": "Labelling & signage"},
    {"key": "fire_suppression", "label": "Fire suppression present & tagged"},
    {"key": "hse_walkdown", "label": "HSE walk-down complete"},
]

DEFAULT_THRESHOLDS = [
    ("po.director_threshold", "PO — Director co-approval from", 5_000_000, "NGN"),
    ("co.director_threshold", "Change order — Director co-approval from", 2_000_000, "NGN"),
    ("co.director_pct", "Change order — Director co-approval from (% of contract)", 10, "%"),
    ("sla.critical", "Issue SLA — critical", 24, "h"),
    ("sla.high", "Issue SLA — high", 72, "h"),
    ("sla.medium", "Issue SLA — medium", 7, "d"),
    ("sla.low", "Issue SLA — low", 30, "d"),
    ("retention.percent", "Retention", 5, "%"),
    ("dlp.months", "Defects-liability period", 12, "months"),
    ("writeoff.director_threshold", "Write-off — Director co-approval from", 500_000, "NGN"),
    ("stockcount.tolerance_pct", "Stock-count variance tolerance", 2, "%"),
    ("check.escalation_days", "Pending check escalation after", 3, "working days"),
]
