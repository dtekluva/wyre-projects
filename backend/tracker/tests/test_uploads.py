"""Upload storage (spec §9): real bytes stored, sha256 recorded, content-addressed keys, never overwritten."""
from __future__ import annotations

import hashlib
import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from tracker.models import Attachment, Document, User
from tracker.storage import attachment_path, document_path

TMP = tempfile.mkdtemp(prefix="wyre-uploads-test-")


@override_settings(MEDIA_ROOT=TMP, STORAGES={
    "default": {"BACKEND": "tracker.storage.ContentAddressedFileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
})
class UploadTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_demo", verbosity=0)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(TMP, ignore_errors=True)
        super().tearDownClass()

    def auth(self, username="kunle.adebayo"):
        c = APIClient()
        r = c.post("/api/v1/auth/token/", {"username": username, "password": "wyre-demo-2026"}, format="json")
        c.credentials(HTTP_AUTHORIZATION=f"Bearer {r.json()['access']}")
        return c

    def png(self, body: bytes, name="site.jpg"):
        return SimpleUploadedFile(name, body, content_type="image/jpeg")

    def test_attachment_stores_bytes_and_hash(self):
        c = self.auth()
        body = b"\xff\xd8\xff\xe0 roof string 4 photo bytes"
        r = c.post("/api/v1/commands/addAttachment/?snapshot=0",
                   {"payload": '{"projectId": "p1", "input": {"caption": "String 4"}}', "file": self.png(body)}, format="multipart")
        self.assertEqual(r.status_code, 200, r.content)
        res = r.json()["result"]
        self.assertEqual(res["sha256"], hashlib.sha256(body).hexdigest(), "sha256 is of the real bytes")
        self.assertEqual(res["sizeBytes"], len(body), "declared size is the real size")
        att = Attachment.objects.get(pk=res["id"])
        self.assertEqual(att.file.read(), body, "bytes round-trip out of storage")
        self.assertEqual(att.file.name, f"attachments/p1/{att.sha256}.jpg", "key is content-addressed under the project")

    def test_same_bytes_reuse_one_key_different_bytes_never_collide(self):
        c = self.auth()
        body = b"identical delivery note bytes"
        ids = []
        for i in range(2):
            r = c.post("/api/v1/commands/addAttachment/?snapshot=0",
                       {"payload": '{"projectId": "p1", "input": {"caption": "GRN %d"}}' % i, "file": self.png(body)}, format="multipart")
            ids.append(r.json()["result"]["id"])
        a, b = (Attachment.objects.get(pk=i) for i in ids)
        self.assertNotEqual(a.id, b.id, "two separate records")
        self.assertEqual(a.file.name, b.file.name, "same bytes deduplicate onto one key")
        self.assertEqual(a.file.read(), body)
        other = b"a different photo entirely"
        r = c.post("/api/v1/commands/addAttachment/?snapshot=0",
                   {"payload": '{"projectId": "p1", "input": {"caption": "other"}}', "file": self.png(other)}, format="multipart")
        o = Attachment.objects.get(pk=r.json()["result"]["id"])
        self.assertNotEqual(o.file.name, a.file.name, "different bytes never take an existing key")
        self.assertEqual(o.file.read(), other, "and the original is untouched")

    def test_document_upload_is_hashed_and_scoped(self):
        c = self.auth()
        body = b"%PDF-1.4 signed proposal"
        r = c.post("/api/v1/commands/addDocument/?snapshot=0",
                   {"payload": '{"projectId": "p1", "input": {"docType": "progress_photos", "title": "Week 5"}}', "file": self.png(body, "week5.pdf")}, format="multipart")
        self.assertEqual(r.status_code, 200, r.content)
        d = Document.objects.get(pk=r.json()["result"]["id"])
        self.assertEqual(d.sha256, hashlib.sha256(body).hexdigest())
        self.assertEqual(d.file.name, f"documents/p1/{d.sha256}.pdf")
        self.assertEqual(r.json()["result"]["sha256"], d.sha256)

    def test_upload_still_obeys_rbac(self):
        c = self.auth("funke.ojo")  # auditor: read-only
        r = c.post("/api/v1/commands/addAttachment/?snapshot=0",
                   {"payload": '{"projectId": "p1", "input": {"caption": "nope"}}', "file": self.png(b"x")}, format="multipart")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json()["code"], "forbidden")

    def test_key_helpers_handle_missing_extension_and_project(self):
        a = Attachment(sha256="a" * 64)
        self.assertEqual(attachment_path(a, "noext"), f"attachments/unassigned/{'a'*64}.bin")
        d = Document(sha256="b" * 64, project_id="p2")
        self.assertEqual(document_path(d, "Report.PDF"), f"documents/p2/{'b'*64}.pdf")


class FileUrlTest(TestCase):
    """GET /files/<kind>/<id>/ mints a fresh signed link and re-checks permission at click time."""

    @classmethod
    def setUpTestData(cls):
        call_command("seed_demo", verbosity=0)

    def auth(self, username):
        c = APIClient()
        r = c.post("/api/v1/auth/token/", {"username": username, "password": "wyre-demo-2026"}, format="json")
        c.credentials(HTTP_AUTHORIZATION=f"Bearer {r.json()['access']}")
        return c

    def upload(self, c, project="p1"):
        f = SimpleUploadedFile("evidence.jpg", b"\xff\xd8\xff\xe0 evidence", content_type="image/jpeg")
        r = c.post("/api/v1/commands/addAttachment/?snapshot=0",
                   {"payload": '{"projectId": "%s", "input": {"caption": "x"}}' % project, "file": f}, format="multipart")
        return r.json()["result"]["id"]

    def test_resolves_for_staff_and_refuses_anonymous(self):
        pm = self.auth("kunle.adebayo")
        att_id = self.upload(pm)
        r = pm.get(f"/api/v1/files/attachment/{att_id}/")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.json()["url"])
        self.assertEqual(r.json()["fileName"], "evidence.jpg")
        # roles are company-wide, so another PM can read evidence on any project
        other = self.auth("bola.adeyemi")
        self.assertEqual(other.get(f"/api/v1/files/attachment/{att_id}/").status_code, 200)
        # unauthenticated callers still get nothing
        self.assertEqual(APIClient().get(f"/api/v1/files/attachment/{att_id}/").status_code, 401)

    def test_unknown_kind_and_missing_file(self):
        c = self.auth("kunle.adebayo")
        self.assertEqual(c.get("/api/v1/files/nope/att1/").status_code, 404)
        self.assertEqual(c.get("/api/v1/files/attachment/does-not-exist/").status_code, 404)
        # a seeded row with no uploaded bytes has nothing to hand out
        self.assertEqual(c.get("/api/v1/files/document/doc1/").status_code, 404)
