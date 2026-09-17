"""The tenancy boundary: agency admin inside one contractor, super admin across all.

`agency_admin` changed meaning in this release. It used to be the top role and
was unconfined in practice, because nobody held an agency; it now *means*
confined, and `User.agency` is the thing doing the confining. That makes two
shapes dangerous rather than merely untidy — an agency admin with no agency, who
is confined to nothing, and a super admin with one, who is confined by a
contractor they do not answer to — so both are refused, and both are tested.

The other half is escalation. An agency admin who can mint a super admin has not
been confined at all, only inconvenienced: create the account, sign in as it, and
the boundary is gone. That path is closed at the serializer and checked here.
"""

from __future__ import annotations

from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from swms.agencies.models import Agency
from swms.catalog.models import Ward, Zone
from swms.common.roles import ADMIN_WRITERS, OPERATIONAL_WRITERS, Role, SUPER_ADMINS

from .models import ScopeKind, User


class RoleSetTests(TestCase):
    """What the role sets say, read back as plain statements."""

    def test_a_super_admin_may_write_everything_an_agency_admin_may(self):
        self.assertTrue(ADMIN_WRITERS >= SUPER_ADMINS)
        self.assertTrue(OPERATIONAL_WRITERS >= SUPER_ADMINS)

    def test_only_a_super_admin_holds_the_city_wide_acts(self):
        self.assertEqual(SUPER_ADMINS, {Role.SUPER_ADMIN})
        self.assertNotIn(Role.AGENCY_ADMIN, SUPER_ADMINS)


class ScopeBypassTests(TestCase):
    """What the two scope methods answer for each role."""

    @classmethod
    def setUpTestData(cls):
        zone = Zone.objects.create(id="Z-03", name="Sonadanga")
        cls.ward = Ward.objects.create(id="W-14", name="Ward 14 — Sonadanga", zone=zone)
        cls.agency = Agency.objects.create(name="Premier Clean", short_code="PCM")

    def test_a_super_admin_is_confined_by_no_agency(self):
        user = User.objects.create_user(
            phone="01700000010", name="Super", role=Role.SUPER_ADMIN.value,
            password="x", scope_kind=ScopeKind.CITY,
        )
        self.assertIsNone(user.visible_agency_id())
        self.assertIsNone(user.visible_ward_ids())

    def test_a_stale_agency_on_a_super_admin_does_not_confine_them(self):
        """The row can carry one from an earlier posting or a mistake on the
        form; the role has to win, or the widest account becomes the narrowest."""
        user = User.objects.create_user(
            phone="01700000011", name="Super", role=Role.SUPER_ADMIN.value,
            password="x", agency=self.agency,
        )
        self.assertIsNone(user.visible_agency_id())

    def test_a_stale_ward_scope_on_a_super_admin_does_not_blind_them(self):
        user = User.objects.create_user(
            phone="01700000012", name="Super", role=Role.SUPER_ADMIN.value,
            password="x", scope_kind=ScopeKind.WARD,
        )
        user.scope_wards.set([self.ward])
        self.assertIsNone(user.visible_ward_ids())

    def test_an_agency_admin_is_confined_to_their_agency(self):
        user = User.objects.create_user(
            phone="01700000013", name="Bound", role=Role.AGENCY_ADMIN.value,
            password="x", agency=self.agency, scope_kind=ScopeKind.AGENCY,
        )
        self.assertEqual(user.visible_agency_id(), self.agency.id)


class BoundaryFixture(TestCase):
    @classmethod
    def setUpTestData(cls):
        zone = Zone.objects.create(id="Z-03", name="Sonadanga")
        cls.ward = Ward.objects.create(id="W-14", name="Ward 14 — Sonadanga", zone=zone)
        cls.agency = Agency.objects.create(name="Premier Clean", short_code="PCM")
        cls.rival = Agency.objects.create(name="Rival Clean", short_code="RVL")

        cls.super_admin = User.objects.create_user(
            phone="01700000001", name="City Admin", role=Role.SUPER_ADMIN.value,
            password="x", scope_kind=ScopeKind.CITY,
        )
        cls.bound = User.objects.create_user(
            phone="01700000002", name="Bound Admin", role=Role.AGENCY_ADMIN.value,
            password="x", scope_kind=ScopeKind.AGENCY, agency=cls.agency,
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.super_admin)

    def body(self, **extra):
        payload = {
            "phone": "01911000111",
            "name": "New Operator",
            "role": Role.COLLECTOR.value,
            "scopeKind": ScopeKind.CITY,
            "password": "Kh2-street-sweep",
        }
        payload.update(extra)
        return {k: v for k, v in payload.items() if v is not None}

    def create(self, **extra):
        return self.client.post(reverse("user-list"), self.body(**extra), format="json")


