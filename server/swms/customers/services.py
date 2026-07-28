"""Customer domain operations that are more than a field update."""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from swms.common.exceptions import DomainError

from .models import Household, HoldingStatus, PotentialCustomer

#: Columns copied verbatim from a survey record to the new household.
_CARRIED_OVER = (
    "ward_id",
    "road_id",
    "holding",
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


def verify_location(
    holding, *, lat: float, lng: float, accuracy: int | None, placed_by_hand: bool, user=None
):
    """Confirm a holding's map pin.

    Verification is what makes a household routable, so it is a deliberate
    action with an audit trail rather than a plain field edit.
    """
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
    return holding
