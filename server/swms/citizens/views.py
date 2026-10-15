"""The citizen portal API, under /api/citizen/.

Every view here authenticates with a citizen token only (`CitizenAuthentication`)
and every holding id is checked against the citizen's phone on each request, so
a citizen can only ever reach the buildings their number is on.
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.exceptions import NotFound
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from swms.accounts.phone import is_valid_phone, normalize_phone
from swms.accounts.validators import validate_pin
from swms.common.exceptions import DomainError
from swms.complaints import services as complaint_services
from swms.complaints.models import Channel, ComplaintPhoto, ComplaintType
from swms.complaints.views import validate_image_upload

from . import services
from .access import access_for, access_to, display_name
from .auth import CitizenAuthentication, CitizenToken
from .models import CitizenAccount

#: Photos a citizen may attach to one complaint.
MAX_PHOTOS = 3


class CitizenView(APIView):
    authentication_classes = [CitizenAuthentication]
    permission_classes = [IsAuthenticated]

    def entry(self, holding_id: str):
        entry = access_to(self.request.user.phone, holding_id)
        if entry is None:
            raise NotFound("That holding is not linked to your mobile number.")
        return entry


def account_payload(citizen: CitizenAccount, entries) -> dict:
    return {
        "phone": citizen.phone,
        "name": citizen.name,
        "usingDefaultPin": citizen.using_default_pin,
        "holdings": [services.holding_card(e) for e in entries],
    }


def complaint_payload(complaint) -> dict:
    return {
        "id": complaint.id,
        "type": complaint.type,
        "status": complaint.status,
        "description": complaint.description,
        "missedOn": complaint.missed_on.isoformat() if complaint.missed_on else None,
        "opened": complaint.opened.isoformat(),
        "resolvedAt": complaint.resolved_at.isoformat() if complaint.resolved_at else None,
        "household": complaint.household_id,
        "canReopen": complaint.is_closed_out,
        "photos": [p.image.url for p in complaint.photos.all() if p.image],
        "activity": [
            {"at": a.at.isoformat(), "action": a.action, "note": a.note}
            for a in complaint.activity.all()
        ],
    }


class LoginView(APIView):
    """`POST /api/citizen/login/` — mobile number + PIN.

    The default PIN is the last four digits of the number, until the citizen
    sets their own. The number must be on an active holding or household.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_scope = "citizen"

    @extend_schema(
        request=inline_serializer("CitizenLogin", {"phone": serializers.CharField(),
                                                   "pin": serializers.CharField()}),
        responses={200: None},
    )
    def post(self, request):
        phone = normalize_phone(request.data.get("phone"))
        pin = str(request.data.get("pin") or "").strip()
        if not is_valid_phone(phone):
            raise DomainError("Enter a valid mobile number.", code="citizen_bad_phone")

        entries = access_for(phone)
        if not entries:
            raise DomainError(
                "This mobile number is not registered. Please contact your agency or ward office.",
                code="citizen_not_registered",
            )

        citizen, _ = CitizenAccount.objects.get_or_create(phone=phone)
        if not citizen.active:
            raise DomainError("This account has been disabled.", code="citizen_inactive")
        if citizen.pin_locked:
            raise DomainError("Too many wrong PINs. Try again in 15 minutes.", code="citizen_locked")
        if not citizen.check_pin(pin):
            if citizen.pin_locked:
                raise DomainError("Too many wrong PINs. Try again in 15 minutes.", code="citizen_locked")
            raise DomainError("Wrong PIN.", code="citizen_wrong_pin")

        citizen.last_login = timezone.now()
        citizen.name = display_name(entries) or citizen.name
        citizen.save(update_fields=["last_login", "name", "updated_at"])
        return Response({
            "token": str(CitizenToken.for_citizen(citizen)),
            "account": account_payload(citizen, entries),
        })


class MeView(CitizenView):
    """`GET /api/citizen/me/` — the account and the holdings it may see."""

    def get(self, request):
        return Response(account_payload(request.user, access_for(request.user.phone)))