class AgencyPairingTests(BoundaryFixture):
    """An agency admin needs an agency; a super admin must not have one."""

    def test_an_agency_admin_without_an_agency_is_refused(self):
        """Otherwise the role is a label: `visible_agency_id()` returns None and
        the account is wider than the one that made it."""
        response = self.create(role=Role.AGENCY_ADMIN.value, agency=None)
        self.assertEqual(response.status_code, 400)
        self.assertIn("agency", response.data["fields"])

    def test_an_agency_admin_with_an_agency_is_accepted_and_confined(self):
        response = self.create(role=Role.AGENCY_ADMIN.value, agency=self.agency.id)
        self.assertEqual(response.status_code, 201, response.data)
        made = User.objects.get(phone="01911000111")
        self.assertEqual(made.visible_agency_id(), self.agency.id)

    def test_a_super_admin_given_an_agency_is_refused(self):
        response = self.create(role=Role.SUPER_ADMIN.value, agency=self.agency.id)
        self.assertEqual(response.status_code, 400)
        self.assertIn("agency", response.data["fields"])

    def test_a_super_admin_without_one_is_accepted(self):
        response = self.create(role=Role.SUPER_ADMIN.value)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertIsNone(User.objects.get(phone="01911000111").visible_agency_id())

    def test_demoting_a_super_admin_to_agency_admin_needs_an_agency(self):
        made = self.create(role=Role.SUPER_ADMIN.value).data
        response = self.client.patch(
            reverse("user-detail", args=[made["id"]]),
            {"role": Role.AGENCY_ADMIN.value}, format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("agency", response.data["fields"])


class EscalationTests(BoundaryFixture):
    """A tenant must not be able to make an account wider than their own."""

    def test_an_agency_admin_cannot_grant_the_super_admin_role(self):
        self.client.force_authenticate(self.bound)
        response = self.create(role=Role.SUPER_ADMIN.value)
        self.assertEqual(response.status_code, 400)
        self.assertIn("role", response.data["fields"])
        self.assertFalse(User.objects.filter(phone="01911000111").exists())

    def test_an_agency_admin_cannot_promote_an_existing_user_either(self):
        self.client.force_authenticate(self.bound)
        made = self.create(role=Role.COLLECTOR.value, agency=self.agency.id).data
        response = self.client.patch(
            reverse("user-detail", args=[made["id"]]),
            {"role": Role.SUPER_ADMIN.value}, format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("role", response.data["fields"])

    def test_a_blank_agency_means_the_creators_own_not_unconfined(self):
        """The subtle one. Omitting the field would otherwise produce an account
        with no agency — and no agency means no confinement at all."""
        self.client.force_authenticate(self.bound)
        response = self.create(role=Role.SUPERVISOR.value)
        self.assertEqual(response.status_code, 201, response.data)
        made = User.objects.get(phone="01911000111")
        self.assertEqual(made.agency_id, self.agency.id)
        self.assertEqual(made.visible_agency_id(), self.agency.id)

    def test_a_super_admin_may_still_make_an_unbound_account(self):
        """KCC's own staff and viewers belong to no contractor."""
        response = self.create(role=Role.KCC_VIEWER.value)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertIsNone(User.objects.get(phone="01911000111").agency_id)

    def test_a_super_admin_may_grant_the_role(self):
        response = self.create(role=Role.SUPER_ADMIN.value)
        self.assertEqual(response.status_code, 201, response.data)

    def test_re_saving_a_super_admin_is_not_a_grant(self):
        """An edit that resends the unchanged role must not read as escalation."""
        made = self.create(role=Role.SUPER_ADMIN.value).data
        response = self.client.patch(
            reverse("user-detail", args=[made["id"]]),
            {"role": Role.SUPER_ADMIN.value, "name": "Renamed"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)


class CityWideActTests(BoundaryFixture):
    """The acts that belong to no single contractor."""

    def test_an_agency_admin_cannot_redraw_the_citys_wards(self):
        """Two contractors share a ward list; one of them must not own it."""
        self.client.force_authenticate(self.bound)
        response = self.client.patch(
            reverse("ward-detail", args=[self.ward.id]), {"name": "Renamed"}, format="json"
        )
        self.assertEqual(response.status_code, 403)

    def test_a_super_admin_can(self):
        response = self.client.patch(
            reverse("ward-detail", args=[self.ward.id]), {"name": "Renamed"}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)

    def test_everyone_signed_in_can_still_read_the_ward_list(self):
        """Every form offers it; restricting the write must not restrict this."""
        self.client.force_authenticate(self.bound)
        self.assertEqual(self.client.get(reverse("ward-list")).status_code, 200)

    def test_an_agency_admin_cannot_register_a_new_agency(self):
        self.client.force_authenticate(self.bound)
        response = self.client.post(
            reverse("agency-list"), {"name": "Upstart Clean", "shortCode": "UPS"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_an_agency_admin_cannot_edit_even_their_own_agency(self):
        """Agency Master is the corporation's screen. The contract, the licence
        dates and the service wards are what KCC holds a contractor to, so a
        contractor editing their own row is marking their own homework."""
        self.client.force_authenticate(self.bound)
        response = self.client.patch(
            reverse("agency-detail", args=[self.agency.id]),
            {"contactPerson": "Someone New"}, format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_but_they_can_still_read_their_own_agency(self):
        """Reads are how the app knows an agency's *name*: every signed-in user
        loads the list for the pickers on the Users and Holding screens. Closing
        that would break those for everyone, and seeing your own agency's name
        is not access to the Agency Master."""
        self.client.force_authenticate(self.bound)
        response = self.client.get(reverse("agency-list"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [row["id"] for row in response.data["results"]], [self.agency.id]
        )

    def test_an_agency_admin_cannot_record_a_remittance(self):
        """It is entered from Agency Master, and it is KCC acknowledging money
        received — not a contractor certifying money they say they sent."""
        self.client.force_authenticate(self.bound)
        response = self.client.post(
            reverse("remittance-list"),
            {"agency": self.agency.id, "period": "2026-09", "amount": "5000", "method": "cash"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_an_agency_admin_cannot_bill_the_whole_city(self):
        """`generate_bills` takes a period and nothing else — it charges every
        contractor's customers, which is not a tenant's act to perform."""
        self.client.force_authenticate(self.bound)
        response = self.client.post(
            reverse("bill-generate"), {"period": "2026-09", "dryRun": True}, format="json"
        )
        self.assertEqual(response.status_code, 403)

    def test_a_super_admin_can_bill_the_whole_city(self):
        response = self.client.post(
            reverse("bill-generate"), {"period": "2026-09", "dryRun": True}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)
