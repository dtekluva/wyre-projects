"""Demo data — a faithful port of packages/api/src/mock/data*.ts so the web app looks identical on the real backend.
Never run this against production data; use --reset to wipe tracker rows first."""
from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta, timezone as tz
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from tracker.constants import COMMISSIONING_TEMPLATE
from tracker.management.commands.seed_rbac import seed_rbac
from tracker.models import (Actual, Approval, Asset, Attachment, ChangeOrder, ChronologyEvent, CommissioningRecord, CostItem, Document, GoodsReceipt, HseIncident,
                            InventoryItem, Issue, Project, ProjectMembership, PurchaseItem, PurchaseOrder, QbBill, Retention, Role, SiteVisit, StockCount, StockLocation,
                            StockMovement, User, Vendor, WarrantyClaim)

LAGOS = tz(timedelta(hours=1))
NOW = datetime(2026, 9, 9, 10, 0, tzinfo=LAGOS)
DEMO_PASSWORD = "wyre-demo-2026"


def d(days_ago: int, hh: int = 9, mm: int = 0) -> datetime:
    t = NOW - timedelta(days=days_ago)
    return t.replace(hour=hh, minute=mm, second=0, microsecond=0)


def ahead(days: int) -> str:
    return (NOW + timedelta(days=days)).date().isoformat()


def hrs(t: datetime, h: float) -> datetime:
    return t + timedelta(hours=h)


def iso(t: datetime) -> str:
    return t.astimezone(tz.utc).isoformat().replace("+00:00", "Z")


def add_months(dt: date, months: int) -> date:
    m = dt.month - 1 + months; y = dt.year + m // 12; m = m % 12 + 1
    return date(y, m, min(dt.day, calendar.monthrange(y, m)[1]))


USERS = [("u_admin", "Ada Okafor", ["director"]), ("u_dir", "Tunde Bakare", ["director"]), ("u_fin", "Ngozi Eze", ["finance"]), ("u_pm1", "Kunle Adebayo", ["techlead"]),
         ("u_pm2", "Bola Adeyemi", ["techlead"]), ("u_le1", "Chidi Okoro", ["techlead"]), ("u_le2", "Amaka Obi", ["techlead"]), ("u_ft1", "Segun Alabi", ["tech"]),
         ("u_ft2", "Yusuf Danladi", ["tech"]), ("u_sk", "Musa Ibrahim", ["store_keeper"]), ("u_aud", "Funke Ojo", ["auditor"])]

PROJECTS = [
    dict(id="p1", code="WYR-2026-001", name="Sweet Sensation Sango — Solar + Battery", client="Sweet Sensation", branch="Sango", location="Sango-Ota, Ogun", type="solar_battery", kwp="40.6",
         stage=4, rag="amber", reason="Gate 4 evidence outstanding · 6 days behind plan", pm="u_pm1", le="u_le1", contract=59_329_250, budget=51_000_000, committed=44_200_000, actual=31_850_000,
         planned={"4": ahead(-6), "5": ahead(12), "6": ahead(26)}, actual_dates={"0": d(120), "1": d(98), "2": d(71), "3": d(40)}, by="u_pm1", created=120),
    dict(id="p2", code="WYR-2026-002", name="Sweet Sensation Ojodu — Solar + Battery", client="Sweet Sensation", branch="Ojodu", location="Ojodu, Lagos", type="solar_battery", kwp="135.3",
         stage=3, rag="green", reason=None, pm="u_pm1", le="u_le2", contract=123_517_500, budget=106_000_000, committed=98_400_000, actual=61_300_000,
         planned={"3": ahead(2), "4": ahead(30), "5": ahead(58)}, actual_dates={"0": d(110), "1": d(88), "2": d(52)}, by="u_pm1", created=110),
    dict(id="p3", code="WYR-2026-003", name="Iya Rubbie Rubber Factory — 922.5 kWp Hybrid", client="Iya Rubbie", branch="Benin City", location="Benin City, Edo", type="solar_battery", kwp="922.5",
         stage=1, rag="red", reason="Roof / space assessment rejected — no m² available vs required", pm="u_pm2", le="u_le1", contract=760_000_000, budget=700_000_000, committed=0, actual=4_200_000,
         planned={"1": ahead(-9), "2": ahead(20), "3": ahead(48)}, actual_dates={"0": d(45)}, by="u_pm2", created=45),
    dict(id="p4", code="WYR-2025-014", name="D. E. Residence — 15 kWp Solar + Battery", client="Mr Durosinmi Etti", branch="D. E. Residence", location="Lekki, Lagos", type="solar_battery", kwp="15",
         stage=7, rag="green", reason=None, pm="u_pm2", le="u_le2", contract=18_400_000, budget=15_900_000, committed=15_900_000, actual=16_120_000,
         planned={"8": ahead(190)}, actual_dates={"0": d(300), "1": d(280), "2": d(260), "3": d(240), "4": d(215), "5": d(200), "6": d(190), "7": d(190)}, dlp=ahead(175), by="u_pm2", created=300),
    dict(id="p5", code="WYR-2026-004", name="Bright Spot Glover Road — 30 kWp Solar", client="Bright Spot", branch="Glover Road", location="Ikoyi, Lagos", type="solar_battery", kwp="30",
         stage=2, rag="amber", reason="DISCO application not yet filed · 4 days behind plan", pm="u_pm1", le="u_le1", contract=42_000_000, budget=36_500_000, committed=2_100_000, actual=1_650_000,
         planned={"2": ahead(-4), "3": ahead(18)}, actual_dates={"0": d(60), "1": d(38)}, by="u_pm1", created=60),
    dict(id="p6", code="WYR-2025-011", name="Access Bank Ayobo 2 — Metering & Gen Right-sizing", client="Access", branch="Access Ayobo 2", location="Ayobo, Lagos", type="gen_rightsizing", kwp=None,
         stage=6, rag="green", reason=None, pm="u_pm2", le="u_le2", contract=9_500_000, budget=8_100_000, committed=8_100_000, actual=7_920_000,
         planned={"6": ahead(5), "7": ahead(5)}, actual_dates={"0": d(150), "1": d(140), "2": d(128), "3": d(110), "4": d(95), "5": d(80)}, by="u_pm2", created=150),
    dict(id="p7", code="WYR-2026-005", name="Edic Chemicals — 200 kWp Solar + Battery", client="Alpha Mead", branch="Edic Chemicals", location="Ikeja, Lagos", type="solar_battery", kwp="200",
         stage=0, rag="green", reason=None, pm="u_pm1", le="u_le2", contract=210_000_000, budget=0, committed=0, actual=0, planned={"0": ahead(10), "1": ahead(30)}, actual_dates={}, by="u_pm1", created=12),
    dict(id="p8", code="WYR-2024-007", name="Meadow Hall School — 80 kWp Solar", client="Meadow Hall", branch="Meadow Hall School", location="Lekki, Lagos", type="solar_battery", kwp="80",
         stage=8, rag="green", reason=None, pm="u_pm2", le="u_le1", contract=68_000_000, budget=58_500_000, committed=58_500_000, actual=57_900_000, planned={},
         actual_dates={"0": d(700), "1": d(680), "2": d(650), "3": d(620), "4": d(590), "5": d(575), "6": d(560), "7": d(560), "8": d(160)}, by="u_pm2", created=700),
]
MEMBERSHIPS = [("p1", "u_pm1", "techlead"), ("p1", "u_le1", "techlead"), ("p1", "u_ft1", "tech"), ("p2", "u_pm1", "techlead"), ("p2", "u_le2", "techlead"), ("p2", "u_ft1", "tech"),
               ("p2", "u_ft2", "tech"), ("p3", "u_pm2", "techlead"), ("p3", "u_le1", "techlead"), ("p3", "u_ft2", "tech"), ("p4", "u_pm2", "techlead"), ("p4", "u_le2", "techlead"),
               ("p4", "u_ft1", "tech"), ("p5", "u_pm1", "techlead"), ("p5", "u_le1", "techlead"), ("p5", "u_ft2", "tech"), ("p6", "u_pm2", "techlead"), ("p6", "u_le2", "techlead"),
               ("p6", "u_ft1", "tech"), ("p7", "u_pm1", "techlead"), ("p7", "u_le2", "techlead"), ("p8", "u_pm2", "techlead"), ("p8", "u_le1", "techlead")]