class PinView(CitizenView):
    """`PUT /api/citizen/pin/` — set a new PIN, proving the current one."""

    throttle_scope = "citizen"

    @extend_schema(
        request=inline_serializer("CitizenPin", {"currentPin": serializers.CharField(),
                                                 "pin": serializers.CharField()}),
        responses={200: None},
    )
    def put(self, request):
        citizen = request.user
        if citizen.pin_locked:
            raise DomainError("Too many wrong PINs. Try again in 15 minutes.", code="citizen_locked")
        if not citizen.check_pin(str(request.data.get("currentPin") or "")):
            raise DomainError("Your current PIN is wrong.", code="citizen_wrong_pin")

        pin = str(request.data.get("pin") or "").strip()
        error = validate_pin(pin)
        if error:
            raise DomainError("Choose 4 digits that are not a simple pattern.", code=f"citizen_pin_{error}")
        if pin == citizen.default_pin:
            raise DomainError("Choose a PIN other than the last 4 digits of your number.",
                              code="citizen_pin_default")
        citizen.set_pin(pin)
        citizen.save(update_fields=["pin_hash", "pin_set_at", "pin_attempts",
                                    "pin_locked_until", "updated_at"])
        return Response({"usingDefaultPin": False})


class HoldingView(CitizenView):
    """`GET /api/citizen/holdings/{id}/` — the building and its collection."""

    def get(self, request, holding_id):
        entry = self.entry(holding_id)
        return Response({
            **services.holding_card(entry),
            "qr": entry.holding.qr,
            "collection": services.collection(entry),
            "openComplaints": services.complaints_for(entry, request.user.phone)
            .filter(status__in=["open", "assigned", "in_progress"]).count(),
        })


class ComplaintsView(CitizenView):
    """`GET /api/citizen/complaints/?holding=` · `POST /api/citizen/complaints/`."""

    def get(self, request):
        entry = self.entry(request.query_params.get("holding") or "")
        rows = services.complaints_for(entry, request.user.phone)[:50]
        return Response([complaint_payload(c) for c in rows])

    @extend_schema(
        request=inline_serializer("CitizenComplaint", {
            "holding": serializers.CharField(),
            "type": serializers.ChoiceField(choices=ComplaintType.choices),
            "missedOn": serializers.DateField(required=False),
            "description": serializers.CharField(required=False, allow_blank=True),
        }),
        responses={201: None},
    )
    def post(self, request):
        entry = self.entry(request.data.get("holding") or "")
        kind = request.data.get("type") or ""
        if kind not in ComplaintType.values:
            raise DomainError("Choose what the complaint is about.", code="citizen_bad_type")
        missed_on = None
        if kind == ComplaintType.MISSED_COLLECTION and request.data.get("missedOn"):
            missed_on = serializers.DateField().to_internal_value(request.data["missedOn"])

        complaint = complaint_services.open_complaint(
            holding=entry.holding,
            household=entry.household,
            type=kind,
            missed_on=missed_on,
            channel=Channel.APP,
            description=str(request.data.get("description") or "")[:2000],
            reporter_phone=request.user.phone,
        )
        complaint.refresh_from_db()
        return Response(complaint_payload(complaint), status=201)


class ComplaintActionView(CitizenView):
    def complaint(self, complaint_id):
        citizen = self.request.user
        for entry in access_for(citizen.phone):
            found = services.complaints_for(entry, citizen.phone).filter(pk=complaint_id).first()
            if found:
                return found
        raise NotFound("No such complaint.")


class ReopenView(ComplaintActionView):
    """`POST /api/citizen/complaints/{id}/reopen/` — not fixed after all."""

    def post(self, request, complaint_id):
        complaint = complaint_services.reopen(
            self.complaint(complaint_id),
            note=str(request.data.get("note") or "Reopened by the citizen.")[:500],
            actor=complaint_services.CITIZEN_APP_ACTOR,
        )
        return Response(complaint_payload(complaint))


class PhotosView(ComplaintActionView):
    """`POST /api/citizen/complaints/{id}/photos/` — up to 3 images in all."""

    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, complaint_id):
        complaint = self.complaint(complaint_id)
        files = request.FILES.getlist("images") or request.FILES.getlist("image")
        if not files:
            raise DomainError("Attach at least one image.", code="no_file")
        if complaint.photos.count() + len(files) > MAX_PHOTOS:
            raise DomainError(f"At most {MAX_PHOTOS} photos per complaint.", code="citizen_too_many_photos")
        for upload in files:
            validate_image_upload(upload)
        with transaction.atomic():
            for upload in files:
                ComplaintPhoto.objects.create(complaint=complaint, image=upload)
            complaint_services.add_note(complaint, f"{len(files)} photo(s) attached by the citizen.",
                                        actor=complaint_services.CITIZEN_APP_ACTOR)
        complaint.refresh_from_db()
        return Response(complaint_payload(complaint))
