"""Eight roles become six (2026-09-19).

    admin          -> director        (director is now the only role that manages users and thresholds)
    pm             -> techlead        (merged with lead_engineer)
    lead_engineer  -> techlead
    field_tech     -> tech            (renamed)
    director / finance / store_keeper / auditor unchanged

Users are moved to their new role BEFORE the old Role rows are deleted — deleting a Role cascades through
the User.roles join table, so doing it the other way round would silently strip people of every permission.
"""
from __future__ import annotations

from django.db import migrations

RENAMES = {"admin": "director", "pm": "techlead", "lead_engineer": "techlead", "field_tech": "tech"}
NEW_ROLES = [
    ("director", "Director", True),
    ("techlead", "Tech Lead", False),
    ("tech", "Tech", False),
    ("finance", "Finance", True),
    ("store_keeper", "Store Keeper", True),
    ("auditor", "Auditor", True),
]


def forwards(apps, schema_editor):
    Role = apps.get_model("tracker", "Role")
    User = apps.get_model("tracker", "User")
    Membership = apps.get_model("tracker", "ProjectMembership")

    for code, name, is_global in NEW_ROLES:
        Role.objects.update_or_create(code=code, defaults={"name": name, "is_global": is_global})

    for old, new in RENAMES.items():
        if not Role.objects.filter(code=old).exists():
            continue
        target = Role.objects.get(code=new)
        for user in User.objects.filter(roles__code=old).distinct():
            user.roles.add(target)
            user.roles.remove(Role.objects.get(code=old))
        # ProjectMembership.role is a plain string, not a FK, so nothing cascades — update it explicitly
        Membership.objects.filter(role=old).update(role=new)

    keep = {c for c, _, _ in NEW_ROLES}
    Role.objects.exclude(code__in=keep).delete()   # cascades RolePermission; the matrix is re-seeded after


# No reverse: the merge is lossy — techlead cannot be split back into pm and lead_engineer.


class Migration(migrations.Migration):
    dependencies = [("tracker", "0004_notification_emailed_at")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
