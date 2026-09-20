from __future__ import annotations

import json

from django.db import transaction
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from . import rbac, serializers as S
from .commands import COMMANDS
from .services import accounts, tokens
from .errors import ApiError
from .services import approvals as approvals_svc, money as money_svc, recon as recon_svc, review as review_svc, stock as stock_svc


class HealthView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        return Response({"ok": True, "service": "wyre-tracker"})


class PasswordResetRequestView(APIView):
    """POST {email}. Always 200 — saying whether an address has an account is an enumeration oracle."""
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        accounts.request_reset(request.data.get("email") or "")
        return Response({"ok": True})


class LinkPreviewView(APIView):
    """GET — who an invite or reset link belongs to, so the screen can greet them before they type."""
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, kind, token):
        salt = tokens.INVITE if kind == "invite" else tokens.RESET
        return Response(accounts.preview(token, salt))


class SetPasswordView(APIView):
    """POST {password} against an invite or reset link. The link is spent once the hash changes."""
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request, kind, token):
        salt = tokens.INVITE if kind == "invite" else tokens.RESET
        user = accounts.set_password(token, salt, request.data.get("password") or "")
        return Response({"ok": True, "username": user.username})


class TokenView(TokenObtainPairView):
    """POST {username, password} → {access, refresh, user}."""

    def post(self, request, *args, **kwargs):
        resp = super().post(request, *args, **kwargs)
        if resp.status_code == 200:
            from .models import User
            u = User.objects.get(username=request.data.get("username"))
            resp.data["user"] = S.user(u)
        return resp


class RefreshView(TokenRefreshView):
    pass


class MeView(APIView):
    def get(self, request):
        return Response({"user": S.user(request.user)})


class SnapshotView(APIView):
    """Full read model for the signed-in user; the web app computes gates, money, balances and queues locally from it."""

    def get(self, request):
        return Response(S.snapshot(request.user))


class CommandView(APIView):
    """POST /commands/<name>/ — body is JSON (or multipart with `payload` JSON + `file`). Returns {result, snapshot}."""

    def post(self, request, name: str):
        handler = COMMANDS.get(name)
        if handler is None:
            raise ApiError(f"Unknown command {name}", "not_found")
        upload = request.FILES.get("file")
        if upload is not None or "payload" in request.data:
            try:
                body = json.loads(request.data.get("payload") or "{}")
            except json.JSONDecodeError:
                raise ApiError("payload must be JSON", "invalid")
        else:
            body = request.data if isinstance(request.data, dict) else {}
        with transaction.atomic():
            result = handler(request.user, body, upload)
        want = request.query_params.get("snapshot", "1") != "0"
        return Response({"result": result, "snapshot": S.snapshot(request.user) if want else None})


class FileUrlView(APIView):
    """A signed URL is short-lived, so links are resolved when the user clicks rather than when the page loaded.
    Re-checks read permission on the owning project before handing one out."""

    def get(self, request, kind: str, id: str):
        from .models import Attachment, Document
        model = {"document": Document, "attachment": Attachment}.get(kind)
        if model is None:
            raise ApiError("Unknown file kind", "not_found")
        obj = model.objects.filter(pk=id).first()
        if obj is None or not obj.file:
            raise ApiError("File not found", "not_found")
        perm = "document.read" if kind == "document" else "attachment.read"
        if not rbac.can(request.user, perm, obj.project_id):
            raise ApiError(f'Your role does not allow "{perm}" here', "forbidden")
        name = getattr(obj, "file_name", None) or obj.file.name.rsplit("/", 1)[-1]
        return Response({"url": obj.file.url, "fileName": name})


class NotificationsView(APIView):
    """GET: my alerts, unread first. POST: mark read — {ids: [...]} or {all: true}."""

    def get(self, request):
        from .models import Notification
        rows = Notification.objects.filter(recipient=request.user).order_by("read_at", "-created_at")[:200]
        return Response({"notifications": [S.notification(n) for n in rows],
                         "unread": Notification.objects.filter(recipient=request.user, read_at__isnull=True).count()})

    def post(self, request):
        from django.utils import timezone
        from .models import Notification
        qs = Notification.objects.filter(recipient=request.user, read_at__isnull=True)
        if not request.data.get("all"):
            ids = request.data.get("ids") or []
            if not isinstance(ids, list) or not ids:
                raise ApiError("Pass ids: [...] or all: true", "invalid")
            qs = qs.filter(pk__in=[str(i) for i in ids])
        n = qs.update(read_at=timezone.now())
        return Response({"marked": n})


class ReviewQueueView(APIView):
    def get(self, request):
        return Response([{**{k: v for k, v in it.items() if k != "item"}, "item": S.serialize(it["item"])} for it in review_svc.review_queue(request.user)])


class ApprovalsForMeView(APIView):
    def get(self, request):
        return Response([S.approval(a) for a in approvals_svc.approvals_for(request.user)])


class MoneyView(APIView):
    def get(self, request, project_id: str):
        return Response(money_svc.money(project_id))


class BalancesView(APIView):
    def get(self, request):
        return Response({"balances": stock_svc.balances(), "value": stock_svc.stock_value()})


class QbBillsView(APIView):
    def get(self, request):
        if not __import__("tracker.rbac", fromlist=["can"]).can(request.user, "recon.read"):
            raise ApiError('Your role does not allow "recon.read" here', "forbidden")
        return Response(recon_svc.list_qb_bills())
