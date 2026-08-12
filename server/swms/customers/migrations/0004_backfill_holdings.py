"""Create one `Holding` per existing address and point every row at it.

Before this change a row *was* its address, so the building has to be inferred:
every household and survey sharing a (ward, road, holding_no) becomes one
holding. On the live database that is a clean 1:1 — 30 households, 6 surveys,
zero duplicate addresses — but the grouping is written to handle duplicates
because a second environment may well have them.

Ownership is seeded from the first row at each address. There is no landlord
column to copy from, and inventing a name would put fiction in a field
operators are meant to trust; where a building really has a separate owner,
someone will correct it in the Holding Master.

Reversing this drops the holdings and clears the links. The address columns on
household/potential_customer are untouched throughout — they are the mirror,
and they already hold the right values — so a rollback loses only the grouping,
never a household's address.
"""

from django.db import migrations


def backfill(apps, schema_editor):
    Holding = apps.get_model("customers", "Holding")
    Household = apps.get_model("customers", "Household")
    PotentialCustomer = apps.get_model("customers", "PotentialCustomer")
    IdSequence = apps.get_model("common", "IdSequence")

    # Households first so a building occupied by both a paying family and a
    # surveyed one takes its owner and its pin from the paying record, which is
    # the better-maintained of the two.
    rows = list(Household.objects.all().order_by("id")) + list(
        PotentialCustomer.objects.all().order_by("id")
    )
    if not rows:
        return

    seen: dict[tuple, object] = {}
    for row in rows:
        key = (row.ward_id, row.road_id, row.holding_no)
        if key not in seen:
            seen[key] = row

    holdings = []
    lookup: dict[tuple, str] = {}
    for index, (key, row) in enumerate(sorted(seen.items(), key=lambda kv: str(kv[0])), start=1):
        holding_pk = f"HLD-KCC-{index:06d}"
        lookup[key] = holding_pk
        holdings.append(
            Holding(
                id=holding_pk,
                ward_id=row.ward_id,
                road_id=row.road_id,
                holding_no=row.holding_no,
                holding_type_id=row.holding_type_id,
                owner_name=row.head,
                owner_phone=row.phone or "",
                address=row.address or "",
                lat=row.lat,
                lng=row.lng,
                accuracy=row.accuracy,
                verified=row.verified,
                verified_at=row.verified_at,
                verified_by_id=row.verified_by_id,
                verified_by_user_id=row.verified_by_user_id,
                placed_by_hand=row.placed_by_hand,
                status="active",
            )
        )
    Holding.objects.bulk_create(holdings, batch_size=500)

    for model in (Household, PotentialCustomer):
        updates = []
        for row in model.objects.all():
            row.holding_id = lookup[(row.ward_id, row.road_id, row.holding_no)]
            updates.append(row)
        model.objects.bulk_update(updates, ["holding"], batch_size=500)

    # Keep the id sequence past the highest number handed out here, or the next
    # holding created through the UI would collide with a back-filled one.
    row, created = IdSequence.objects.get_or_create(
        key="holding", defaults={"last_value": len(holdings)}
    )
    if not created and row.last_value < len(holdings):
        row.last_value = len(holdings)
        row.save(update_fields=["last_value"])


def unlink(apps, schema_editor):
    Holding = apps.get_model("customers", "Holding")
    Household = apps.get_model("customers", "Household")
    PotentialCustomer = apps.get_model("customers", "PotentialCustomer")

    Household.objects.update(holding=None)
    PotentialCustomer.objects.update(holding=None)
    Holding.objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ("customers", "0003_holding"),
        ("common", "0001_initial"),
    ]

    operations = [migrations.RunPython(backfill, unlink)]