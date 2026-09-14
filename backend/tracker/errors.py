"""ApiError mirrors packages/api ApiError: code ∈ forbidden | invalid | not_found | conflict → 403 | 400 | 404 | 409."""
from __future__ import annotations

from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_handler

HTTP = {"forbidden": 403, "invalid": 400, "not_found": 404, "conflict": 409}


class ApiError(Exception):
    def __init__(self, message: str, code: str = "invalid"):
        super().__init__(message)
        self.message = message
        self.code = code if code in HTTP else "invalid"


def exception_handler(exc, context):
    if isinstance(exc, ApiError):
        return Response({"code": exc.code, "message": exc.message}, status=HTTP[exc.code])
    resp = drf_handler(exc, context)
    if resp is not None and isinstance(resp.data, dict) and "code" not in resp.data:
        detail = resp.data.get("detail", resp.data)
        resp.data = {"code": "http_%d" % resp.status_code, "message": str(detail)}
    return resp