# (project, docType, title, by, daysAgo, rs, checkedBy, comment, expires, issuer)
DOCS = [
    ("p1", "proposal", "Sango signed proposal", "u_pm1", 120, None, "u_dir"), ("p1", "sizing", "Sango sizing — 66 × 615W, 50 kVA, 7 × 16 kWh", "u_le1", 119, None, "u_dir"),
    ("p1", "roi_model", "Sango ROI model", "u_pm1", 118, None, "u_dir"), ("p1", "survey", "Sango site survey report", "u_le1", 100, None, "u_le2"),
    ("p1", "roof_assessment", "Sango roof assessment — 215 m² usable", "u_le1", 100, None, "u_le2"), ("p1", "structural_cert", "Structural certificate — Sango", "u_pm1", 99, None, None, None, None, "Adekunle & Partners"),
    ("p1", "load_audit", "Sango load audit", "u_le1", 99, None, "u_le2"), ("p1", "site_photos", "Sango survey photos (18)", "u_ft1", 100), ("p1", "sld", "Sango SLD rev B", "u_le1", 74, None, "u_le2"),
    ("p1", "bom", "Sango BOM", "u_le1", 74, None, "u_le2"), ("p1", "permit", "Ogun State building permit", "u_pm1", 73), ("p1", "disco_approval", "IBEDC behind-the-meter approval", "u_pm1", 72, None, None, None, None, "IBEDC"),
    ("p1", "insurance", "All-risk policy — Sango", "u_pm1", 72, None, None, None, ahead(293), "Leadway"), ("p1", "procurement_pack", "Sango procurement pack", "u_pm1", 42, None, "u_dir"),
    ("p1", "serial_register", "Sango serial register (66 panels, 1 inverter, 7 batteries)", "u_sk", 41), ("p1", "site_log", "Daily site log — weeks 1–3", "u_pm1", 9),
    ("p1", "hse_checklist", "HSE checklist — weeks 1–3", "u_ft1", 4, "pending"),
    ("p2", "proposal", "Ojodu signed proposal", "u_pm1", 110, None, "u_dir"), ("p2", "sizing", "Ojodu sizing — 220 × 615W, 2 × 80 kVA, 11 × 16 kWh", "u_le2", 109, None, "u_dir"),
    ("p2", "roi_model", "Ojodu ROI model", "u_pm1", 109, None, "u_dir"), ("p2", "survey", "Ojodu site survey", "u_le2", 90), ("p2", "roof_assessment", "Ojodu roof assessment — 640 m² usable", "u_le2", 90),
    ("p2", "structural_cert", "Structural certificate — Ojodu", "u_pm1", 89), ("p2", "load_audit", "Ojodu load audit", "u_le2", 89), ("p2", "site_photos", "Ojodu survey photos (31)", "u_ft1", 90),
    ("p2", "sld", "Ojodu SLD rev C", "u_le2", 55), ("p2", "bom", "Ojodu BOM", "u_le2", 55), ("p2", "permit", "Lagos State permit — Ojodu", "u_pm1", 54),
    ("p2", "disco_approval", "IKEDC approval", "u_pm1", 53, None, None, None, None, "IKEDC"), ("p2", "insurance", "All-risk policy — Ojodu", "u_pm1", 53, None, None, None, ahead(312)),
    ("p2", "procurement_pack", "Ojodu procurement pack — 9 POs, 9 GRNs", "u_pm1", 3, None, "u_dir"), ("p2", "serial_register", "Ojodu serial register", "u_sk", 2, None, "u_le2"),
    ("p3", "proposal", "Iya Rubbie proposal Rev 02", "u_pm2", 45, None, "u_dir"), ("p3", "sizing", "Iya Rubbie sizing — 1,500 × 615W, 5 × SUN-125K, 4 × GB-W192", "u_le1", 45, None, "u_dir"),
    ("p3", "roi_model", "Iya Rubbie ROI — 1.42 yr payback", "u_pm2", 44, None, "u_dir"), ("p3", "survey", "Benin site survey report", "u_le1", 16, None, "u_le2"),
    ("p3", "roof_assessment", "Roof assessment — 3 production sheds", "u_le1", 14, "rejected", "u_le2", "No m² available vs required. 1,500 panels need ~5,200 m² incl. row spacing; report lists sheds but no measurements or shading."),
    ("p3", "load_audit", "Load audit — 15 machines, Banbury inrush", "u_le1", 15, None, "u_le2"), ("p3", "site_photos", "Benin site photos (42)", "u_ft2", 15, "pending"),
    ("p4", "acceptance", "Client acceptance — D. E. Residence", "u_pm2", 190, None, "u_dir"), ("p4", "warranty", "Warranty pack", "u_pm2", 190), ("p4", "snag_list", "Snag list — 4 items closed", "u_le2", 60),
    ("p5", "proposal", "Bright Spot proposal", "u_pm1", 60, None, "u_dir"), ("p5", "sizing", "Bright Spot sizing — 30 kWp", "u_le1", 60, None, "u_dir"), ("p5", "roi_model", "Bright Spot ROI", "u_pm1", 59, None, "u_dir"),
    ("p5", "survey", "Glover Road survey", "u_le1", 40), ("p5", "roof_assessment", "Glover Road roof — 160 m²", "u_le1", 40), ("p5", "structural_cert", "Structural cert — Glover Road", "u_pm1", 39),
    ("p5", "load_audit", "Glover Road load audit (Apr data)", "u_le1", 39), ("p5", "site_photos", "Glover Road photos (12)", "u_ft2", 40), ("p5", "sld", "Glover Road SLD", "u_le1", 20),
    ("p5", "bom", "Glover Road BOM", "u_le1", 20), ("p5", "permit", "LASG permit application", "u_pm1", 6, "pending"),
    ("p6", "commissioning_record", "Commissioning record — CT 240 verified, serials ASCII-clean", "u_le2", 82), ("p6", "meter_integrity", "Meter integrity — 25062405300051 / 300150", "u_le2", 82),
    ("p6", "acceptance", "Client acceptance — Access Ayobo 2", "u_pm2", 8, None, "u_dir"), ("p6", "om_manual", "O&M manual", "u_pm2", 8), ("p6", "warranty", "Warranty pack", "u_pm2", 8),
    ("p6", "as_built", "As-built drawings", "u_le2", 2, "pending"),
    ("p7", "proposal", "Edic Chemicals proposal v1", "u_pm1", 10, None, "u_dir"), ("p7", "sizing", "Edic sizing — 200 kWp", "u_le2", 5, "pending"),
    ("p8", "final_reconciliation", "Final reconciliation", "u_pm2", 162, None, "u_dir"), ("p8", "retention_release", "Retention release ₦3.4M", "u_pm2", 162, None, "u_dir"),
]
EVENTS = [
    ("p1", 120, "u_pm1", "project_created", "Project created"), ("p1", 118, "u_dir", "approval_decided", "Gate 0 → 1 approved", "Proposal, sizing and ROI checked"),
    ("p1", 98, "u_le1", "approval_decided", "Gate 1 → 2 approved"), ("p1", 71, "u_fin", "approval_decided", "Gate 2 → 3 approved", "Lead Engineer + Finance"),
    ("p1", 44, "u_pm1", "po_raised", "PO-2026-031 raised — Deye SUN-50K inverter, ₦7.4M"), ("p1", 43, "u_fin", "po_approved", "PO-2026-031 approved by Finance — awaiting Director (≥ ₦5M)"),
    ("p1", 40, "u_fin", "approval_decided", "Gate 3 → 4 approved"), ("p1", 38, "u_sk", "delivery", "GRN — 66 panels received, serials logged"),
    ("p1", 9, "u_pm1", "document_added", "Daily site log — weeks 1–3 added"), ("p1", 8, "u_le1", "check_passed", "Checked: Daily site log — weeks 1–3"),
    ("p1", 4, "u_ft1", "document_added", "HSE checklist — weeks 1–3 submitted (pending check)"), ("p1", 2, "u_ft1", "attachment_added", "2 site photos uploaded (pending check)"),
    ("p1", 1, "u_pm1", "change_order", "Change order raised — +6 panels, ₦1.2M (awaiting Finance)"),
    ("p2", 110, "u_pm1", "project_created", "Project created"), ("p2", 52, "u_fin", "approval_decided", "Gate 2 → 3 approved"), ("p2", 3, "u_pm1", "document_added", "Procurement pack added — 9 POs, 9 GRNs"),
    ("p2", 2, "u_dir", "check_passed", "Checked: Procurement pack"), ("p2", 2, "u_sk", "document_added", "Serial register added", None, 14), ("p2", 1, "u_le2", "check_passed", "Checked: Serial register"),
    ("p2", 1, "u_pm1", "gate_requested", "Gate 3 → 4 approval requested", "All evidence checked", 15),
    ("p3", 45, "u_pm2", "project_created", "Project created"), ("p3", 43, "u_dir", "approval_decided", "Gate 0 → 1 approved"), ("p3", 16, "u_le1", "document_added", "Benin site survey report added"),
    ("p3", 15, "u_ft2", "attachment_added", "42 site photos uploaded (pending check)"), ("p3", 14, "u_le1", "document_added", "Roof assessment submitted"),
    ("p3", 13, "u_le2", "check_rejected", "Rejected: Roof assessment", "No m² available vs required — 1,500 panels need ~5,200 m²; no measurements or shading analysis."),
    ("p4", 300, "u_pm2", "project_created", "Project created"), ("p4", 190, "u_dir", "approval_decided", "Gate 6 → 7 approved — handover complete"), ("p4", 60, "u_le2", "issue_closed", "Snag list closed (4 items)"),
    ("p4", 1, "u_ft1", "visit", "Fault visit — inverter F23, 2.5 h, ₦38,000", "Parts: 1 × DC fuse. Photo pending check."),
    ("p5", 60, "u_pm1", "project_created", "Project created"), ("p5", 38, "u_le1", "approval_decided", "Gate 1 → 2 approved"), ("p5", 6, "u_pm1", "document_added", "LASG permit application submitted (pending check)"),
    ("p5", 4, "u_pm1", "note", "DISCO application still not filed — waiting on EKEDC form", None, 16),
    ("p6", 150, "u_pm2", "project_created", "Project created"), ("p6", 82, "u_le2", "document_added", "Commissioning record — CT ratio 240 verified, serials ASCII-clean"),
    ("p6", 80, "u_le2", "approval_decided", "Gate 5 → 6 approved — client witness recorded"), ("p6", 8, "u_pm2", "document_added", "Client acceptance, O&M manual, warranty pack added"),
    ("p6", 2, "u_le2", "document_added", "As-built drawings submitted (pending check)"),
    ("p7", 12, "u_pm1", "project_created", "Project created"), ("p7", 10, "u_pm1", "document_added", "Proposal v1 added"), ("p7", 9, "u_dir", "check_passed", "Checked: Proposal v1"),
    ("p7", 5, "u_le2", "document_added", "Sizing — 200 kWp submitted (pending check)"),
    ("p8", 700, "u_pm2", "project_created", "Project created"), ("p8", 160, "u_dir", "approval_decided", "Gate 7 → 8 approved — retention released, project closed"),
]
VENDORS = [("v_solarmax", "Solarmax Global Multi Concept", "Panels"), ("v_fouani", "Fouani Nigeria Ltd", "Inverters & batteries"), ("v_bluecarbon", "Blue Carbon Tech", "Batteries"),
           ("v_acrel", "Acrel Electrical Manufacturing", "Metering"), ("v_dixsen", "Zhejiang Dixsen Electrical", "Switchgear"), ("v_adekunle", "Adekunle & Partners", "Civil / structural"),
           ("v_freight", "Lagos Freight Co", "Logistics"), ("v_consult", "Gridwise Consulting", "Engineering services")]
