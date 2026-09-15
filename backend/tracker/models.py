"""Domain models — spec §2 (RBAC), §4 (data model incl. 4.13 maker-checker, 4.15 inventory).
Shapes mirror packages/api/src/types.ts so the web app's snapshot is a straight rename (snake → camel).
String primary keys keep ids stable across mock and backend (e.g. the default warehouse is `loc_wh`)."""
from __future__ import annotations

import secrets

from django.contrib.auth.models import AbstractUser
from django.db import models

from .storage import attachment_path, document_path


def _nid(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(4)}"


# one named function per prefix so Django migrations can serialize the default
def id_act():
    return _nid("act")

def id_ap():
    return _nid("ap")

def id_as():
    return _nid("as")

def id_att():
    return _nid("att")

def id_ci():
    return _nid("ci")

def id_co():
    return _nid("co")

def id_com():
    return _nid("com")

def id_doc():
    return _nid("doc")

def id_ev():
    return _nid("ev")

def id_grn():
    return _nid("grn")

def id_hse():
    return _nid("hse")

def id_iss():
    return _nid("iss")

def id_it():
    return _nid("it")

def id_loc():
    return _nid("loc")

def id_m():
    return _nid("m")

def id_mv():
    return _nid("mv")

def id_p():
    return _nid("p")

def id_pi():
    return _nid("pi")

def id_po():
    return _nid("po")

def id_qb():
    return _nid("qb")

def id_sc():
    return _nid("sc")

def id_u():
    return _nid("u")

def id_v():
    return _nid("v")

def id_vis():
    return _nid("vis")

def id_war():
    return _nid("war")


class Role(models.Model):
    code = models.CharField(primary_key=True, max_length=24)
    name = models.CharField(max_length=60)
    is_global = models.BooleanField(default=False, help_text="Applies to every project without a membership")

    def __str__(self):
        return self.name


class RolePermission(models.Model):
    """§2.2 matrix row — editable by Admin only."""
    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name="permissions")
    permission = models.CharField(max_length=40)

    class Meta:
        unique_together = [("role", "permission")]


class User(AbstractUser):
    id = models.CharField(primary_key=True, max_length=40, default=id_u)
    name = models.CharField(max_length=120)
    roles = models.ManyToManyField(Role, blank=True, related_name="users")

    def role_codes(self) -> list[str]:
        cached = getattr(self, "_role_codes", None)
        if cached is None:
            cached = list(self.roles.values_list("code", flat=True))
            self._role_codes = cached
        return cached

    @property
    def initials(self) -> str:
        parts = [p for p in (self.name or self.username).split(" ") if p]
        return "".join(p[0] for p in parts)[:2].upper()

    def __str__(self):
        return self.name or self.username


class Threshold(models.Model):
    """§11 defaults; versioned by effective_from (latest wins)."""
    key = models.CharField(primary_key=True, max_length=60)
    label = models.CharField(max_length=120)
    value = models.CharField(max_length=60)
    unit = models.CharField(max_length=20, blank=True)
    effective_from = models.DateField()
    updated_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name="+")


class Audit(models.Model):
    """§4 actor capture — set server-side, never from the client."""
    created_at = models.DateTimeField()
    created_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    updated_at = models.DateTimeField()
    updated_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")

    class Meta:
        abstract = True


class Reviewable(models.Model):
    """§4.13 maker-checker. Nothing is effective until a *different* user with the module's check permission verifies it."""
    REVIEW = [("pending", "Pending"), ("checked", "Checked"), ("rejected", "Rejected")]
    review_status = models.CharField(max_length=10, choices=REVIEW, default="pending")
    submitted_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    submitted_at = models.DateTimeField()
    checked_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    checked_at = models.DateTimeField(null=True, blank=True)
    check_comment = models.TextField(blank=True, null=True)
    review_version = models.PositiveIntegerField(default=1)

    class Meta:
        abstract = True


