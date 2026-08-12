"""Drop the per-family location copy; the building's pin is the only one.

0003 kept `lat`/`lng`/`verified`/… on household and potential_customer as a
mirror of the holding's, so existing readers would not break. That copy is now
gone: those attributes are read through to `Holding` as properties, so every
reader still works while there is exactly one row that can be written.

Nothing is lost. 0004 seeded each holding's pin from the family rows in the
first place, and `verify_location()` has written the holding — not the family —
since the holding table existed. The columns being dropped hold a duplicate of
what `holding` already stores.

Reversing this re-creates the columns empty rather than repopulating them. That
is deliberate: a NULL pin reads as "not located yet", which is honest, whereas
back-filling from the holding would recreate exactly the duplicate this
migration exists to remove.
"""

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("customers", "0005_holding_required"),
        ("fieldops", "0001_initial"),
        ("accounts", "0001_initial"),
    ]

    operations = [
        # Auto-generated name from 0001; the holding's own verified index
        # (holding_verified_idx) is the one that matters now.
        migrations.RemoveIndex(model_name="household", name="household_verifie_cfaa5f_idx"),
        *[
            migrations.RemoveField(model_name=model, name=field)
            for model in ("household", "potentialcustomer")
            for field in (
                "lat",
                "lng",
                "accuracy",
                "verified",
                "verified_at",
                "verified_by",
                "verified_by_user",
                "placed_by_hand",
            )
        ],
    ]
