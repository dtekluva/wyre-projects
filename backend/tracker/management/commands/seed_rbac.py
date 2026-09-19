"""Idempotent: creates the 8 roles, the §2.2 permission matrix and the §11 default thresholds. Safe to re-run on every deploy."""
from __future__ import annotations

from datetime import date

from django.core.management.base import BaseCommand

from tracker import rbac
from tracker.constants import DEFAULT_THRESHOLDS, GLOBAL_ROLES, ROLE_CODES, ROLE_LABEL
from tracker.models import Role, RolePermission, Threshold


def seed_rbac(reset_matrix: bool = False) -> None:
    """A handful of statements, not one per row. This runs on every container start, and a
    row-at-a-time loop costs ~400 round trips — trivial against a local socket, ten minutes
    against a managed cluster a continent away."""
    Role.objects.bulk_create(
        [Role(code=code, name=ROLE_LABEL[code], is_global=code in GLOBAL_ROLES) for code in ROLE_CODES],
        update_conflicts=True, update_fields=["name", "is_global"], unique_fields=["code"],
    )

    if reset_matrix:
        RolePermission.objects.all().delete()
    # one read to learn what exists, one write for whatever is missing
    wanted = {(code, p) for code, perms in rbac.MATRIX.items() for p in perms}
    have = set(RolePermission.objects.values_list("role_id", "permission"))
    RolePermission.objects.bulk_create(
        [RolePermission(role_id=code, permission=p) for code, p in sorted(wanted - have)],
        ignore_conflicts=True,
    )

    # defaults only: an existing threshold has been tuned by someone and must not be overwritten
    existing = set(Threshold.objects.values_list("key", flat=True))
    Threshold.objects.bulk_create(
        [Threshold(key=key, label=label, value=str(value), unit=unit, effective_from=date(2026, 9, 1))
         for key, label, value, unit in DEFAULT_THRESHOLDS if key not in existing],
        ignore_conflicts=True,
    )
    rbac.invalidate()


class Command(BaseCommand):
    help = "Seed roles, permission matrix and default thresholds (idempotent)."

    def add_arguments(self, parser):
        parser.add_argument("--reset-matrix", action="store_true", help="Discard Admin customisations and restore the spec matrix")

    def handle(self, *args, **opts):
        seed_rbac(reset_matrix=opts["reset_matrix"])
        self.stdout.write(self.style.SUCCESS(f"roles={Role.objects.count()} permissions={RolePermission.objects.count()} thresholds={Threshold.objects.count()}"))