# ------------------------------------------------------------------ projects, people, chronology, evidence
class Project(Audit):
    id = models.CharField(primary_key=True, max_length=40, default=id_p)
    code = models.CharField(max_length=20, unique=True)
    name = models.CharField(max_length=200)
    client_name = models.CharField(max_length=120)
    branch_name = models.CharField(max_length=120)
    location = models.CharField(max_length=160)
    project_type = models.CharField(max_length=20)
    system_capacity_kwp = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    stage = models.PositiveSmallIntegerField(default=0)
    rag = models.CharField(max_length=6, default="green")
    rag_reason = models.CharField(max_length=300, blank=True, null=True)
    pm = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    lead_engineer = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    contract_value = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    approved_budget = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    committed = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    actual = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    stage_planned = models.JSONField(default=dict, blank=True)
    stage_actual = models.JSONField(default=dict, blank=True)
    defects_liability_end = models.DateField(null=True, blank=True)
    retention_percent = models.DecimalField(max_digits=5, decimal_places=2, default=5)
    wyre_investor_project_id = models.IntegerField(null=True, blank=True, help_text="Link to investors_project in the Wyre backend (optional)")

    def __str__(self):
        return f"{self.code} {self.name}"


class ProjectMembership(models.Model):
    id = models.CharField(primary_key=True, max_length=40, default=id_m)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="memberships")
    role = models.CharField(max_length=24)
    granted_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    granted_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)


class ChronologyEvent(models.Model):
    """§4.2 append-only — never updated or deleted; corrections are new events."""
    id = models.CharField(primary_key=True, max_length=40, default=id_ev)
    project = models.ForeignKey(Project, on_delete=models.PROTECT, related_name="events")
    occurred_at = models.DateTimeField(db_index=True)
    actor = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    event_type = models.CharField(max_length=30)
    summary = models.CharField(max_length=400)
    detail = models.TextField(blank=True, null=True)
    ref = models.JSONField(null=True, blank=True)
    before = models.JSONField(null=True, blank=True)
    after = models.JSONField(null=True, blank=True)


class Document(Audit, Reviewable):
    id = models.CharField(primary_key=True, max_length=40, default=id_doc)
    project = models.ForeignKey(Project, on_delete=models.PROTECT, related_name="documents")
    doc_type = models.CharField(max_length=30)
    title = models.CharField(max_length=200)
    status = models.CharField(max_length=10, default="submitted")
    issued_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateField(null=True, blank=True)
    issuer = models.CharField(max_length=120, blank=True, null=True)
    version = models.PositiveIntegerField(default=1)
    file_name = models.CharField(max_length=200)
    size_bytes = models.BigIntegerField(default=0)
    sha256 = models.CharField(max_length=64, blank=True)
    file = models.FileField(upload_to=document_path, null=True, blank=True)


class Attachment(Reviewable):
    """§4.11 single generic media model. originals never overwritten; sha256 stored."""
    id = models.CharField(primary_key=True, max_length=40, default=id_att)
    project = models.ForeignKey(Project, null=True, blank=True, on_delete=models.PROTECT, related_name="attachments")
    file_name = models.CharField(max_length=200)
    mime = models.CharField(max_length=80, default="image/jpeg")
    size_bytes = models.BigIntegerField(default=0)
    kind = models.CharField(max_length=10, default="image")
    captured_at = models.DateTimeField(null=True, blank=True)
    gps = models.JSONField(null=True, blank=True)
    sha256 = models.CharField(max_length=64)
    uploaded_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    uploaded_at = models.DateTimeField()
    linked_to = models.JSONField(null=True, blank=True)
    caption = models.CharField(max_length=300, blank=True, null=True)
    file = models.FileField(upload_to=attachment_path, null=True, blank=True)


class Approval(models.Model):
    """§4.12 — gates, POs, change orders, retention, write-offs, stock counts. Every required role must approve once; any rejection rejects."""
    id = models.CharField(primary_key=True, max_length=40, default=id_ap)
    project = models.ForeignKey(Project, null=True, blank=True, on_delete=models.PROTECT, related_name="approvals")
    kind = models.CharField(max_length=20)
    title = models.CharField(max_length=300)
    description = models.TextField(blank=True)
    requested_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    requested_at = models.DateTimeField()
    required_roles = models.JSONField(default=list)
    decisions = models.JSONField(default=list)
    status = models.CharField(max_length=10, default="pending")
    amount = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    target_stage = models.PositiveSmallIntegerField(null=True, blank=True)


