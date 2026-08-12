"""The editor sends no status, so nothing it saves may change one.

The register/edit page has no status picker: a building being entered is in
service, and a record retired later is handled where that decision is made.
That only holds if an absent status means "leave it alone" all the way down —
if it meant "active", every edit would quietly put a family that had moved out
back into service, and start billing them again.
"""

from __future__ import annotations

from django.urls import reverse
from rest_framework.test import APIClient

from swms.accounts.models import ScopeKind, User
from swms.common.roles import Role

from .models import Holding, Household
from .tests import HoldingData


class EditorOmitsStatusTests(HoldingData):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            phone="01700000030", name="Supervisor", role=Role.SUPERVISOR.value,
            password="x", scope_kind=ScopeKind.CITY,
        )
        self.client.force_authenticate(self.user)

    #: What the page actually posts — note the absence of any status key, on
    #: the building and on the family alike.
    def payload(self, families=None, **overrides):
        body = {
            "ward": self.ward.id, "road": self.road.name, "holdingNo": "42/K",
            "holdingType": self.holding_type.id, "ownerName": "Landlord Mia",
            "ownerPhone": "", "ownerAltPhone": "", "ownerEmail": "",
            "floors": None, "unitsTotal": None, "notes": "",
        }
        if families is not None:
            body["households"] = families
        body.update(overrides)
        return body

    def family(self, **overrides):
        row = {"head": "Shirin Akter", "unit": "1A", "tier": self.tier.id}
        row.update(overrides)
        return row

    def test_a_new_building_is_active_without_being_told_to_be(self):
        response = self.client.post(
            reverse("holding-list"), self.payload([self.family()]), format="json"
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(Holding.objects.get(pk=response.data["id"]).status, "active")

    def test_a_new_family_is_active_without_being_told_to_be(self):
        self.client.post(reverse("holding-list"), self.payload([self.family()]), format="json")
        self.assertEqual(Household.objects.get(unit="1A").status, "active")

    def test_editing_a_retired_building_does_not_revive_it(self):
        created = self.client.post(
            reverse("holding-list"), self.payload([self.family()]), format="json"
        ).data["id"]
        holding = Holding.objects.get(pk=created)
        holding.status = "inactive"
        holding.save(update_fields=["status"])

        response = self.client.patch(
            reverse("holding-detail", args=[created]),
            self.payload(ownerName="Corrected Owner"), format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        holding.refresh_from_db()
        self.assertEqual(holding.owner_name, "Corrected Owner")
        self.assertEqual(holding.status, "inactive")

    def test_editing_a_family_that_moved_out_does_not_revive_it(self):
        created = self.client.post(
            reverse("holding-list"), self.payload([self.family()]), format="json"
        ).data["id"]
        household = Household.objects.get(unit="1A")
        household.status = "inactive"
        household.save(update_fields=["status"])

        response = self.client.patch(
            reverse("holding-detail", args=[created]),
            self.payload([self.family(id=household.id, head="Corrected Name")]),
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        household.refresh_from_db()
        self.assertEqual(household.head, "Corrected Name")
        self.assertEqual(household.status, "inactive")