ITEMS = [  # id, sku, name, category, unit, serialised, reorderLevel, reorderQty, vendor, make, model, warrantyMonths
    ("it_panel", "JKM-615", "Jinko Tiger Neo 615W panel", "panel", "pcs", True, 40, 100, "v_solarmax", "Jinko", "JKM615N-78HL4-V", 144),
    ("it_inv50", "DEYE-50K", "Deye SUN-50K hybrid inverter", "inverter", "pcs", True, 1, 2, "v_fouani", "Deye", "SUN-50K-SG01HP3", 120),
    ("it_inv80", "DEYE-80K", "Deye SUN-80K hybrid inverter", "inverter", "pcs", True, 0, 2, "v_fouani", "Deye", "SUN-80K-SG01HP3", 120),
    ("it_bat16", "DEYE-BAT16", "Deye 16 kWh LFP battery", "battery", "pcs", True, 2, 4, "v_fouani", "Deye", "SE-G5.3 ×3", 120),
    ("it_meter", "AWT200", "Acrel AWT200 energy meter", "meter", "pcs", True, 5, 10, "v_acrel", "Acrel", "AWT200", 24),
    ("it_ct", "CT-1200-5", "Current transformer 1200/5 A", "ct", "pcs", False, 6, 12, "v_acrel", None, None, None),
    ("it_cable", "DC-6MM", "DC solar cable 6 mm²", "cable", "m", False, 500, 1000, "v_dixsen", None, None, None),
    ("it_mc4", "MC4", "MC4 connector pair", "consumable", "pcs", False, 100, 200, "v_dixsen", None, None, None),
    ("it_rail", "RAIL-4M", "Aluminium mounting rail 4.2 m", "mounting", "pcs", False, 40, 80, "v_dixsen", None, None, None),
    ("it_mccb", "MCCB-250", "Schneider NSX 250A MCCB", "other", "pcs", False, 2, 4, "v_dixsen", None, None, None),
    ("it_fuse", "DCFUSE-15", "DC fuse 15 A", "consumable", "pcs", False, 20, 50, "v_dixsen", None, None, None),
]
BUDGET = {"p1": 51_000_000, "p2": 106_000_000, "p3": 700_000_000, "p4": 15_900_000, "p5": 36_500_000, "p6": 8_100_000, "p8": 58_500_000}
SPLIT = [("equipment", 0.72), ("civil", 0.08), ("labour", 0.1), ("logistics", 0.04), ("permits", 0.02), ("contingency", 0.04)]


def serials(prefix: str, start: int, n: int) -> list[str]:
    return [f"{prefix}{start + i:04d}" for i in range(n)]


