"""Customer domain operations that are more than a field update."""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from swms.common.exceptions import DomainError

from .models import Household, HoldingStatus, PotentialCustomer

#: Columns copied verbatim from a survey record to the new household.
_CARRIED_OVER = (
    # The holding comes across too, so a converted survey stays attached to the
    # same building rather than becoming a second, unlinked address.
    "holding_id",
    "unit",
    "ward_id",
    "road_id",
    "holding_no",
    "head",
    "phone",
    "lat",
    "lng",
    "accuracy",
    "verified",
    "verified_at",
    "verified_by_id",
    "verified_by_user_id",
    "placed_by_hand",
    "customer_type_id",
    "profession",
    "address",
    "email",
    "alt_phone",
    "contact_person",
    "blood_group",
    "members",
    "members_under5",
    "members_female",
    "storage_id",
    "holding_type_id",
    "floor",
    "suitable_time_id",
)


@transaction.atomic
def convert_potential(
    potential: PotentialCustomer,
    *,
    tier=None,
    charge: int | None = None,
    payment_mode=None,
    payment_day: int | None = None,
    qr: str | None = None,
    user=None,
) -> Household:
    """Sign a surveyed holding up for service.

    Unlike the mock — which deleted the survey row — the `PotentialCustomer` is
    kept and stamped with `converted_at`. That preserves the survey history
    (who surveyed it, why it was not served, what it used to do with its waste)
    which is exactly the data the conversion-funnel report needs. List endpoints
    hide converted rows by default, so the UI behaves as before.
    """
    if potential.converted_to_id:
        raise DomainError(
            f"{potential.id} was already converted to {potential.converted_to_id}.",
            code="already_converted",
        )

    payload = {field: getattr(potential, field) for field in _CARRIED_OVER}
    resolved_tier = tier or potential.est_tier

    if payment_mode is None:
        from swms.catalog.models import PaymentMode

        payment_mode = PaymentMode.objects.filter(pk="cash").first() or PaymentMode.objects.first()
    if payment_mode is None:
        raise DomainError("No payment modes are configured.", code="no_payment_modes")

    household = Household(
        **payload,
        tier=resolved_tier,
        status=HoldingStatus.ACTIVE,
        charge=charge if charge is not None else 0,
        payment_mode=payment_mode,
        payment_day=payment_day or 5,
        qr=qr or None,
        converted_from=potential.id,
    )
    household.save()

    potential.converted_to = household
    potential.converted_at = timezone.now()
    potential.save(update_fields=["converted_to", "converted_at", "updated_at"])
    return household


@transaction.atomic
def verify_location(
    holding, *, lat: float, lng: float, accuracy: int | None, placed_by_hand: bool, user=None
):
    """Confirm a **building's** map pin, and push it down to everyone in it.

    Verification is what makes a household routable, so it is a deliberate
    action with an audit trail rather than a plain field edit. It belongs to the
    holding: a surveyor stands in front of a building once, not once per flat —
    so pinning it makes every household in that building routable at a stroke.

    `holding` may be a `Holding` or, for the household endpoint the collector
    app already calls, a `Household`; either way the holding is what is written
    and the families are re-saved so their mirrored copy follows.
    """
    if isinstance(holding, (Household, PotentialCustomer)):
        holding = holding.holding

    holding.lat = lat
    holding.lng = lng
    holding.accuracy = accuracy
    holding.placed_by_hand = placed_by_hand
    holding.verified = True
    holding.verified_at = timezone.now()
    holding.verified_by_user = user
    holding.verified_by = getattr(user, "collector", None)
    holding.save(
        update_fields=[
            "lat",
            "lng",
            "accuracy",
            "placed_by_hand",
            "verified",
            "verified_at",
            "verified_by_user",
            "verified_by",
            "updated_at",
        ]
    )
    # save() re-runs sync_from_holding, so the mirrored pin on each family
    # follows the building's without a second source of truth.
    for row in [*holding.households.all(), *holding.surveys.all()]:
        row.save()
    return holding