# ------------------------------------------------------------------ Phase 2: money, assets, stock
class Vendor(models.Model):
    id = models.CharField(primary_key=True, max_length=40, default=id_v)
    name = models.CharField(max_length=160)
    category = models.CharField(max_length=80, blank=True, null=True)


class InventoryItem(models.Model):
    id = models.CharField(primary_key=True, max_length=40, default=id_it)
    sku = models.CharField(max_length=40)
    name = models.CharField(max_length=160)
    category = models.CharField(max_length=20)
    unit = models.CharField(max_length=10, default="pcs")
    is_serialised = models.BooleanField(default=False)
    reorder_level = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    reorder_qty = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    default_vendor = models.ForeignKey(Vendor, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    is_active = models.BooleanField(default=True)
    make = models.CharField(max_length=80, blank=True, null=True)
    model = models.CharField(max_length=120, blank=True, null=True)
    warranty_months = models.PositiveIntegerField(null=True, blank=True)


class StockLocation(models.Model):
    id = models.CharField(primary_key=True, max_length=40, default=id_loc)
    name = models.CharField(max_length=120)
    type = models.CharField(max_length=12)
    custodian = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    is_active = models.BooleanField(default=True)


class CostItem(Audit, Reviewable):
    id = models.CharField(primary_key=True, max_length=40, default=id_ci)
    project = models.ForeignKey(Project, on_delete=models.PROTECT, related_name="cost_items")
    category = models.CharField(max_length=20)
    label = models.CharField(max_length=200)
    planned_amount = models.DecimalField(max_digits=18, decimal_places=2)


class PurchaseOrder(Audit):
    id = models.CharField(primary_key=True, max_length=40, default=id_po)
    project = models.ForeignKey(Project, on_delete=models.PROTECT, related_name="purchase_orders")
    po_number = models.CharField(max_length=30)
    vendor = models.ForeignKey(Vendor, on_delete=models.PROTECT, related_name="+")
    status = models.CharField(max_length=20, default="pending_approval")
    raised_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    raised_at = models.DateTimeField()
    total = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    notes = models.TextField(blank=True, null=True)
    approval = models.ForeignKey(Approval, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")


class PurchaseItem(models.Model):
    id = models.CharField(primary_key=True, max_length=40, default=id_pi)
    po = models.ForeignKey(PurchaseOrder, on_delete=models.CASCADE, related_name="items")
    position = models.PositiveSmallIntegerField(default=0)
    cost_item = models.ForeignKey(CostItem, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    inventory_item = models.ForeignKey(InventoryItem, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    description = models.CharField(max_length=200)
    qty = models.DecimalField(max_digits=12, decimal_places=2)
    unit_cost = models.DecimalField(max_digits=18, decimal_places=2)
    line_total = models.DecimalField(max_digits=18, decimal_places=2)
    qty_received = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    class Meta:
        ordering = ["position", "id"]


class GoodsReceipt(Audit, Reviewable):
    id = models.CharField(primary_key=True, max_length=40, default=id_grn)
    project = models.ForeignKey(Project, on_delete=models.PROTECT, related_name="goods_receipts")
    po = models.ForeignKey(PurchaseOrder, on_delete=models.PROTECT, related_name="goods_receipts")
    grn_number = models.CharField(max_length=30)
    received_at = models.DateTimeField()
    received_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    lines = models.JSONField(default=list)
    attachment_ids = models.JSONField(default=list)
    location = models.ForeignKey(StockLocation, on_delete=models.PROTECT, related_name="+")
    notes = models.TextField(blank=True, null=True)


class Asset(Audit):
    """§4.5 serial-level register."""
    id = models.CharField(primary_key=True, max_length=40, default=id_as)
    project = models.ForeignKey(Project, null=True, blank=True, on_delete=models.SET_NULL, related_name="assets")
    inventory_item = models.ForeignKey(InventoryItem, on_delete=models.PROTECT, related_name="assets")
    asset_type = models.CharField(max_length=12)
    make = models.CharField(max_length=80, blank=True)
    model = models.CharField(max_length=120, blank=True)
    serial = models.CharField(max_length=80, unique=True)
    unit_cost = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    vendor = models.ForeignKey(Vendor, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    purchase_item = models.ForeignKey(PurchaseItem, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    grn = models.ForeignKey(GoodsReceipt, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    install_date = models.DateTimeField(null=True, blank=True)
    location_on_site = models.CharField(max_length=120, blank=True, null=True)
    warranty_start = models.DateField(null=True, blank=True)
    warranty_end = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=16, default="in_stock")
    location = models.ForeignKey(StockLocation, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")


class StockMovement(Reviewable):
    """§4.15 append-only ledger row; qty is a magnitude, sign comes from movement_type."""
    id = models.CharField(primary_key=True, max_length=40, default=id_mv)
    item = models.ForeignKey(InventoryItem, on_delete=models.PROTECT, related_name="movements")
    movement_type = models.CharField(max_length=12)
    qty = models.DecimalField(max_digits=12, decimal_places=2)
    location_from = models.ForeignKey(StockLocation, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    location_to = models.ForeignKey(StockLocation, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    unit_cost = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    total_cost = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    project = models.ForeignKey(Project, null=True, blank=True, on_delete=models.PROTECT, related_name="movements")
    source_ref = models.JSONField(null=True, blank=True)
    reason = models.TextField(blank=True, null=True)
    serials = models.JSONField(null=True, blank=True)
    attachment_ids = models.JSONField(null=True, blank=True)
    created_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    created_at = models.DateTimeField(db_index=True)
    approval = models.ForeignKey(Approval, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")


class Actual(models.Model):
    """§4.10 unified actuals ledger — only produced by checked / approved events."""
    id = models.CharField(primary_key=True, max_length=40, default=id_act)
    project = models.ForeignKey(Project, on_delete=models.PROTECT, related_name="actuals")
    cost_item = models.ForeignKey(CostItem, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    category = models.CharField(max_length=20)
    source = models.CharField(max_length=20)
    source_ref = models.JSONField(default=dict)
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    date = models.DateTimeField()
    vendor = models.ForeignKey(Vendor, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    attachment_ids = models.JSONField(default=list)
    qb_bill_id = models.CharField(max_length=40, null=True, blank=True)
    created_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")


class ChangeOrder(Audit):
    id = models.CharField(primary_key=True, max_length=40, default=id_co)
    project = models.ForeignKey(Project, on_delete=models.PROTECT, related_name="change_orders")
    co_number = models.CharField(max_length=20)
    title = models.CharField(max_length=200)
    reason = models.TextField()
    scope_delta = models.TextField(blank=True)
    cost_delta = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    time_delta_days = models.IntegerField(default=0)
    status = models.CharField(max_length=20, default="pending_approval")
    approval = models.ForeignKey(Approval, on_delete=models.PROTECT, related_name="+")


class Retention(models.Model):
    project = models.OneToOneField(Project, primary_key=True, on_delete=models.CASCADE, related_name="retention")
    percent = models.DecimalField(max_digits=5, decimal_places=2)
    amount_held = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    release_conditions = models.CharField(max_length=300, blank=True)
    released_at = models.DateTimeField(null=True, blank=True)
    released_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    approval = models.ForeignKey(Approval, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")


class QbBill(models.Model):
    """Synced from QuickBooks (via the Wyre backend export) — exempt from maker-checker (§4.13)."""
    id = models.CharField(primary_key=True, max_length=40, default=id_qb)
    doc_number = models.CharField(max_length=60)
    vendor_name = models.CharField(max_length=160)
    txn_date = models.DateField()
    due_date = models.DateField(null=True, blank=True)
    total_amount = models.DecimalField(max_digits=18, decimal_places=2)
    balance = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    currency = models.CharField(max_length=5, default="NGN")
    project = models.ForeignKey(Project, null=True, blank=True, on_delete=models.SET_NULL, related_name="qb_bills")
    matched_po = models.ForeignKey(PurchaseOrder, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    match_status = models.CharField(max_length=10, default="unmatched")
    synced_at = models.DateTimeField()


# ------------------------------------------------------------------ Phase 3: field & quality
class SiteVisit(Audit, Reviewable):
    id = models.CharField(primary_key=True, max_length=40, default=id_vis)
    project = models.ForeignKey(Project, on_delete=models.PROTECT, related_name="visits")
    station_id = models.CharField(max_length=40, null=True, blank=True)
    visit_type = models.CharField(max_length=16)
    started_at = models.DateTimeField()
    ended_at = models.DateTimeField()
    technician_ids = models.JSONField(default=list)
    duration_hrs = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    findings = models.TextField()
    actions_taken = models.TextField(blank=True)
    cost_travel = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    cost_labour = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    cost_parts = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    cost_total = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    parts = models.JSONField(default=list)
    location = models.ForeignKey(StockLocation, on_delete=models.PROTECT, related_name="+")
    attachment_ids = models.JSONField(default=list)
    issue_ids = models.JSONField(default=list)
    client_signoff = models.JSONField(null=True, blank=True)
    gps = models.JSONField(null=True, blank=True)
    offline_captured_at = models.DateTimeField(null=True, blank=True)


class Issue(Audit, Reviewable):
    id = models.CharField(primary_key=True, max_length=40, default=id_iss)
    project = models.ForeignKey(Project, on_delete=models.PROTECT, related_name="issues")
    station_id = models.CharField(max_length=40, null=True, blank=True)
    asset = models.ForeignKey(Asset, null=True, blank=True, on_delete=models.SET_NULL, related_name="issues")
    category = models.CharField(max_length=16)
    severity = models.CharField(max_length=10)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    raised_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    raised_at = models.DateTimeField()
    source = models.CharField(max_length=20, default="manual")
    status = models.CharField(max_length=16, default="open")
    assignee = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    root_cause = models.TextField(blank=True, null=True)
    resolution = models.TextField(blank=True, null=True)
    resolved_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    resolved_at = models.DateTimeField(null=True, blank=True)
    cost_to_resolve = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    linked_visit = models.ForeignKey(SiteVisit, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    warranty_claim_id = models.CharField(max_length=40, null=True, blank=True)
    before_attachment_ids = models.JSONField(default=list)
    after_attachment_ids = models.JSONField(default=list)
    is_snag = models.BooleanField(default=False)
    sla_due_at = models.DateTimeField()


class CommissioningRecord(Audit, Reviewable):
    id = models.CharField(primary_key=True, max_length=40, default=id_com)
    project = models.ForeignKey(Project, on_delete=models.PROTECT, related_name="commissionings")
    station_id = models.CharField(max_length=40, null=True, blank=True)
    date = models.DateField()
    engineer = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    result = models.CharField(max_length=12)
    notes = models.TextField(blank=True)
    items = models.JSONField(default=list)
    meter = models.JSONField(default=dict)
    client_witness = models.JSONField(null=True, blank=True)
    attachment_ids = models.JSONField(default=list)


class HseIncident(Audit, Reviewable):
    id = models.CharField(primary_key=True, max_length=40, default=id_hse)
    project = models.ForeignKey(Project, on_delete=models.PROTECT, related_name="hse_incidents")
    visit = models.ForeignKey(SiteVisit, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    type = models.CharField(max_length=16)
    severity = models.CharField(max_length=10)
    description = models.TextField()
    actions = models.TextField(blank=True)
    occurred_at = models.DateTimeField()
    reported_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    attachment_ids = models.JSONField(default=list)


class WarrantyClaim(Audit, Reviewable):
    id = models.CharField(primary_key=True, max_length=40, default=id_war)
    project = models.ForeignKey(Project, on_delete=models.PROTECT, related_name="warranty_claims")
    asset = models.ForeignKey(Asset, on_delete=models.PROTECT, related_name="warranty_claims")
    issue = models.ForeignKey(Issue, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    vendor = models.ForeignKey(Vendor, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    claimed_at = models.DateTimeField()
    status = models.CharField(max_length=10, default="raised")
    outcome = models.TextField(blank=True, null=True)
    cost_recovered = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    notes = models.TextField(blank=True)


class StockCount(Audit):
    id = models.CharField(primary_key=True, max_length=40, default=id_sc)
    location = models.ForeignKey(StockLocation, on_delete=models.PROTECT, related_name="+")
    count_date = models.DateField()
    counted_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    status = models.CharField(max_length=10, default="open")
    lines = models.JSONField(default=list)
    approval = models.ForeignKey(Approval, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    notes = models.TextField(blank=True, null=True)
    variance_value = models.DecimalField(max_digits=18, decimal_places=2, default=0)
