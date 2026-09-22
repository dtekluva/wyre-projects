"""Port of packages/api/test/flow.test.mjs — the governance rules, exercised against the real database."""
from __future__ import annotations

from decimal import Decimal

from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from tracker.errors import ApiError
from tracker.models import Approval, Asset, CostItem, Document, Issue, Project, PurchaseOrder, StockCount, StockMovement, User
from tracker import rbac
from tracker.services import approvals, billing, documents, field, gates, money, projects, recon, review, stock
from tracker.services.base import dec


class RulesTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_demo", verbosity=0)
        cls.u = {u.id: u for u in User.objects.all()}

    def err(self, code, fn, *a, **k):
        with self.assertRaises(ApiError) as cm:
            fn(*a, **k)
        self.assertEqual(cm.exception.code, code, cm.exception.message)
        return cm.exception

    # ---------------------------------------------------------------- PO → GRN → stock (WAC) → issue
    def test_po_grn_wac_issue_flow(self):
        u = self.u; m0 = money.money("p1")
        self.assertEqual(stock.balance_of("it_mccb")["qtyOnHand"], 0)
        po = money.create_po(u["u_pm1"], "p1", {"vendorId": "v_dixsen", "items": [{"inventoryItemId": "it_mccb", "description": "Schneider NSX 250A MCCB", "qty": 2, "unitCost": 180000}]})
        self.assertEqual(po.status, "pending_approval"); self.assertEqual(dec(po.total), 360000)
        ap = po.approval
        self.assertEqual(ap.required_roles, ["finance"])
        self.err("forbidden", approvals.decide, u["u_pm1"], ap.id, "approved")
        self.err("forbidden", approvals.decide, u["u_ft1"], ap.id, "approved")
        approvals.decide(u["u_fin"], ap.id, "approved")
        po.refresh_from_db(); self.assertEqual(po.status, "approved")
        self.assertEqual(money.money("p1")["committed"], m0["committed"] + 360000)
        pi = po.items.first()
        self.err("invalid", money.receive_goods, u["u_sk"], po.id, {"attachmentIds": [], "lines": [{"purchaseItemId": pi.id, "qty": 2}]})
        self.err("invalid", money.receive_goods, u["u_sk"], po.id, {"attachmentIds": ["x"], "lines": [{"purchaseItemId": pi.id, "qty": 3}]})
        grn = money.receive_goods(u["u_sk"], po.id, {"attachmentIds": ["att-x"], "lines": [{"purchaseItemId": pi.id, "qty": 2}]})
        self.assertEqual(grn.review_status, "pending"); self.assertEqual(stock.balance_of("it_mccb")["qtyOnHand"], 0)
        self.err("forbidden", review.check, u["u_sk"], "goods_receipt", grn.id, "checked")
        self.err("forbidden", review.check, u["u_ft1"], "goods_receipt", grn.id, "checked")
        review.check(u["u_pm1"], "goods_receipt", grn.id, "checked")
        bal = stock.balance_of("it_mccb"); self.assertEqual(bal["qtyOnHand"], 2); self.assertEqual(bal["wacUnitCost"], 180000)
        po.refresh_from_db(); self.assertEqual(po.status, "delivered")
        self.assertEqual(money.money("p1")["actual"], m0["actual"], "stock receipt does NOT post an actual")
        po2 = money.create_po(u["u_pm1"], "p1", {"vendorId": "v_dixsen", "items": [{"inventoryItemId": "it_mccb", "description": "MCCB", "qty": 2, "unitCost": 200000}]})
        approvals.decide(u["u_fin"], po2.approval_id, "approved")
        grn2 = money.receive_goods(u["u_sk"], po2.id, {"attachmentIds": ["att-y"], "lines": [{"purchaseItemId": po2.items.first().id, "qty": 2}]})
        review.check(u["u_pm1"], "goods_receipt", grn2.id, "checked")
        bal = stock.balance_of("it_mccb"); self.assertEqual(bal["qtyOnHand"], 4); self.assertEqual(bal["wacUnitCost"], 190000, "WAC = (2×180k + 2×200k)/4")
        # issue at WAC → actual on check; no negative stock
        self.err("invalid", stock.issue_stock, u["u_sk"], {"itemId": "it_mccb", "qty": 5, "projectId": "p1"})
        iss = stock.issue_stock(u["u_sk"], {"itemId": "it_mccb", "qty": 3, "projectId": "p1"})
        self.assertEqual(dec(iss.unit_cost), 190000); self.assertEqual(stock.available("it_mccb"), 1)
        self.err("forbidden", review.check, u["u_sk"], "stock_movement", iss.id, "checked")
        a0 = money.money("p1")["actual"]
        review.check(u["u_pm1"], "stock_movement", iss.id, "checked")
        self.assertEqual(money.money("p1")["actual"], a0 + 570000)
        self.assertEqual(stock.balance_of("it_mccb")["qtyOnHand"], 1)

    def test_serialised_issue_and_director_threshold(self):
        u = self.u
        self.err("invalid", stock.issue_stock, u["u_sk"], {"itemId": "it_panel", "qty": 2, "projectId": "p2", "serials": ["JKM26-0001"]})  # 0001 already installed on p1
        free = stock.in_stock_serials("it_panel")
        self.assertTrue(len(free) >= 2)
        mv = stock.issue_stock(u["u_sk"], {"itemId": "it_panel", "qty": 2, "projectId": "p2", "serials": free[:2]})
        self.assertEqual(mv.serials, free[:2])
        self.assertNotIn(free[0], stock.in_stock_serials("it_panel"), "reserved serial is no longer offered")
        review.check(u["u_pm1"], "stock_movement", mv.id, "checked")
        a = Asset.objects.get(serial=free[0]); self.assertEqual(a.status, "installed"); self.assertEqual(a.project_id, "p2"); self.assertIsNotNone(a.warranty_end)
        big = money.create_po(u["u_pm1"], "p2", {"vendorId": "v_fouani", "items": [{"inventoryItemId": "it_inv80", "description": "Deye SUN-80K", "qty": 1, "unitCost": 12_200_000}]})
        self.assertEqual(big.approval.required_roles, ["finance", "director"])
        approvals.decide(u["u_fin"], big.approval_id, "approved")
        big.refresh_from_db(); self.assertEqual(big.status, "pending_approval", "still waiting for Director")
        self.err("forbidden", approvals.decide, u["u_fin"], big.approval_id, "approved")
        approvals.decide(u["u_dir"], big.approval_id, "approved")
        big.refresh_from_db(); self.assertEqual(big.status, "approved")

    def test_change_order_retention_writeoff(self):
        u = self.u
        p = Project.objects.get(pk="p1"); b0 = dec(p.approved_budget)
        co = money.raise_change_order(u["u_pm1"], "p1", {"title": "Extra CT", "reason": "Client asked", "scopeDelta": "+1 CT", "costDelta": 250000, "timeDeltaDays": 1})
        self.assertEqual(co.approval.required_roles, ["finance"])
        approvals.decide(u["u_fin"], co.approval_id, "approved")
        p.refresh_from_db(); self.assertEqual(dec(p.approved_budget), b0 + 250000)
        big = money.raise_change_order(u["u_pm1"], "p1", {"title": "Big", "reason": "Scope", "scopeDelta": "", "costDelta": 6_000_000, "timeDeltaDays": 5})
        self.assertEqual(big.approval.required_roles, ["finance", "director"])
        self.err("invalid", approvals.decide, u["u_fin"], big.approval_id, "rejected")  # comment required
        approvals.decide(u["u_fin"], big.approval_id, "rejected", "Not in budget")
        big.refresh_from_db(); self.assertEqual(big.status, "rejected")
        # retention
        self.err("conflict", money.request_retention_release, u["u_fin"], "p1")  # stage 4: nothing held
        ap = money.request_retention_release(u["u_fin"], "p4")
        self.assertEqual(ap.required_roles, ["director"], "Finance requester → Director only")
        approvals.decide(u["u_dir"], ap.id, "approved")
        self.assertIsNotNone(money.retention(Project.objects.get(pk="p4"))["releasedAt"])
        # write-off
        self.err("invalid", stock.write_off, u["u_sk"], {"itemId": "it_mc4", "qty": 5, "reason": "", "attachmentIds": ["a"]})
        self.err("invalid", stock.write_off, u["u_sk"], {"itemId": "it_mc4", "qty": 5, "reason": "Lost", "attachmentIds": []})
        wo = stock.write_off(u["u_sk"], {"itemId": "it_mc4", "qty": 5, "reason": "Lost in transit", "attachmentIds": ["att3"]})
        self.assertEqual(wo.approval.required_roles, ["finance"])
        q0 = stock.balance_of("it_mc4")["qtyOnHand"]
        self.err("forbidden", approvals.decide, u["u_sk"], wo.approval_id, "approved")
        approvals.decide(u["u_fin"], wo.approval_id, "approved")
        self.assertEqual(stock.balance_of("it_mc4")["qtyOnHand"], q0 - 5)
        self.err("forbidden", stock.write_off, u["u_pm1"], {"itemId": "it_mc4", "qty": 1, "reason": "x", "attachmentIds": ["a"]})

    # ---------------------------------------------------------------- maker-checker, gates, approvals
    def test_maker_checker_and_gates(self):
        u = self.u
        doc = documents.add_document(u["u_pm1"], "p7", {"docType": "roi_model", "title": "Edic ROI"})
        self.assertEqual(doc.review_status, "pending")
        self.err("forbidden", review.check, u["u_pm1"], "document", doc.id, "checked")
        self.err("forbidden", review.check, u["u_ft1"], "document", doc.id, "checked")
        self.err("invalid", review.check, u["u_le2"], "document", doc.id, "rejected")
        g = gates.gate_status("p7"); self.assertFalse(g["ready"])
        # Incomplete evidence no longer blocks the request (2026-09-20) — the checklist still reports
        # what is outstanding, and the approver decides. Coverage for that lives in
        # test_accounts.GateWithoutCompleteEvidenceTest; here we finish the evidence and carry on.
        review.check(u["u_le2"], "document", doc.id, "checked")
        sizing = Document.objects.get(project_id="p7", doc_type="sizing")
        review.check(u["u_dir"], "document", sizing.id, "checked")  # Director checks globally; u_le1 is not on p7
        g = gates.gate_status("p7"); self.assertTrue(g["ready"])
        # techlead holds gate.request (it absorbed pm), so u_le2 may request here; a tech still may not
        self.err("forbidden", gates.request_gate, u["u_ft1"], "p7")
        ap = gates.request_gate(u["u_pm1"], "p7")
        # a gate now lists the three roles trusted to move a project on, and any ONE of them is enough
        self.assertEqual(sorted(ap.required_roles), ["director", "finance", "techlead"])
        self.err("conflict", gates.request_gate, u["u_pm1"], "p7")
        # Finance may now sign a gate off — it used to be refused — and one signature is the whole
        # requirement, so the project moves on without waiting for the other two.
        self.err("forbidden", approvals.decide, u["u_ft1"], ap.id, "approved")   # a tech still cannot
        approvals.decide(u["u_fin"], ap.id, "approved")
        p = Project.objects.get(pk="p7"); self.assertEqual(p.stage, 1); self.assertIn("1", p.stage_actual)
        self.assertTrue(any(i["kind"] == "document" for i in review.review_queue(u["u_le1"])))
        self.assertEqual(review.review_queue(u["u_ft1"]), [], "field tech has no check permissions")

    def test_create_project(self):
        u = self.u
        base = {"name": "Test Client HQ — 50 kWp Solar", "clientName": "Test Client", "branchName": "HQ", "location": "Yaba, Lagos", "projectType": "solar_battery", "systemCapacityKwp": 50,
                "contractValue": 48_000_000, "approvedBudget": 41_000_000, "pmId": "u_pm2", "leadEngineerId": "u_le1", "proposalDueDate": "2026-10-01"}
        self.err("forbidden", projects.create_project, u["u_ft1"], base)
        self.err("forbidden", projects.create_project, u["u_fin"], base)
        self.err("invalid", projects.create_project, u["u_pm1"], {**base, "name": " "})
        # pm + lead_engineer merged into techlead, so u_le1 is a valid owner. A tech is not.
        self.err("invalid", projects.create_project, u["u_pm1"], {**base, "pmId": "u_ft1"})
        self.err("invalid", projects.create_project, u["u_pm1"], {**base, "leadEngineerId": "u_sk"})
        self.err("invalid", projects.create_project, u["u_pm1"], {**base, "approvedBudget": 60_000_000})
        n = Project.objects.count()
        p = projects.create_project(u["u_pm1"], base)
        self.assertEqual(Project.objects.count(), n + 1); self.assertEqual(p.stage, 0); self.assertEqual(p.code, "WYR-2026-006")
        self.assertEqual(dec(p.retention_percent), 5); self.assertEqual(p.stage_planned, {"0": "2026-10-01"})
        roles = sorted(f"{m.user_id}:{m.role}" for m in p.memberships.all()); self.assertEqual(roles, ["u_le1:techlead", "u_pm2:techlead"])
        self.assertIn(p.id, projects.visible_project_ids(u["u_ft1"]), "portfolio is company-wide — everyone sees it")
        self.assertIn(p.id, projects.my_project_ids(u["u_pm2"])); self.assertNotIn(p.id, projects.my_project_ids(u["u_ft1"]), "assignment is recorded even though it no longer gates access")
        i = field.raise_issue(u["u_ft1"], p.id, {"category": "other", "severity": "low", "title": "Company-wide roles", "description": "", "beforeAttachmentIds": ["att1"]})
        self.assertEqual(i.project_id, p.id, "roles apply company-wide, so an unassigned tech can still work on it")
        self.err("forbidden", review.check, u["u_ft1"], "issue", i.id, "checked")  # but never their own submission
        self.err("forbidden", money.create_po, u["u_ft1"], p.id, {"vendorId": "v_dixsen", "items": [{"description": "x", "qty": 1, "unitCost": 1}]})
        self.assertTrue(p.events.filter(event_type="project_created", actor=u["u_pm1"]).exists())
        self.err("conflict", projects.create_project, u["u_admin"], base)

    # ---------------------------------------------------------------- field
    def test_visits_issues_commissioning(self):
        u = self.u
        self.err("invalid", field.log_visit, u["u_ft1"], "p4", {"visitType": "routine", "startedAt": "2026-09-10T09:00:00Z", "endedAt": "2026-09-10T11:00:00Z", "findings": "ok", "actionsTaken": "", "costTravel": 0, "costLabour": 0, "attachmentIds": []})
        avail = stock.available("it_mc4", "loc_van1")
        self.err("invalid", field.log_visit, u["u_ft1"], "p4", {"visitType": "routine", "startedAt": "2026-09-10T09:00:00Z", "endedAt": "2026-09-10T11:00:00Z", "findings": "ok", "actionsTaken": "", "costTravel": 0, "costLabour": 0,
                                                            "attachmentIds": ["a"], "locationId": "loc_van1", "parts": [{"itemId": "it_mc4", "qty": float(avail) + 1}]})
        v = field.log_visit(u["u_ft1"], "p4", {"visitType": "routine", "startedAt": "2026-09-10T09:00:00Z", "endedAt": "2026-09-10T11:30:00Z", "findings": "Panels cleaned", "actionsTaken": "Cleaned", "costTravel": 10000, "costLabour": 15000,
                                              "attachmentIds": ["a"], "locationId": "loc_van1", "parts": [{"itemId": "it_mc4", "qty": 2}]})
        self.assertEqual(dec(v.duration_hrs), Decimal("2.5")); self.assertEqual(len(v.parts), 1); self.assertEqual(dec(v.cost_total), 25000 + 2 * 1500)
        a0 = money.money("p4")["actual"]
        self.err("forbidden", review.check, u["u_ft1"], "site_visit", v.id, "checked")
        review.check(u["u_pm2"], "site_visit", v.id, "checked")
        self.assertEqual(money.money("p4")["actual"], a0 + 25000 + 3000, "travel+labour and parts post on check")
        self.assertEqual(StockMovement.objects.get(pk=v.parts[0]["movementId"]).review_status, "checked")
        # issues with SLA
        self.err("invalid", field.raise_issue, u["u_ft1"], "p4", {"category": "electrical", "severity": "high", "title": "x", "description": "", "beforeAttachmentIds": []})
        i = field.raise_issue(u["u_ft1"], "p4", {"category": "electrical", "severity": "critical", "title": "Inverter down", "description": "F12", "beforeAttachmentIds": ["b"]})
        self.assertEqual((i.sla_due_at - i.raised_at).total_seconds(), 24 * 3600)
        field.set_issue_status(u["u_ft1"], i.id, "in_progress", "u_ft1")
        self.err("invalid", field.resolve_issue, u["u_ft1"], i.id, {"rootCause": "x", "resolution": "fixed", "afterAttachmentIds": []})
        field.resolve_issue(u["u_ft1"], i.id, {"rootCause": "Loose lug", "resolution": "Re-terminated", "afterAttachmentIds": ["c"], "costToResolve": 5000})
        i.refresh_from_db(); self.assertEqual(i.status, "resolved"); self.assertEqual(i.review_version, 2)
        self.err("conflict", field.set_issue_status, u["u_ft1"], i.id, "in_progress")
        review.check(u["u_pm2"], "issue", i.id, "checked")
        i.refresh_from_db(); self.assertEqual(i.status, "closed")
        # commissioning → gate-5 evidence
        items = [{"key": t["key"], "pass": True} for t in __import__("tracker.constants", fromlist=["COMMISSIONING_TEMPLATE"]).COMMISSIONING_TEMPLATE]
        self.err("invalid", field.create_commissioning, u["u_le1"], "p1", {"date": "2026-09-10", "result": "pass", "notes": "", "items": items[:-1], "meter": {}, "attachmentIds": ["a"]})
        c = field.create_commissioning(u["u_le1"], "p1", {"date": "2026-09-10", "result": "pass", "notes": "ok", "items": items, "meter": {"serialAscii": True, "ctRatioVerified": True, "firstLiveReading": True, "historicalOk": True},
                                                          "clientWitness": {"name": "Client", "signatureAttachmentId": "sig"}, "attachmentIds": ["a"]})
        # delegation: a techlead may hand commissioning to anyone for THIS site, including a tech
        self.err("forbidden", projects.assign_commissioning, u["u_ft1"], "p1", "u_ft1")
        self.assertFalse(rbac.can(u["u_ft1"], "commissioning.create", "p1"))
        projects.assign_commissioning(u["u_pm1"], "p1", "u_ft1")
        self.assertTrue(rbac.can(u["u_ft1"], "commissioning.create", "p1"), "assigned tech may record here")
        self.assertFalse(rbac.can(u["u_ft1"], "commissioning.create", "p2"), "but only on that project")
        self.assertFalse(rbac.can(u["u_ft1"], "commissioning.check", "p1"), "and still cannot check one")
        projects.assign_commissioning(u["u_pm1"], "p1", None)
        self.assertFalse(rbac.can(u["u_ft1"], "commissioning.create", "p1"), "clearing takes it away")
        self.err("forbidden", review.check, u["u_le1"], "commissioning", c.id, "checked")  # cannot check own
        self.err("forbidden", review.check, u["u_ft1"], "commissioning", c.id, "checked")  # tech has no check perm
        review.check(u["u_dir"], "commissioning", c.id, "checked")
        for t in ("commissioning_record", "meter_integrity", "client_witness", "commissioning_photos"):
            self.assertTrue(Document.objects.filter(project_id="p1", doc_type=t, review_status="checked").exists(), t)
        # warranty
        self.err("invalid", field.raise_warranty_claim, u["u_le2"], "p4", {"assetId": "nope", "notes": ""})
        w = field.raise_warranty_claim(u["u_le2"], "p4", {"assetId": Asset.objects.get(serial="DBAT-0032").id, "notes": "Cell imbalance"})
        field.update_warranty_claim(u["u_le2"], w.id, {"status": "refunded", "outcome": "Refund", "costRecovered": 120000})
        p4a = money.money("p4")["actual"]
        review.check(u["u_pm2"], "warranty", w.id, "checked")
        self.assertEqual(money.money("p4")["actual"], p4a - 120000, "checked refund credits the project")

    def test_stock_count_and_transfer(self):
        u = self.u
        self.err("invalid", stock.submit_count, u["u_sk"], "sc1")
        sc = StockCount.objects.get(pk="sc1")
        stock.enter_count(u["u_sk"], "sc1", [{"itemId": l["itemId"], "countedQty": l["expectedQty"]} for l in sc.lines if l["countedQty"] is None])
        self.err("invalid", stock.submit_count, u["u_sk"], "sc1")  # +2 fuses without a note
        stock.enter_count(u["u_sk"], "sc1", [{"itemId": "it_fuse", "countedQty": 52, "note": "found 2 in returns bin"}])
        ap = stock.submit_count(u["u_sk"], "sc1"); self.assertEqual(ap.required_roles, ["finance"])
        mc4 = stock.balance_of("it_mc4", "loc_wh")["qtyOnHand"]; fuse = stock.balance_of("it_fuse", "loc_wh")["qtyOnHand"]
        self.err("forbidden", approvals.decide, u["u_sk"], ap.id, "approved")
        approvals.decide(u["u_fin"], ap.id, "approved")
        self.assertEqual(StockCount.objects.get(pk="sc1").status, "approved")
        self.assertEqual(stock.balance_of("it_mc4", "loc_wh")["qtyOnHand"], mc4 - 8); self.assertEqual(stock.balance_of("it_fuse", "loc_wh")["qtyOnHand"], fuse + 2)
        self.err("forbidden", stock.transfer_stock, u["u_pm1"], {"itemId": "it_mc4", "qty": 1, "fromId": "loc_wh", "toId": "loc_van1"})
        t = stock.transfer_stock(u["u_sk"], {"itemId": "it_mc4", "qty": 10, "fromId": "loc_wh", "toId": "loc_van1"})
        van = stock.balance_of("it_mc4", "loc_van1")["qtyOnHand"]
        review.check(u["u_fin"], "stock_movement", t.id, "checked")
        self.assertEqual(stock.balance_of("it_mc4", "loc_van1")["qtyOnHand"], van + 10)

    def test_reconciliation(self):
        u = self.u
        bills = {b["id"]: b for b in recon.list_qb_bills()}
        self.assertEqual(bills["qb3"]["confidence"], "matched"); self.assertEqual(bills["qb5"]["confidence"], "unmatched")
        self.err("forbidden", recon.match_bill, u["u_pm1"], "qb1", "po5")
        recon.match_bill(u["u_fin"], "qb1", "po5")
        self.assertEqual({b["id"]: b for b in recon.list_qb_bills()}["qb1"]["confidence"], "matched")

    # ---------------------------------------------------------------- HTTP surface
    def test_http_snapshot_and_commands(self):
        c = APIClient()
        r = c.post("/api/v1/auth/token/", {"username": "kunle.adebayo", "password": "wyre-demo-2026"}, format="json")
        self.assertEqual(r.status_code, 200, r.content); tok = r.json()["access"]; self.assertEqual(r.json()["user"]["roles"], ["techlead"])
        self.assertEqual(c.get("/api/v1/snapshot/").status_code, 401)
        c.credentials(HTTP_AUTHORIZATION=f"Bearer {tok}")
        snap = c.get("/api/v1/snapshot/").json()
        self.assertEqual(len(snap["projects"]), Project.objects.count(), "portfolio is company-wide")
        self.assertEqual(snap["qbBills"], [], "no recon.read → no bills")
        self.assertTrue(snap["purchaseOrders"], "a PM holds money.read, so budgets come through")
        r = c.post("/api/v1/commands/addDocument/", {"projectId": "p1", "input": {"docType": "progress_photos", "title": "Week 4 photos"}}, format="json")
        self.assertEqual(r.status_code, 200, r.content); body = r.json()
        self.assertEqual(body["result"]["reviewStatus"], "pending"); self.assertEqual(body["result"]["createdBy"], "u_pm1")
        self.assertTrue(any(d["id"] == body["result"]["id"] for d in body["snapshot"]["documents"]))
        r = c.post("/api/v1/commands/check/", {"kind": "document", "id": body["result"]["id"], "decision": "checked"}, format="json")
        self.assertEqual(r.status_code, 403); self.assertEqual(r.json()["code"], "forbidden")
        r = c.post("/api/v1/commands/createPO/", {"projectId": "p3", "input": {"vendorId": "v_dixsen", "items": []}}, format="json")
        self.assertEqual(r.status_code, 400, "a PM may raise a PO on any project; this one fails only on empty lines")
        r = c.post("/api/v1/commands/decide/", {"approvalId": "ap1", "decision": "approved"}, format="json")
        self.assertEqual(r.status_code, 403, "but a PM still cannot approve a gate — the matrix decides that")
        r = c.post("/api/v1/commands/nope/", {}, format="json"); self.assertEqual(r.status_code, 404)
        # multipart upload creates a real attachment with sha256
        from django.core.files.uploadedfile import SimpleUploadedFile
        f = SimpleUploadedFile("site.jpg", b"\xff\xd8\xff\xe0 fake jpeg bytes", content_type="image/jpeg")
        r = c.post("/api/v1/commands/addAttachment/?snapshot=0", {"payload": '{"projectId": "p1", "input": {"caption": "String 4"}}', "file": f}, format="multipart")
        self.assertEqual(r.status_code, 200, r.content); att = r.json()["result"]
        self.assertEqual(att["sizeBytes"], 20); self.assertEqual(len(att["sha256"]), 64); # storage-agnostic: local FileSystemStorage gives /media/attachments/…, Spaces gives a pre-signed
        # https URL with a query string. Both are content-addressed under attachments/.
        self.assertIn("attachments/", att["url"]); self.assertTrue(att["url"].split("?")[0].endswith(".jpg")); self.assertEqual(att["reviewStatus"], "pending")
        # store keeper (global) sees everything
        r = c.post("/api/v1/auth/token/", {"username": "musa.ibrahim", "password": "wyre-demo-2026"}, format="json")
        c.credentials(HTTP_AUTHORIZATION=f"Bearer {r.json()['access']}")
        self.assertEqual(len(c.get("/api/v1/snapshot/").json()["projects"]), Project.objects.count())

    def test_tech_sees_every_project_but_no_money(self):
        """Widening visibility must not widen what the API hands out: the snapshot is gated by permission."""
        c = APIClient()
        r = c.post("/api/v1/auth/token/", {"username": "segun.alabi", "password": "wyre-demo-2026"}, format="json")
        c.credentials(HTTP_AUTHORIZATION=f"Bearer {r.json()['access']}")
        snap = c.get("/api/v1/snapshot/").json()
        self.assertEqual(len(snap["projects"]), Project.objects.count(), "sees the whole portfolio")
        for empty in ("costItems", "purchaseOrders", "actuals", "changeOrders", "retentions", "qbBills", "approvals"):
            self.assertEqual(snap[empty], [], f"field tech holds no permission for {empty}")
        self.assertTrue(snap["movements"], "but does hold inventory.read")
        self.assertTrue(snap["issues"], "and sees field records")


class ClientIdTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_demo", verbosity=0)

    def test_client_supplied_ids(self):
        pm = User.objects.get(pk="u_pm1")
        att = documents.add_attachment(pm, "p1", {"id": "att_0a1b2c3d", "fileName": "x.jpg"})
        self.assertEqual(att.id, "att_0a1b2c3d")
        with self.assertRaises(ApiError) as cm:
            documents.add_attachment(pm, "p1", {"id": "att_0a1b2c3d", "fileName": "y.jpg"})
        self.assertEqual(cm.exception.code, "conflict")
        with self.assertRaises(ApiError) as cm:
            documents.add_attachment(pm, "p1", {"id": "doc_0a1b2c3d", "fileName": "y.jpg"})
        self.assertEqual(cm.exception.code, "invalid", "prefix must match the model")
        with self.assertRaises(ApiError):
            documents.add_attachment(pm, "p1", {"id": "att1", "fileName": "y.jpg"})
        i = field.raise_issue(User.objects.get(pk="u_ft1"), "p1", {"id": "iss_deadbeef", "category": "other", "severity": "low", "title": "T", "description": "", "beforeAttachmentIds": [att.id]})
        self.assertEqual(i.id, "iss_deadbeef")


class VisitPhotoTest(TestCase):
    """Photos can be added to a visit after the fact; doing so to a checked record re-opens the review (§4.13)."""

    @classmethod
    def setUpTestData(cls):
        call_command("seed_demo", verbosity=0)
        cls.u = {u.id: u for u in User.objects.all()}

    def err(self, code, fn, *a, **k):
        with self.assertRaises(ApiError) as cm:
            fn(*a, **k)
        self.assertEqual(cm.exception.code, code, cm.exception.message)

    def photo(self, actor, project="p1", caption="extra"):
        return documents.add_attachment(actor, project, {"caption": caption, "fileName": "extra.jpg"}).id

    def test_add_photos_to_a_pending_visit(self):
        u = self.u
        v = field.log_visit(u["u_ft1"], "p1", {"visitType": "routine", "startedAt": "2026-09-10T09:00:00Z", "endedAt": "2026-09-10T11:00:00Z",
                                               "findings": "ok", "actionsTaken": "", "costTravel": 0, "costLabour": 0, "attachmentIds": [self.photo(u["u_ft1"])]})
        self.assertEqual(len(v.attachment_ids), 1)
        p2 = self.photo(u["u_ft1"], caption="second angle")
        v = field.add_visit_photos(u["u_ft1"], v.id, {"attachmentIds": [p2]})
        self.assertEqual(len(v.attachment_ids), 2)
        self.assertEqual(v.review_status, "pending")
        self.assertEqual(v.review_version, 1, "still the first submission")
        self.err("conflict", field.add_visit_photos, u["u_ft1"], v.id, {"attachmentIds": [p2]})
        self.err("invalid", field.add_visit_photos, u["u_ft1"], v.id, {"attachmentIds": []})
        self.err("invalid", field.add_visit_photos, u["u_ft1"], v.id, {"attachmentIds": [self.photo(u["u_pm2"], "p4")]})
        self.err("forbidden", field.add_visit_photos, u["u_fin"], v.id, {"attachmentIds": [self.photo(u["u_ft1"])]})

    def test_add_files_to_an_issue_at_any_stage(self):
        u = self.u
        i = field.raise_issue(u["u_ft1"], "p1", {"category": "electrical", "severity": "high", "title": "Breaker trips", "description": "d",
                                                  "beforeAttachmentIds": [self.photo(u["u_ft1"], caption="before")]})
        self.assertEqual(i.attachment_ids, [])
        quote = self.photo(u["u_ft1"], caption="supplier quote")
        i = field.add_issue_photos(u["u_ft1"], i.id, {"attachmentIds": [quote]})
        self.assertEqual(i.attachment_ids, [quote])
        self.assertEqual(i.review_status, "pending"); self.assertEqual(i.review_version, 1, "still the first submission")
        field.set_issue_status(u["u_ft1"], i.id, "awaiting_parts", None)
        i = field.add_issue_photos(u["u_ft1"], i.id, {"attachmentIds": [self.photo(u["u_ft1"], caption="parts arrived")]})
        self.assertEqual(len(i.attachment_ids), 2, "files can be added in any status")
        self.err("conflict", field.add_issue_photos, u["u_ft1"], i.id, {"attachmentIds": [quote]})
        self.err("conflict", field.add_issue_photos, u["u_ft1"], i.id, {"attachmentIds": i.before_attachment_ids}, )
        self.err("invalid", field.add_issue_photos, u["u_ft1"], i.id, {"attachmentIds": []})
        self.err("invalid", field.add_issue_photos, u["u_ft1"], i.id, {"attachmentIds": [self.photo(u["u_pm2"], "p4")]})
        self.err("forbidden", field.add_issue_photos, u["u_fin"], i.id, {"attachmentIds": [self.photo(u["u_ft1"])]})

    def test_adding_to_a_checked_issue_reopens_the_review(self):
        u = self.u
        i = field.raise_issue(u["u_ft1"], "p1", {"category": "mechanical", "severity": "low", "title": "Loose rail", "description": "d",
                                                  "beforeAttachmentIds": [self.photo(u["u_ft1"])]})
        review.check(u["u_pm1"], "issue", i.id, "checked")
        i.refresh_from_db(); self.assertEqual(i.review_status, "checked")
        i = field.add_issue_photos(u["u_ft1"], i.id, {"attachmentIds": [self.photo(u["u_ft1"], caption="late evidence")]})
        self.assertEqual(i.review_status, "pending", "a checked record that is edited goes back for review")
        self.assertEqual(i.review_version, 2); self.assertIsNone(i.checked_by)
        self.assertTrue(any("re-entered review" in e.summary for e in i.project.events.all()))

    # ---------------------------------------------------------------- VAT & client billing
    def test_contract_is_net_and_vat_is_derived(self):
        u = self.u
        p = Project.objects.get(pk="p1")
        self.assertEqual(dec(p.contract_value), dec(p.contract_value_net) + p.vat_amount, "gross = net + VAT")
        self.assertEqual(p.vat_amount, (dec(p.contract_value_net) * Decimal("7.5") / 100).quantize(Decimal("0.01")))
        np_ = projects.create_project(u["u_pm1"], {"name": "VAT job", "clientName": "Acme", "branchName": "HQ", "location": "Lagos", "projectType": "solar_battery",
                                                  "contractValueNet": 1_000_000, "pmId": "u_pm1", "leadEngineerId": "u_pm2"})
        self.assertEqual(dec(np_.contract_value_net), 1_000_000); self.assertEqual(np_.vat_amount, Decimal("75000.00")); self.assertEqual(dec(np_.contract_value), Decimal("1075000.00"))
        ex = projects.create_project(u["u_pm1"], {"name": "Exempt job", "clientName": "NGO", "branchName": "S", "location": "Abuja", "projectType": "solar_battery",
                                                 "contractValueNet": 500_000, "vatTreatment": "exempt", "pmId": "u_pm1", "leadEngineerId": "u_pm2"})
        self.assertEqual(ex.vat_amount, 0); self.assertEqual(dec(ex.contract_value), 500_000)
        self.err("invalid", projects.create_project, u["u_pm1"], {"name": "Bad", "clientName": "x", "branchName": "x", "location": "x", "projectType": "solar_battery",
                                                                    "contractValueNet": 100, "approvedBudget": 200, "pmId": "u_pm1", "leadEngineerId": "u_pm2"})
        m = money.money(np_.id)
        self.assertEqual(m["contractNet"], 1_000_000); self.assertEqual(m["vatDue"], 75_000); self.assertEqual(m["vatOutstanding"], 75_000)
        self.err("forbidden", billing.set_contract_terms, u["u_pm1"], np_.id, {"contractValueNet": 2_000_000})
        np_ = billing.set_contract_terms(u["u_fin"], np_.id, {"contractValueNet": 2_000_000, "vatTreatment": "withheld_by_client"})
        self.assertEqual(np_.vat_amount, Decimal("150000.00")); self.assertEqual(dec(np_.contract_value), Decimal("2150000.00"))
        self.assertTrue(np_.events.filter(event_type="contract_updated").exists())
        # retention on net
        p4 = Project.objects.get(pk="p4")
        self.assertEqual(money.retention(p4)["amountHeld"], float((dec(p4.contract_value_net) * dec(p4.retention_percent) / 100).to_integral_value()))

    def test_invoice_receipt_and_vat_settlement(self):
        u = self.u
        np_ = projects.create_project(u["u_pm1"], {"name": "Billing job", "clientName": "Acme", "branchName": "HQ", "location": "Lagos", "projectType": "solar_battery",
                                                  "contractValueNet": 2_000_000, "pmId": "u_pm1", "leadEngineerId": "u_pm2"})
        self.err("forbidden", billing.raise_invoice, u["u_ft1"], np_.id, {"invoiceNumber": "INV-1", "netAmount": 100})
        self.err("invalid", billing.raise_invoice, u["u_fin"], np_.id, {"invoiceNumber": "", "netAmount": 100})
        inv = billing.raise_invoice(u["u_fin"], np_.id, {"invoiceNumber": "INV-1", "description": "Mobilisation", "netAmount": 800_000})
        self.assertEqual(dec(inv.vat_amount), Decimal("60000.00")); self.assertEqual(dec(inv.gross_amount), Decimal("860000.00"))
        self.assertEqual(inv.review_status, "pending"); self.assertEqual(inv.vat_status, "outstanding")
        self.err("conflict", billing.raise_invoice, u["u_fin"], np_.id, {"invoiceNumber": "inv-1", "netAmount": 1})
        self.assertEqual(money.money(np_.id)["invoicedNet"], 0, "pending invoices do not count")
        self.err("conflict", billing.record_receipt, u["u_fin"], inv.id, {"amount": 100})
        self.assertTrue(any(q["kind"] == "client_invoice" and q["id"] == inv.id for q in review.review_queue(u["u_dir"])))
        review.check(u["u_dir"], "client_invoice", inv.id, "checked")
        self.assertEqual(money.money(np_.id)["invoicedNet"], 800_000)
        self.err("invalid", billing.record_receipt, u["u_fin"], inv.id, {"amount": 900_000})
        inv = billing.record_receipt(u["u_fin"], inv.id, {"amount": 800_000, "note": "net paid, VAT withheld"})
        self.assertEqual(money.money(np_.id)["received"], 800_000)
        # VAT is paid per project, in as many payments as it takes, each checked by Finance or a Director
        self.err("forbidden", billing.record_vat_payment, u["u_ft1"], np_.id, {"amount": 1000})
        self.err("invalid", billing.record_vat_payment, u["u_fin"], np_.id, {"amount": 0})
        cn = self.photo(u["u_fin"], np_.id, caption="VAT credit note")
        vp1 = billing.record_vat_payment(u["u_fin"], np_.id, {"amount": 60_000, "method": "withheld_by_client", "note": "INV-1 VAT", "attachmentIds": [cn]})
        self.assertEqual(vp1.review_status, "pending"); self.assertEqual(money.money(np_.id)["vatSettled"], 0); self.assertEqual(money.money(np_.id)["vatOutstanding"], 150_000)
        self.assertTrue(any(q["kind"] == "vat_payment" and q["id"] == vp1.id for q in review.review_queue(u["u_dir"])))
        review.check(u["u_dir"], "vat_payment", vp1.id, "checked")
        m = money.money(np_.id); self.assertEqual(m["vatSettled"], 60_000); self.assertEqual(m["vatOutstanding"], 90_000)
        vp2 = billing.record_vat_payment(u["u_fin"], np_.id, {"amount": 90_000, "method": "remitted", "note": "balance"})
        review.check(u["u_dir"], "vat_payment", vp2.id, "checked")
        self.assertEqual(money.money(np_.id)["vatOutstanding"], 0)
        firs = self.photo(u["u_fin"], np_.id, caption="FIRS receipt")
        vp2 = billing.add_vat_payment_receipts(u["u_fin"], vp2.id, {"attachmentIds": [firs]})
        self.assertIn(firs, vp2.attachment_ids); self.assertEqual(vp2.review_status, "pending"); self.assertEqual(vp2.review_version, 2)
        self.assertEqual(money.money(np_.id)["vatOutstanding"], 90_000, "re-entered review: stops counting until re-checked")
        self.err("conflict", billing.add_vat_payment_receipts, u["u_fin"], vp2.id, {"attachmentIds": [firs]})
        review.check(u["u_dir"], "vat_payment", vp2.id, "checked")
        self.assertEqual(money.money(np_.id)["vatOutstanding"], 0)

    def test_adding_to_a_checked_visit_reopens_the_review(self):
        u = self.u
        v = field.log_visit(u["u_ft1"], "p1", {"visitType": "inspection", "startedAt": "2026-09-10T09:00:00Z", "endedAt": "2026-09-10T10:00:00Z",
                                               "findings": "ok", "actionsTaken": "", "costTravel": 1000, "costLabour": 2000, "attachmentIds": [self.photo(u["u_ft1"])]})
        review.check(u["u_pm1"], "site_visit", v.id, "checked")
        v.refresh_from_db(); self.assertEqual(v.review_status, "checked")
        v = field.add_visit_photos(u["u_ft1"], v.id, {"attachmentIds": [self.photo(u["u_ft1"], caption="late evidence")]})
        self.assertEqual(v.review_status, "pending", "a checked record that is edited goes back for review")
        self.assertEqual(v.review_version, 2)
        self.assertIsNone(v.checked_by)
        self.assertTrue(any("re-entered review" in e.summary for e in v.project.events.all()))
