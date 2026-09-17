"""An agency admin with no agency is the corporation's administrator, not a tenant.

`agency_admin` now *means* something it did not mean before: confined to one
contractor. `visible_agency_id()` reads `User.agency` to do the confining, so an
agency admin with that column null is not a narrower account — it is a wider one,
and after this release it is also an invalid one, because the form refuses the
pairing.

Every agency admin on record has a null agency. They were given the role because
it was the highest one available, not because they administer a contractor — and
three of them carry `is_superuser`. `super_admin` is the role that now describes
them, and moving them there is what keeps their access exactly as it is today
rather than either silently confining them to a contractor they do not belong to,
or leaving them in a state the form will not let anybody edit.

An agency admin who *does* have an agency is left alone: that one already means
what the new role says, and is now confined by it.

Reversible: going back returns them to `agency_admin`, where they had a null
agency and so were unconfined — the state they are in now.
"""

from django.db import migrations


def promote(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    unbound = User.objects.filter(role="agency_admin", agency__isnull=True)
    moved = unbound.update(role="super_admin")
    if moved:
        print(
            f"\n  {moved} agency admin(s) with no agency are now super admins. "
            f"Agency admins that do have an agency are now confined to it."
        )


def demote(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    # Only the shape `promote` could have produced. A super admin created after
    # this migration also has a null agency — the model requires it — so this is
    # not narrower than the forward step, and cannot be: nothing records which
    # of them came from where.
    User.objects.filter(role="super_admin").update(role="agency_admin")


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0004_alter_user_role"),
    ]

    operations = [migrations.RunPython(promote, demote)]