class Seeder:
    def __init__(self, password: str):
        self.password = password
        self.att_n = 300; self.mv_n = 0; self.act_n = 0; self.as_n = 0

    def u(self, uid: str) -> User:
        return self.users[uid]

    # ------------------------------------------------------------- phase 1
    def users_and_projects(self):
        self.users = {}
        for uid, name, roles in USERS:
            username = name.lower().replace(" ", ".")
            user, _ = User.objects.get_or_create(id=uid, defaults={"username": username, "name": name, "email": f"{username}@wyreng.com", "is_staff": "director" in roles, "is_superuser": "director" in roles})
            user.name = name; user.username = username; user.set_password(self.password); user.save()
            user.roles.set(Role.objects.filter(code__in=roles)); self.users[uid] = user
        for p in PROJECTS:
            at = d(p["created"])
            Project.objects.create(id=p["id"], code=p["code"], name=p["name"], client_name=p["client"], branch_name=p["branch"], location=p["location"], project_type=p["type"],
                                   system_capacity_kwp=Decimal(p["kwp"]) if p["kwp"] else None, stage=p["stage"], rag=p["rag"], rag_reason=p["reason"], pm=self.u(p["pm"]), lead_engineer=self.u(p["le"]),
                                   contract_value=p["contract"], approved_budget=p["budget"], committed=p["committed"], actual=p["actual"], stage_planned=p["planned"],
                                   stage_actual={k: iso(v) for k, v in p["actual_dates"].items()}, defects_liability_end=p.get("dlp"), retention_percent=5,
                                   created_at=at, created_by=self.u(p["by"]), updated_at=at, updated_by=self.u(p["by"]))
        for i, (pid, uid, role) in enumerate(MEMBERSHIPS, 1):
            ProjectMembership.objects.create(id=f"m{i}", project_id=pid, user=self.u(uid), role=role, granted_by=self.u("u_admin"), granted_at=d(100))
        for i, row in enumerate(DOCS, 1):
            pid, t, title, by, days = row[:5]; rs = (row[5] if len(row) > 5 else None) or "checked"; checked_by = (row[6] if len(row) > 6 else None) or "u_le1"
            comment = row[7] if len(row) > 7 else None; expires = row[8] if len(row) > 8 else None; issuer = row[9] if len(row) > 9 else None
            at = d(days)
            Document.objects.create(id=f"doc{i}", project_id=pid, doc_type=t, title=title, status="approved" if rs == "checked" else "submitted", issued_at=at, expires_at=expires, issuer=issuer,
                                    version=1, file_name="".join(c if c.isalnum() else "-" for c in title.lower()).strip("-") + ".pdf", size_bytes=240_000 + (i * 37_000) % 900_000,
                                    created_at=at, created_by=self.u(by), updated_at=at, updated_by=self.u(by), review_status=rs, submitted_by=self.u(by), submitted_at=at, review_version=1,
                                    checked_by=None if rs == "pending" else self.u(checked_by), checked_at=None if rs == "pending" else d(days - 1), check_comment=comment)
        atts = [("p1", "sango-roof-string-3.jpg", "u_ft1", 2, "pending", None, "String 3 mounted, 22 panels", {"lat": 6.687, "lng": 3.235}, {"model": "Document", "id": "site_log", "label": "Daily site log"}),
                ("p1", "sango-inverter-bay.jpg", "u_ft1", 2, "pending", None, "Inverter bay before cabling", {"lat": 6.687, "lng": 3.235}, None),
                ("p1", "sango-delivery-panels.jpg", "u_sk", 38, "checked", "u_pm1", "66 panels received, 0 damaged", None, None),
                ("p3", "benin-shed-a-roof.jpg", "u_ft2", 15, "pending", None, "Shed A roof, no obstructions", {"lat": 6.335, "lng": 5.627}, None),
                ("p3", "benin-shed-b-roof.jpg", "u_ft2", 15, "pending", None, "Shed B roof, water tanks on east side", {"lat": 6.335, "lng": 5.627}, None),
                ("p4", "de-residence-inverter-fault.jpg", "u_ft1", 1, "pending", None, "Inverter showing F23 — visit 2026-09-08", None, {"model": "Issue", "id": "iss-14", "label": "Inverter fault F23"}),
                ("p6", "ayobo-ct-ratio-plate.jpg", "u_le2", 82, "checked", "u_pm2", "CT nameplate 1200/5 = ×240", None, None),
                ("p6", "ayobo-client-signoff.jpg", "u_pm2", 8, "checked", "u_le2", "Signed acceptance form", None, None)]
        for i, (pid, name, by, days, rs, cb, caption, gps, link) in enumerate(atts, 1):
            at = d(days, 11, 30)
            Attachment.objects.create(id=f"att{i}", project_id=pid, file_name=name, mime="image/jpeg", size_bytes=1_800_000 + (i * 131_000) % 2_400_000, kind="image", captured_at=at, gps=gps,
                                      sha256=("e3b0c442" + format(i * 2654435761, "x")).ljust(64, "0")[:64], uploaded_by=self.u(by), uploaded_at=at, linked_to=link, caption=caption,
                                      review_status=rs, submitted_by=self.u(by), submitted_at=at, review_version=1, checked_by=None if rs == "pending" else self.u(cb or "u_pm1"), checked_at=None if rs == "pending" else d(days - 1))
        for i, row in enumerate(EVENTS, 1):
            pid, days, actor, et, summary = row[:5]; detail = row[5] if len(row) > 5 else None; hh = row[6] if len(row) > 6 else 10
            ChronologyEvent.objects.create(id=f"ev{i}", project_id=pid, occurred_at=d(days, hh), actor=self.u(actor), event_type=et, summary=summary, detail=detail)
        A = Approval.objects.create
        A(id="ap1", project_id="p2", kind="gate", title="Gate 3 → 4 · Procurement → Installation", description="All gate-3 evidence checked: procurement pack (9 POs / 9 GRNs), serial register.",
          requested_by=self.u("u_pm1"), requested_at=d(1, 15), required_roles=["finance"], decisions=[], status="pending", target_stage=4)
        A(id="ap2", project_id="p1", kind="po", title="PO-2026-031 · Deye SUN-50K inverter", description="1 × Deye SUN-50K-SG01HP3 hybrid inverter from Fouani Nigeria Ltd. ≥ ₦5M → Finance + Director.",
          requested_by=self.u("u_pm1"), requested_at=d(44), required_roles=["finance", "director"], amount=7_400_000,
          decisions=[{"approverId": "u_fin", "role": "finance", "decision": "approved", "at": iso(d(43)), "comment": "Within budget line EQ-02"}], status="pending")
        A(id="ap3", project_id="p1", kind="change_order", title="CO-04 · +6 panels (roof edge row)", description="Client requested extra row; +6 × 615W, +₦1.2M, +2 days. Below ₦2M and 10% → Finance only.",
          requested_by=self.u("u_pm1"), requested_at=d(1, 9), required_roles=["finance"], amount=1_200_000, decisions=[], status="pending")
        A(id="ap4", project_id="p5", kind="gate", title="Gate 1 → 2 · Survey → Design", description="Survey, roof assessment, structural cert, load audit, photos — all checked.",
          requested_by=self.u("u_pm1"), requested_at=d(39), required_roles=["techlead"], decisions=[{"approverId": "u_le1", "role": "techlead", "decision": "approved", "at": iso(d(38))}], status="approved", target_stage=2)
        A(id="ap5", project_id="p6", kind="gate", title="Gate 6 → 7 · Handover → O&M", description="Acceptance, O&M manual, warranty pack checked. As-built and final account still outstanding.",
          requested_by=self.u("u_pm2"), requested_at=d(3), required_roles=["director"],
          decisions=[{"approverId": "u_dir", "role": "director", "decision": "rejected", "at": iso(d(2)), "comment": "As-built drawings not yet checked and no final account. Resubmit when gate evidence is complete."}], status="rejected", target_stage=7)
        A(id="ap6", project_id=None, kind="write_off", title="Write-off · 3 × Jinko Tiger Neo 615W panel (₦450,000)", description="Cracked glass on delivery — rejected by installer, photos attached Below ₦500k → Finance only.",
          requested_by=self.u("u_sk"), requested_at=d(3), required_roles=["finance"], decisions=[], status="pending", amount=450_000)
        A(id="ap7", project_id="p6", kind="change_order", title="CO-02 · +2 CTs for kitchen feeder", description="Extra sub-metering requested at survey. Finance only.",
          requested_by=self.u("u_pm2"), requested_at=d(120), required_roles=["finance"], decisions=[{"approverId": "u_fin", "role": "finance", "decision": "approved", "at": iso(d(119))}], status="approved", amount=350_000)
        A(id="ap8", project_id="p8", kind="retention", title="Retention release · ₦3,400,000", description="DLP complete", requested_by=self.u("u_pm2"), requested_at=d(165), required_roles=["finance", "director"],
          decisions=[{"approverId": "u_fin", "role": "finance", "decision": "approved", "at": iso(d(163))}, {"approverId": "u_dir", "role": "director", "decision": "approved", "at": iso(d(162))}], status="approved", amount=3_400_000)

    # ------------------------------------------------------------- phase 2
    def review(self, by: str, at: datetime, rs: str = "checked", checked_by: str = "u_fin", version: int = 1, check_at: datetime | None = None) -> dict:
        return {"review_status": rs, "submitted_by": self.u(by), "submitted_at": at, "review_version": version, "checked_by": None if rs == "pending" else self.u(checked_by),
                "checked_at": None if rs == "pending" else (check_at or at)}

    def audit(self, by: str, at: datetime) -> dict:
        return {"created_at": at, "created_by": self.u(by), "updated_at": at, "updated_by": self.u(by)}

    def MV(self, *, item_id, movement_type, qty, unit_cost, created_by, created_at, rs="checked", checked_by="u_pm1", **kw) -> StockMovement:
        self.mv_n += 1
        m = StockMovement(id=f"mv{self.mv_n}", item_id=item_id, movement_type=movement_type, qty=qty, unit_cost=unit_cost, total_cost=Decimal(qty) * Decimal(unit_cost),
                          created_by=self.u(created_by), created_at=created_at, **kw, **self.review(created_by, created_at, rs, checked_by))
        m.save(); return m

    def ASSET(self, item_id: str, serial: str, unit_cost, created_at: datetime, **opts) -> Asset:
        it = self.items[item_id]; self.as_n += 1
        cat = it.category if it.category in ("panel", "inverter", "battery", "meter", "ct", "ats", "cable", "mounting") else "other"
        a = Asset(id=f"as{self.as_n}", inventory_item=it, asset_type=cat, make=it.make or "", model=it.model or it.name, serial=serial, unit_cost=unit_cost, status="in_stock", location_id="loc_wh",
                  **self.audit("u_sk", created_at))
        for k, v in opts.items():
            setattr(a, k, v)
        a.save(); return a

    def ACT(self, **kw):
        self.act_n += 1
        Actual.objects.create(id=f"act{self.act_n}", **kw)

    def money_and_stock(self):
        for vid, name, cat in VENDORS:
            Vendor.objects.create(id=vid, name=name, category=cat)
        StockLocation.objects.create(id="loc_wh", name="Main warehouse — Ikeja", type="warehouse", custodian=self.u("u_sk"), is_active=True)
        StockLocation.objects.create(id="loc_van1", name="Van 1 — Segun Alabi", type="vehicle", custodian=self.u("u_ft1"), is_active=True)
        self.items = {}
        for iid, sku, name, cat, unit, ser, rl, rq, vid, make, model, wm in ITEMS:
            self.items[iid] = InventoryItem.objects.create(id=iid, sku=sku, name=name, category=cat, unit=unit, is_serialised=ser, reorder_level=rl, reorder_qty=rq, default_vendor_id=vid, is_active=True, make=make, model=model, warranty_months=wm)
        cid = 0; self.ci = {}
        for pid, budget in BUDGET.items():
            for cat, f in SPLIT:
                cid += 1
                c = CostItem.objects.create(id=f"ci{cid}", project_id=pid, category=cat, label=f"{cat[0].upper()}{cat[1:]} — {'metering' if pid == 'p6' else 'solar'}", planned_amount=round(budget * f / 1000) * 1000,
                                            **self.audit("u_pm1", d(100)), **self.review("u_pm1", d(100)))
                self.ci[(pid, cat)] = c
        cid += 1
        CostItem.objects.create(id=f"ci{cid}", project_id="p1", category="labour", label="Site security (nights, 3 weeks)", planned_amount=420_000, **self.audit("u_pm1", d(2)), **self.review("u_pm1", d(2), "pending"))
        # POs: (id, project, number, vendor, status, daysAgo, lines[(desc, qty, unitCost, itemId, costCat, qtyReceived)], approval)
        POS = [
            ("po1", "p1", "PO-2026-027", "v_solarmax", "delivered", 46, [("Jinko 615W panel", 66, 150_000, "it_panel", "equipment", 66)], None),
            ("po2", "p1", "PO-2026-028", "v_fouani", "delivered", 45, [("Deye 16 kWh battery", 7, 4_500_000, "it_bat16", "equipment", 7)], None),
            ("po3", "p1", "PO-2026-029", "v_adekunle", "delivered", 30, [("Roof reinforcement & inverter plinth (civil)", 1, 2_800_000, None, "civil", 1)], None),
            ("po4", "p1", "PO-2026-031", "v_fouani", "pending_approval", 44, [("Deye SUN-50K hybrid inverter", 1, 7_400_000, "it_inv50", "equipment", 0)], "ap2"),
            ("po5", "p2", "PO-2026-033", "v_solarmax", "delivered", 12, [("Jinko 615W panel", 220, 150_000, "it_panel", "equipment", 220)], None),
            ("po6", "p2", "PO-2026-034", "v_fouani", "approved", 10, [("Deye SUN-80K hybrid inverter", 2, 12_200_000, "it_inv80", "equipment", 0)], None),
            ("po7", "p2", "PO-2026-035", "v_fouani", "approved", 9, [("Deye 16 kWh battery", 11, 4_500_000, "it_bat16", "equipment", 0)], None),
            ("po8", "p4", "PO-2025-061", "v_fouani", "delivered", 240, [("Jinko 615W panel", 12, 120_000, "it_panel", "equipment", 12), ("Deye SUN-50K inverter", 1, 6_200_000, "it_inv50", "equipment", 1), ("Deye 16 kWh battery", 2, 3_900_000, "it_bat16", "equipment", 2)], None),
            ("po9", "p5", "PO-2026-030", "v_adekunle", "delivered", 38, [("Structural survey & roof load report", 1, 2_100_000, None, "civil", 1)], None),
            ("po10", "p6", "PO-2025-072", "v_acrel", "delivered", 108, [("Acrel AWT200 meter", 8, 180_000, "it_meter", "equipment", 8), ("CT 1200/5 A", 8, 25_000, "it_ct", "equipment", 8)], None),
            ("po11", "p6", "PO-2025-073", "v_consult", "delivered", 100, [("Generator right-sizing study & ATS commissioning", 1, 6_200_000, None, "labour", 1)], None),
            ("po12", "p8", "PO-2024-019", "v_consult", "closed", 620, [("EPC turnkey — 80 kWp (legacy contract)", 1, 57_900_000, None, "equipment", 1)], None),
        ]
        pin = 0; self.pi = {}
        for poid, pid, num, vid, status, days, lines, apid in POS:
            total = sum(q * uc for _, q, uc, *_ in lines)
            po = PurchaseOrder.objects.create(id=poid, project_id=pid, po_number=num, vendor_id=vid, status=status, raised_by=self.u("u_pm1"), raised_at=d(days), total=total, approval_id=apid, **self.audit("u_pm1", d(days)))
            for idx, (desc, q, uc, iid, cat, qr) in enumerate(lines):
                pin += 1
                self.pi[(poid, idx)] = PurchaseItem.objects.create(id=f"pi{pin}", po=po, position=idx, cost_item=self.ci.get((pid, cat)), inventory_item_id=iid, description=desc, qty=q, unit_cost=uc, line_total=q * uc, qty_received=qr)
        GRNS = [  # project, po, daysAgo, by, lines[(poLineIdx, qty, serials)], rs, checkedBy
            ("p1", "po1", 38, "u_sk", [(0, 66, serials("JKM26-", 1, 66))], "checked", "u_pm1"), ("p1", "po2", 37, "u_sk", [(0, 7, serials("DBAT-", 101, 7))], "checked", "u_pm1"),
            ("p1", "po3", 20, "u_pm1", [(0, 1, None)], "checked", "u_fin"), ("p2", "po5", 4, "u_sk", [(0, 220, serials("JKM26-", 201, 220))], "checked", "u_pm1"),
            ("p4", "po8", 235, "u_sk", [(0, 12, serials("JKM25-", 1, 12)), (1, 1, ["DINV-0007"]), (2, 2, ["DBAT-0031", "DBAT-0032"])], "checked", "u_pm1"),
            ("p5", "po9", 34, "u_pm1", [(0, 1, None)], "checked", "u_fin"),
            ("p6", "po10", 104, "u_sk", [(0, 8, ["25062405300051", "25062405300150", "25062405300134", "25062405300109", "25062405300144", "25062405300183", "25062405300079", "25062405300043"]), (1, 8, None)], "checked", "u_pm1"),
            ("p6", "po11", 84, "u_pm2", [(0, 1, None)], "checked", "u_fin"), ("p8", "po12", 590, "u_pm2", [(0, 1, None)], "checked", "u_fin"),
        ]
        gid = 0
        for pid, poid, days, by, lines, rs, cb in GRNS:
            gid += 1
            g = GoodsReceipt.objects.create(id=f"grn{gid}", project_id=pid, po_id=poid, grn_number=f"GRN-{2026 - (1 if days > 300 else 0)}-{10 + gid:03d}", received_at=d(days), received_by=self.u(by),
                                            lines=[{"purchaseItemId": self.pi[(poid, idx)].id, "qty": q, "serials": ser, "condition": "good"} for idx, q, ser in lines], attachment_ids=["att3"], location_id="loc_wh",
                                            **self.audit(by, d(days)), **self.review(by, d(days), rs, cb))
            po = PurchaseOrder.objects.get(pk=poid)
            for idx, q, ser in lines:
                item = self.pi[(poid, idx)]
                if item.inventory_item_id:
                    self.MV(item_id=item.inventory_item_id, movement_type="receipt", qty=q, location_to_id="loc_wh", unit_cost=item.unit_cost, project_id=pid, source_ref={"model": "GoodsReceipt", "id": g.id, "label": g.grn_number},
                            serials=ser, created_by=by, created_at=g.received_at, checked_by=cb)
                    for s in (ser or []):
                        self.ASSET(item.inventory_item_id, s, item.unit_cost, g.received_at, vendor_id=po.vendor_id, purchase_item=item, grn=g)
                else:
                    self.ACT(project_id=pid, cost_item=item.cost_item, category=item.cost_item.category if item.cost_item else "equipment", source="goods_receipt",
                             source_ref={"model": "GoodsReceipt", "id": g.id, "label": f"{g.grn_number} · {item.description}"}, amount=q * item.unit_cost, date=g.received_at, vendor_id=po.vendor_id,
                             attachment_ids=g.attachment_ids, created_by=self.u(cb))

        def opening(item_id, qty, unit_cost, ser=None):
            self.MV(item_id=item_id, movement_type="receipt", qty=qty, location_to_id="loc_wh", unit_cost=unit_cost, reason="Opening stock count — Jan 2026", source_ref={"model": "StockCount", "id": "sc-2026-01", "label": "Opening balance"},
                    serials=ser, created_by="u_sk", created_at=d(250), checked_by="u_fin")
            for s in (ser or []):
                self.ASSET(item_id, s, unit_cost, d(250))
        opening("it_cable", 2000, 1_200); opening("it_mc4", 400, 1_500); opening("it_rail", 120, 18_000); opening("it_fuse", 60, 8_000); opening("it_ct", 24, 25_000)
        opening("it_meter", 4, 175_000, ["25062405300060", "25062405300063", "25062405300093", "25062405300115"])

        def issue(item_id, qty, pid, unit_cost, days, by, ser=None, rs="checked", cb="u_pm1", label="Installation pick list"):
            m = self.MV(item_id=item_id, movement_type="issue", qty=qty, location_from_id="loc_wh", unit_cost=unit_cost, project_id=pid, serials=ser, created_by=by, created_at=d(days),
                        source_ref={"model": "PickList", "id": f"pl-{pid}-{self.mv_n}", "label": label}, rs=rs, checked_by=cb)
            if m.review_status == "checked":
                it = self.items[item_id]
                for s in (ser or []):
                    a = Asset.objects.get(serial=s); a.status = "installed"; a.project_id = pid; a.install_date = m.created_at; a.location = None
                    if it.warranty_months:
                        a.warranty_start = m.created_at.date(); a.warranty_end = add_months(m.created_at.date(), it.warranty_months)
                    a.save()
                self.ACT(project_id=pid, category="equipment", source="issue", source_ref={"model": "StockMovement", "id": m.id, "label": f"{it.name} × {qty}"}, amount=m.total_cost, date=m.created_at, attachment_ids=[], created_by=self.u(cb))
            return m
        issue("it_panel", 12, "p4", 120_000, 230, "u_sk", serials("JKM25-", 1, 12), cb="u_pm2"); issue("it_inv50", 1, "p4", 6_200_000, 230, "u_sk", ["DINV-0007"], cb="u_pm2")
        issue("it_bat16", 2, "p4", 3_900_000, 230, "u_sk", ["DBAT-0031", "DBAT-0032"], cb="u_pm2"); issue("it_cable", 180, "p4", 1_200, 229, "u_sk", cb="u_pm2")
        issue("it_meter", 8, "p6", 180_000, 98, "u_sk", ["25062405300051", "25062405300150", "25062405300134", "25062405300109", "25062405300144", "25062405300183", "25062405300079", "25062405300043"], cb="u_pm2")
        issue("it_ct", 8, "p6", 25_000, 98, "u_sk", cb="u_pm2")
        issue("it_panel", 44, "p1", 150_000, 8, "u_sk", serials("JKM26-", 1, 44)); issue("it_bat16", 4, "p1", 4_500_000, 7, "u_sk", serials("DBAT-", 101, 4))
        issue("it_cable", 600, "p1", 1_200, 8, "u_sk"); issue("it_mc4", 140, "p1", 1_500, 8, "u_sk"); issue("it_rail", 40, "p1", 18_000, 9, "u_sk")
        issue("it_panel", 22, "p1", 150_000, 1, "u_sk", serials("JKM26-", 45, 22), rs="pending", label="Pick list — roof edge row")
        issue("it_panel", 100, "p2", 150_000, 1, "u_sk", serials("JKM26-", 201, 100), rs="pending", label="Pick list — strings 1–5")
        self.MV(item_id="it_panel", movement_type="write_off", qty=3, location_from_id="loc_wh", unit_cost=150_000, reason="Cracked glass on delivery — rejected by installer, photos attached",
                serials=serials("JKM26-", 418, 3), attachment_ids=["att3"], created_by="u_sk", created_at=d(3), rs="pending", approval_id="ap6")
        ChangeOrder.objects.create(id="co1", project_id="p1", co_number="CO-04", title="+6 panels (roof edge row)", reason="Client requested extra row", scope_delta="+6 × 615W panels, +1 rail set", cost_delta=1_200_000, time_delta_days=2, status="pending_approval", approval_id="ap3", **self.audit("u_pm1", d(1)))
        ChangeOrder.objects.create(id="co2", project_id="p6", co_number="CO-02", title="+2 CTs for kitchen feeder", reason="Extra sub-metering requested at survey", scope_delta="+2 × CT 1200/5, +1 day", cost_delta=350_000, time_delta_days=1, status="approved", approval_id="ap7", **self.audit("u_pm2", d(120)))
        Retention.objects.create(project_id="p4", percent=5, amount_held=920_000, release_conditions="DLP ends " + ahead(175) + " · snag list closed")
        Retention.objects.create(project_id="p6", percent=5, amount_held=475_000, release_conditions="DLP 12 months from handover · final account agreed")
        Retention.objects.create(project_id="p8", percent=5, amount_held=3_400_000, release_conditions="DLP complete", released_at=d(162), released_by=self.u("u_dir"), approval_id="ap8")
        for qid, doc, vendor, txn, due, total, bal, pid in [("qb1", "DESH25616", "Solarmax Global Multi Concept", "2026-08-28", "2026-09-27", 33_000_000, 33_000_000, "p2"),
                                                            ("qb2", "FNL-2026-0412", "Fouani Nigeria Ltd", "2026-07-27", "2026-08-26", 31_500_000, 0, "p1"),
                                                            ("qb3", "ADK-0117", "Adekunle & Partners", "2026-08-12", "2026-09-11", 2_800_000, 2_800_000, "p1"),
                                                            ("qb4", "20250529001", "Acrel Electrical Manufacturing", "2026-05-25", "2026-06-24", 1_640_000, 0, "p6"),
                                                            ("qb5", "BCT-0899-2026", "Blue Carbon Tech", "2026-08-30", "2026-09-29", 18_900_000, 18_900_000, "p2"),
                                                            ("qb6", "FNL-2026-0455", "Fouani Nigeria Ltd", "2026-09-05", "2026-10-05", 24_200_000, 24_200_000, "p2")]:
            QbBill.objects.create(id=qid, doc_number=doc, vendor_name=vendor, txn_date=txn, due_date=due, total_amount=total, balance=bal, currency="NGN", project_id=pid, match_status="unmatched", synced_at=d(0, 7))

    # ------------------------------------------------------------- phase 3
    def att(self, pid, name, by, days, caption, rs="checked", cb="u_pm2", gps=None, link=None) -> str:
        self.att_n += 1; at = d(days, 11)
        Attachment.objects.create(id=f"att{self.att_n}", project_id=pid, file_name=name, mime="image/jpeg", size_bytes=1_300_000, kind="image", captured_at=at, gps=gps, sha256="".join("0123456789abcdef"[(i * 7 + 3) % 16] for i in range(64)),
                                  uploaded_by=self.u(by), uploaded_at=at, linked_to=link, caption=caption, **self.review(by, at, rs, cb, check_at=hrs(at, 20)))
        return f"att{self.att_n}"

    def field(self):
        self.mv_n = 900
        van_panels = [f"JKM26-{301 + i:04d}" for i in range(12)]
        self.MV(item_id="it_panel", movement_type="transfer", qty=12, location_from_id="loc_wh", location_to_id="loc_van1", unit_cost=150_000, serials=van_panels, created_by="u_sk", created_at=d(20, 8), checked_by="u_fin", source_ref={"model": "Transfer", "id": "tr-1", "label": "Van stock for Sango snag work"})
        Asset.objects.filter(serial__in=van_panels).update(location_id="loc_van1")
        for iid, q, uc in (("it_cable", 200, 1_200), ("it_mc4", 40, 1_500), ("it_fuse", 10, 8_000)):
            self.MV(item_id=iid, movement_type="transfer", qty=q, location_from_id="loc_wh", location_to_id="loc_van1", unit_cost=uc, created_by="u_sk", created_at=d(20, 8), checked_by="u_fin", source_ref={"model": "Transfer", "id": "tr-2", "label": "Van consumables"})

        def V(vid, pid, by, days, visit_type, findings, actions, travel, labour, duration=3, parts=None, issue_ids=None, attachment_ids=None, signoff=None, gps=None, rs="checked", cb="u_pm2"):
            start = d(days, 9); end = hrs(start, duration); parts = parts or []
            cost_parts = sum(Decimal(p["qty"]) * StockMovement.objects.get(pk=p["movementId"]).unit_cost for p in parts)
            SiteVisit.objects.create(id=vid, project_id=pid, visit_type=visit_type, started_at=start, ended_at=end, technician_ids=[by], duration_hrs=duration, findings=findings, actions_taken=actions,
                                     cost_travel=travel, cost_labour=labour, cost_parts=cost_parts, cost_total=travel + labour + cost_parts, parts=parts, location_id="loc_van1", attachment_ids=attachment_ids or [],
                                     issue_ids=issue_ids or [], client_signoff=signoff, gps=gps, **self.audit(by, start), **self.review(by, end, rs, cb, check_at=hrs(end, 20)))
        mc4 = self.MV(item_id="it_mc4", movement_type="issue", qty=2, location_from_id="loc_van1", unit_cost=1_500, project_id="p4", created_by="u_ft1", created_at=d(20, 12), source_ref={"model": "SiteVisit", "id": "vis1", "label": "Parts used on visit"}, checked_by="u_pm2")
        V("vis1", "p4", "u_ft1", 20, "fault", "Inverter fault F23 — battery CAN comms lost. Loose plug at BMS side, connector corroded.",
          "Re-seated and secured CAN plug, replaced 2 MC4 pairs on string 1, updated inverter firmware to 1.4.2, verified SoC reporting.", 25_000, 40_000, 3.5,
          parts=[{"movementId": mc4.id, "itemId": "it_mc4", "qty": 2}], issue_ids=["iss2"],
          attachment_ids=[self.att("p4", "de-visit-bms-plug-before.jpg", "u_ft1", 20, "BMS CAN plug corroded (before)"), self.att("p4", "de-visit-bms-plug-after.jpg", "u_ft1", 20, "Plug replaced and secured (after)")],
          signoff={"name": "Mr Durosinmi Etti", "signatureAttachmentId": self.att("p4", "de-visit-signoff.png", "u_ft1", 20, "Client sign-on-glass"), "rating": 5}, gps={"lat": 6.6018, "lng": 3.3515})
        V("vis2", "p6", "u_ft1", 90, "routine", "AWT200 25062405300051 offline since 03:00; gateway had lost SIM registration. CT nameplate confirmed 1200/5 (×240).",
          "Power-cycled gateway, re-registered SIM, verified live readings on platform for both meters.", 18_000, 30_000, 2, attachment_ids=[self.att("p6", "ayobo-gateway-status.jpg", "u_ft1", 90, "Gateway online after reset")], gps={"lat": 6.6531, "lng": 3.2486})
        fuse = self.MV(item_id="it_fuse", movement_type="issue", qty=1, location_from_id="loc_van1", unit_cost=8_000, project_id="p1", created_by="u_ft1", created_at=d(2, 12), source_ref={"model": "SiteVisit", "id": "vis3", "label": "Parts used on visit"}, rs="pending")
        V("vis3", "p1", "u_ft1", 2, "inspection", "String 3 DC fuse blown during first energisation; 3 cracked panels still on roof edge pending replacement.",
          "Replaced fuse, isolated cracked panels, tagged string 3 out of service until replacement stock arrives.", 12_000, 20_000, 2.5, parts=[{"movementId": fuse.id, "itemId": "it_fuse", "qty": 1}], issue_ids=["iss3"],
          attachment_ids=[self.att("p1", "sango-string3-fuse.jpg", "u_ft1", 2, "Blown DC fuse, string 3", rs="pending")], gps={"lat": 6.687, "lng": 3.235}, rs="pending")
        sla = {"critical": 24, "high": 72, "medium": 168, "low": 720}

        def I(iid, pid, by, days, category, severity, title, description, rs="checked", cb="u_pm2", version=1, **f):
            at = d(days, 10); resolved_at = f.get("resolved_at")
            Issue.objects.create(id=iid, project_id=pid, category=category, severity=severity, title=title, description=description, raised_by=self.u(by), raised_at=at, source=f.get("source", "manual"),
                                 status=f.get("status", "open"), assignee=self.u(f["assignee"]) if f.get("assignee") else None, root_cause=f.get("root_cause"), resolution=f.get("resolution"),
                                 resolved_by=self.u(f["resolved_by"]) if f.get("resolved_by") else None, resolved_at=resolved_at, cost_to_resolve=f.get("cost", 0), linked_visit_id=f.get("visit"),
                                 warranty_claim_id=f.get("warranty"), asset=Asset.objects.filter(serial=f["asset_serial"]).first() if f.get("asset_serial") else None,
                                 before_attachment_ids=f.get("before", []), after_attachment_ids=f.get("after", []), is_snag=f.get("snag", False), sla_due_at=hrs(at, sla[severity]),
                                 **self.audit(by, at), **self.review(by, resolved_at or at, rs, cb, version, check_at=hrs(resolved_at or at, 20)))
        I("iss1", "p6", "u_le2", 15, "data", "high", "Utility meter 25062405300150 sends zeroed HISTORY packets", "Since the gateway outage the AWT200 replays is_historical frames with time=0 and register ≈0 — un-scaled by CT (×400). Live stream is fine.",
          source="telemetry_alert", status="in_progress", assignee="u_ft1", asset_serial="25062405300150")
        I("iss2", "p4", "u_ft1", 21, "electrical", "high", "Inverter fault F23 — battery comms lost", "Inverter shows F23; battery SoC not reporting; site on grid only.", "checked", "u_pm2", 2,
          status="closed", assignee="u_ft1", asset_serial="DINV-0007", root_cause="Loose CAN plug at BMS, connector corroded", resolution="Re-seated and secured plug, replaced MC4 pairs, firmware 1.4.2",
          resolved_by="u_ft1", resolved_at=d(20, 13), visit="vis1", warranty="war1",
          before=[self.att("p4", "de-inverter-f23.jpg", "u_ft1", 21, "F23 on inverter display (before)")], after=[self.att("p4", "de-inverter-ok.jpg", "u_ft1", 20, "Inverter normal, SoC 78% (after)")])
        I("iss3", "p1", "u_ft1", 3, "mechanical", "critical", "3 panels cracked on delivery — replace before string 3 test", "JKM26-0418/0419/0420 glass cracked. Write-off raised; replacements needed from stock.", "pending",
          status="awaiting_parts", assignee="u_sk", before=[self.att("p1", "sango-cracked-panels.jpg", "u_ft1", 3, "Cracked glass, 3 panels", rs="pending")])
        I("iss4", "p2", "u_ft2", 6, "other", "low", "Cable tray labels missing (snag)", "Tray runs on roof B have no circuit labels.", "checked", "u_le2", snag=True, before=[self.att("p2", "ojodu-tray-unlabelled.jpg", "u_ft2", 6, "Unlabelled tray", cb="u_le2")])
        I("iss5", "p1", "u_ft1", 5, "safety", "medium", "No barrier around inverter bay during cabling", "Open DC bus accessible while string cabling in progress.", "checked", "u_pm1", status="in_progress", assignee="u_le1",
          before=[self.att("p1", "sango-inverter-bay-open.jpg", "u_ft1", 5, "Inverter bay unguarded", cb="u_pm1")])

        def items(vals, fails=(), na=()):
            out = []
            for t in COMMISSIONING_TEMPLATE:
                row = {"key": t["key"], "label": t["label"], "unit": t.get("unit"), "measuredValue": vals.get(t["key"]), "pass": t["key"] not in fails}
                if t["key"] in na:
                    row.update({"pass": True, "comment": "N/A — metering project"})
                out.append(row)
            return out
        CommissioningRecord.objects.create(id="com1", project_id="p4", date=d(540).date(), engineer=self.u("u_le2"), result="pass", notes="All strings within 2% of expected Voc. ATS changeover 1.8 s.",
                                           items=items({"insulation_resistance": "> 200", "earth_resistance": "0.8", "string_voc": "442 / 440 / 441", "string_isc": "13.2 / 13.1 / 13.2"}),
                                           meter={"serialAscii": True, "ctRatioVerified": True, "firstLiveReading": True, "historicalOk": True},
                                           client_witness={"name": "Mr Durosinmi Etti", "signatureAttachmentId": self.att("p4", "de-commissioning-signoff.png", "u_le2", 540, "Witness signature", cb="u_dir")},
                                           attachment_ids=[self.att("p4", "de-commissioning-inverter.jpg", "u_le2", 540, "Inverter energised", cb="u_dir")], **self.audit("u_le2", d(540)), **self.review("u_le2", d(540), "checked", "u_dir"))
        CommissioningRecord.objects.create(id="com2", project_id="p6", date=d(100).date(), engineer=self.u("u_le2"), result="pass", notes="Metering-only project: 8 × AWT200 on gen and utility feeders. CT ratios verified against clamp meter.",
                                           items=items({"earth_resistance": "1.1", "meter_ct_ratio": "1200/5 = ×240 (gen) · 2000/5 = ×400 (utility)"}, na=("string_voc", "string_isc", "battery_bms", "insulation_resistance", "fire_suppression")),
                                           meter={"serialAscii": True, "ctRatioVerified": True, "firstLiveReading": True, "historicalOk": False},
                                           client_witness={"name": "Access Bank facilities — E. Okon", "signatureAttachmentId": self.att("p6", "ayobo-commissioning-signoff.png", "u_le2", 100, "Witness signature", cb="u_dir")},
                                           attachment_ids=[self.att("p6", "ayobo-meter-panel.jpg", "u_le2", 100, "Meter panel labelled", cb="u_dir")], **self.audit("u_le2", d(100)), **self.review("u_le2", d(100), "checked", "u_dir"))
        HseIncident.objects.create(id="hse1", project_id="p1", visit_id="vis3", type="near_miss", severity="medium", description="Ladder slipped on wet roof edge while accessing string 3 — no injury.",
                                   actions="Anti-slip mats issued; harness anchor point added at roof edge; toolbox talk repeated.", occurred_at=d(5, 8), reported_by=self.u("u_ft1"),
                                   attachment_ids=[self.att("p1", "sango-roof-edge-wet.jpg", "u_ft1", 5, "Wet roof edge, no anchor", rs="pending")], **self.audit("u_ft1", d(5, 9)), **self.review("u_ft1", d(5, 9), "pending"))
        HseIncident.objects.create(id="hse2", project_id="p6", type="property", severity="low", description="Drill bit slipped and cracked a trunking cover during meter panel install.", actions="Cover replaced same day; charged to O&M consumables.",
                                   occurred_at=d(95, 14), reported_by=self.u("u_ft1"), attachment_ids=[], **self.audit("u_ft1", d(95, 15)), **self.review("u_ft1", d(95, 15), "checked", "u_pm2"))
        WarrantyClaim.objects.create(id="war1", project_id="p4", asset=Asset.objects.get(serial="DBAT-0031"), issue_id="iss2", vendor_id="v_fouani", claimed_at=d(19), status="accepted",
                                     outcome="Fouani accepted the claim; replacement BMS harness shipped, no charge.", cost_recovered=0, notes="Corroded CAN connector within 12-month warranty.",
                                     **self.audit("u_le2", d(19)), **self.review("u_le2", d(19), "checked", "u_pm2"))

        def line(item_id, expected, counted=None, note=None):
            return {"itemId": item_id, "expectedQty": expected, "countedQty": counted, "variance": 0 if counted is None else counted - expected, "note": note}
        StockCount.objects.create(id="sc1", location_id="loc_wh", count_date=d(1).date(), counted_by=self.u("u_sk"), status="open", variance_value=0, notes="Month-end count — in progress",
                                  lines=[line("it_panel", 230), line("it_bat16", 3), line("it_meter", 4), line("it_ct", 16), line("it_cable", 1020, 1020), line("it_mc4", 220, 212, "8 pairs used on Sango string 3 not booked"),
                                         line("it_rail", 80, 80), line("it_fuse", 50, 52), line("it_mccb", 0), line("it_inv50", 0), line("it_inv80", 0)], **self.audit("u_sk", d(1)))


def wipe():
    for model in (WarrantyClaim, HseIncident, CommissioningRecord, Issue, SiteVisit, StockCount, QbBill, Retention, ChangeOrder, Actual, StockMovement, Asset, GoodsReceipt, PurchaseItem,
                  PurchaseOrder, CostItem, Approval, ChronologyEvent, Attachment, Document, ProjectMembership, Project, InventoryItem, StockLocation, Vendor):
        model.objects.all().delete()


class Command(BaseCommand):
    help = "Seed the demo data set (same as the web app's mock). Use --reset to wipe tracker rows first."

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true")
        parser.add_argument("--password", default=DEMO_PASSWORD, help="Password for every demo user")

    @transaction.atomic
    def handle(self, *args, **opts):
        seed_rbac()
        if opts["reset"]:
            wipe()
        if Project.objects.exists():
            self.stdout.write(self.style.WARNING("Projects already exist — run with --reset to reseed")); return
        s = Seeder(opts["password"])
        s.users_and_projects(); s.money_and_stock(); s.field()
        self.stdout.write(self.style.SUCCESS(f"Seeded: {User.objects.count()} users, {Project.objects.count()} projects, {StockMovement.objects.count()} movements, {Asset.objects.count()} assets. Demo password: {opts['password']}"))
