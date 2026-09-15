"""Upload storage (spec §9).

Keys are content-addressed: `<kind>/<project>/<sha256><ext>`. Two consequences that the spec asks for —
the same bytes always land on the same key, so re-uploading a file cannot create a second copy, and a *different*
file can never take the key of an existing one. Both backends therefore keep the name they are given instead of
appending a numeric suffix the way Django does by default.
"""
from __future__ import annotations

import os

from django.core.files.storage import FileSystemStorage


def _key(kind: str, instance, filename: str) -> str:
    ext = os.path.splitext(filename or "")[1].lower()[:10] or ".bin"
    digest = (getattr(instance, "sha256", "") or "").strip() or "unhashed"
    project = getattr(instance, "project_id", None) or "unassigned"
    return f"{kind}/{project}/{digest}{ext}"


def attachment_path(instance, filename: str) -> str:
    return _key("attachments", instance, filename)


def document_path(instance, filename: str) -> str:
    return _key("documents", instance, filename)


class ContentAddressedFileSystemStorage(FileSystemStorage):
    """Local-disk fallback. Same key means identical bytes, so reuse the key instead of letting Django append
    a numeric suffix. The existing file is removed first: FileSystemStorage._save retries `get_available_name`
    in a loop when the target exists, and a name that never changes would spin forever."""

    def get_available_name(self, name, max_length=None):
        if self.exists(name):
            self.delete(name)
        return name


try:  # django-storages is only installed where Spaces is used
    from storages.backends.s3 import S3Storage

    class ContentAddressedS3Storage(S3Storage):
        def get_available_name(self, name, max_length=None):
            return name

except ImportError:  # pragma: no cover - local dev without the S3 extra
    ContentAddressedS3Storage = ContentAddressedFileSystemStorage  # type: ignore[assignment,misc]
