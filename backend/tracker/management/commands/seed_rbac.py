"""Idempotent: creates the 8 roles, the §2.2 permission matrix and the §11 default thresholds. Safe to re-run on every deploy."""
from __future__ import annotations

from datetime import date

from django.core.management.base import BaseCommand

from tracker import rbac
from tracker.constants import DEFAULT_THRESHOLDS, GLOBAL_ROLES, ROLE_CODES, ROLE_LABEL
from tracker.models import Role, RolePermission, Threshold


def seed_rbac(reset_matrix: bool = False) -> None:
    for code in ROLE_CODES:
        Role.objects.update_or_create(code=code, defaults={"name": ROLE_LABEL[code], "is_global": code in GLOBAL_ROLES})
    if reset_matrix:
        RolePermission.objects.all().delete()
    for code, perms in rbac.MATRIX.items():
        for p in perms:
            RolePermission.objects.get_or_create(role_id=code, permission=p)
    for key, label, value, unit in DEFAULT_THRESHOLDS:
        Threshold.objects.get_or_create(key=key, defaults={"label": label, "value": str(value), "unit": unit, "effective_from": date(2026, 9, 1)})
    rbac.invalidate()


class Command(BaseCommand):
    help = "Seed roles, permission matrix and default thresholds (idempotent)."

    def add_arguments(self, parser):
        parser.add_argument("--reset-matrix", action="store_true", help="Discard Admin customisations and restore the spec matrix")

    def handle(self, *args, **opts):
        seed_rbac(reset_matrix=opts["reset_matrix"])
        self.stdout.write(self.style.SUCCESS(f"roles={Role.objects.count()} permissions={RolePermission.objects.count()} thresholds={Threshold.objects.count()}"))
