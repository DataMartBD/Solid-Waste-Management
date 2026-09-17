"""Creating and managing operator accounts from the Users page.

The account register is the one endpoint in this project where *reading* is
privileged: it holds every operator's phone number, national ID, blood group and
next of kin. So these cover who may look at all, as much as who may write.

The other theme is self-protection. An administrator editing their own row is
the case that turns a bad edit into an unrecoverable one — there is nobody left
to undo it — so the rules against that are tested from both directions: the
things they may still change, and the things they may not.
"""

from __future__ import annotations

from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from swms.agencies.models import Agency
from swms.catalog.models import Ward, Zone
from swms.common.roles import Role

from .models import ScopeKind, User


class UserAdminFixture(TestCase):
    @classmethod
    def setUpTestData(cls):
        zone = Zone.objects.create(id="Z-03", name="Sonadanga")
        cls.ward = Ward.objects.create(id="W-14", name="Ward 14 — Sonadanga", zone=zone)
        cls.other_ward = Ward.objects.create(id="W-21", name="Ward 21 — Khalishpur", zone=zone)
        cls.agency = Agency.objects.create(name="Premier Clean", short_code="PCM")
        cls.rival = Agency.objects.create(name="Rival Clean", short_code="RVL")

        cls.admin = User.objects.create_user(
            phone="01700000001", name="Farhana Haque", role=Role.SUPER_ADMIN.value,
            password="x", scope_kind=ScopeKind.CITY,
        )
        cls.supervisor = User.objects.create_user(
            phone="01700000002", name="Supervisor", role=Role.SUPERVISOR.value,
            password="x", scope_kind=ScopeKind.CITY,
        )
        cls.collector = User.objects.create_user(
            phone="01700000003", name="Collector", role=Role.COLLECTOR.value,
            password="x", scope_kind=ScopeKind.WARD,
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def body(self, **extra):
        payload = {
            "phone": "01911000111",
            "name": "New Operator",
            "role": Role.SUPERVISOR.value,
            "scopeKind": ScopeKind.CITY,
            "password": "Kh2-street-sweep",
        }
        payload.update(extra)
        return {k: v for k, v in payload.items() if v is not None}

    def create(self, **extra):
        return self.client.post(reverse("user-list"), self.body(**extra), format="json")


class AccessTests(UserAdminFixture):
    """Who may see the register at all."""

    def test_an_agency_admin_may_list_users(self):
        response = self.client.get(reverse("user-list"))
        self.assertEqual(response.status_code, 200)

    def test_a_collector_may_not_even_read_it(self):
        """Every operator's phone, NID and next of kin — not a general read."""
        self.client.force_authenticate(self.collector)
        self.assertEqual(self.client.get(reverse("user-list")).status_code, 403)

    def test_a_supervisor_may_not_read_it_either(self):
        """Supervisors write operational records, not accounts."""
        self.client.force_authenticate(self.supervisor)
        self.assertEqual(self.client.get(reverse("user-list")).status_code, 403)

    def test_an_anonymous_caller_is_refused(self):
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(reverse("user-list")).status_code, (401, 403))

    def test_a_supervisor_cannot_create_one(self):
        self.client.force_authenticate(self.supervisor)
        self.assertEqual(self.create().status_code, 403)


class CreateTests(UserAdminFixture):
    def test_a_created_user_can_sign_in(self):
        """The point of the screen: an account that works afterwards."""
        response = self.create()
        self.assertEqual(response.status_code, 201, response.data)

        signin = APIClient().post(
            reverse("password-login"),
            {"phone": "01911000111", "password": "Kh2-street-sweep"},
            format="json",
        )
        self.assertEqual(signin.status_code, 200, signin.data)
        self.assertEqual(signin.data["user"]["name"], "New Operator")

    def test_the_password_is_hashed_not_stored(self):
        self.create()
        user = User.objects.get(phone="01911000111")
        self.assertNotEqual(user.password, "Kh2-street-sweep")
        self.assertTrue(user.check_password("Kh2-street-sweep"))

    def test_a_password_is_required(self):
        """Phone plus password is the only way in, so an account without one
        could not be used by the person it was made for."""
        response = self.create(password=None)
        self.assertEqual(response.status_code, 400)
        self.assertIn("password", response.data["fields"])

    def test_a_weak_password_is_refused(self):
        """The same validators the Profile page's own change-password runs."""
        response = self.create(password="1234")
        self.assertEqual(response.status_code, 400)
        self.assertIn("password", response.data["fields"])

    def test_the_phone_number_is_normalised(self):
        """+8801911…, 8801911… and 01911… are one person, stored the local way."""
        self.assertEqual(self.create(phone="+8801911000111").status_code, 201)
        self.assertTrue(User.objects.filter(phone="01911000111").exists())

    def test_a_duplicate_phone_is_refused_against_the_phone_field(self):
        """Not as a bare database conflict: the form has to be able to put the
        message next to the box the operator typed it in."""
        self.create()
        response = self.create()
        self.assertEqual(response.status_code, 400)
        self.assertIn("phone", response.data["fields"])

    def test_a_duplicate_is_caught_however_the_number_was_typed(self):
        """`+8801911…` is the same person as `01911…`, so it must collide."""
        self.create(phone="01911000111")
        response = self.create(phone="+8801911000111")
        self.assertEqual(response.status_code, 400)
        self.assertIn("phone", response.data["fields"])

    def test_a_ward_scoped_user_needs_a_ward(self):
        """An empty ward scope is not a narrow scope — the user sees nothing,
        anywhere, and nothing on screen would say why."""
        response = self.create(scopeKind=ScopeKind.WARD)
        self.assertEqual(response.status_code, 400)
        self.assertIn("scopeWards", response.data["fields"])

    def test_a_ward_scoped_user_with_wards_is_accepted(self):
        response = self.create(scopeKind=ScopeKind.WARD, scopeWards=[self.ward.id])
        self.assertEqual(response.status_code, 201, response.data)
        user = User.objects.get(phone="01911000111")
        self.assertEqual([w.id for w in user.scope_wards.all()], [self.ward.id])
        self.assertEqual(user.visible_ward_ids(), [self.ward.id])

    def test_a_zone_scoped_user_needs_a_zone(self):
        response = self.create(scopeKind=ScopeKind.ZONE)
        self.assertEqual(response.status_code, 400)
        self.assertIn("scopeZone", response.data["fields"])


class SelfEditTests(UserAdminFixture):
    """An administrator acting on their own row."""

    def me(self):
        return reverse("user-detail", args=[self.admin.pk])

    def test_they_may_still_fix_their_own_contact_details(self):
        response = self.client.patch(self.me(), {"email": "f@kcc.gov.bd"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.admin.refresh_from_db()
        self.assertEqual(self.admin.email, "f@kcc.gov.bd")

    def test_a_legacy_unbound_agency_admin_can_still_be_edited(self):
        """Accounts predating the tenancy boundary are agency admins with no
        agency. Re-checking stored state would make them unfixable — including
        unfixable by the administrator trying to give them the agency."""
        legacy = User.objects.create_user(
            phone="01766000001", name="Legacy", role=Role.AGENCY_ADMIN.value,
            password="x", scope_kind=ScopeKind.CITY,
        )
        url = reverse("user-detail", args=[legacy.pk])
        self.assertEqual(
            self.client.patch(url, {"email": "l@kcc.gov.bd"}, format="json").status_code, 200
        )
        fixed = self.client.patch(url, {"agency": self.agency.id}, format="json")
        self.assertEqual(fixed.status_code, 200, fixed.data)
        legacy.refresh_from_db()
        self.assertEqual(legacy.visible_agency_id(), self.agency.id)

    def test_they_may_not_change_their_own_role(self):
        """A city with one administrator who demotes themselves has nobody
        left who can put it back."""
        response = self.client.patch(
            self.me(), {"role": Role.COLLECTOR.value}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("role", response.data["fields"])
        self.admin.refresh_from_db()
        self.assertEqual(self.admin.role, Role.SUPER_ADMIN.value)

    def test_they_may_not_narrow_their_own_scope(self):
        response = self.client.patch(
            self.me(),
            {"scopeKind": ScopeKind.WARD, "scopeWards": [self.ward.id]},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_they_may_not_deactivate_themselves_by_patch(self):
        response = self.client.patch(self.me(), {"isActive": False}, format="json")
        self.assertEqual(response.status_code, 400)
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.is_active)

    def test_they_may_not_deactivate_themselves_by_action(self):
        """The button is hidden for your own row; the endpoint is not."""
        response = self.client.post(
            reverse("user-deactivate", args=[self.admin.pk]), format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.is_active)

    def test_resending_the_same_role_is_not_a_change(self):
        """A form that posts every field must not trip the guard."""
        response = self.client.patch(
            self.me(),
            {"role": Role.SUPER_ADMIN.value, "scopeKind": ScopeKind.CITY, "isActive": True},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)


class EditTests(UserAdminFixture):
    def test_a_role_can_be_changed_for_somebody_else(self):
        url = reverse("user-detail", args=[self.collector.pk])
        response = self.client.patch(url, {"role": Role.SUPERVISOR.value}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.collector.refresh_from_db()
        self.assertEqual(self.collector.role, Role.SUPERVISOR.value)

    def test_a_password_can_be_reset(self):
        url = reverse("user-detail", args=[self.collector.pk])
        response = self.client.patch(url, {"password": "Rickshaw-lane-88"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.collector.refresh_from_db()
        self.assertTrue(self.collector.check_password("Rickshaw-lane-88"))

    def test_an_edit_that_omits_the_password_leaves_it_alone(self):
        url = reverse("user-detail", args=[self.collector.pk])
        self.client.patch(url, {"name": "Renamed"}, format="json")
        self.collector.refresh_from_db()
        self.assertTrue(self.collector.check_password("x"))

    def test_an_account_with_an_empty_ward_scope_is_still_editable(self):
        """Re-validating stored scope on every edit made a bad row unfixable —
        renaming the person failed on a field the form never sent."""
        self.assertEqual(self.collector.scope_kind, ScopeKind.WARD)
        self.assertFalse(self.collector.scope_wards.exists())
        url = reverse("user-detail", args=[self.collector.pk])
        response = self.client.patch(url, {"name": "Renamed"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)

    def test_but_setting_a_ward_scope_with_no_wards_is_still_refused(self):
        url = reverse("user-detail", args=[self.collector.pk])
        response = self.client.patch(url, {"scopeKind": ScopeKind.WARD}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("scopeWards", response.data["fields"])

    def test_the_password_never_comes_back_out(self):
        response = self.client.get(reverse("user-detail", args=[self.collector.pk]))
        self.assertNotIn("password", response.data)

    def test_there_is_no_delete(self):
        """Visits, payments and surveys point at the user who recorded them with
        SET_NULL, so deleting an account would strip the name off real work."""
        url = reverse("user-detail", args=[self.collector.pk])
        self.assertEqual(self.client.delete(url).status_code, 405)
        self.assertTrue(User.objects.filter(pk=self.collector.pk).exists())

    def test_deactivating_keeps_the_row_and_stops_the_login(self):
        self.client.post(reverse("user-deactivate", args=[self.collector.pk]), format="json")
        self.collector.refresh_from_db()
        self.assertFalse(self.collector.is_active)

        signin = APIClient().post(
            reverse("password-login"),
            {"phone": self.collector.phone, "password": "x"},
            format="json",
        )
        self.assertEqual(signin.status_code, 400)
        self.assertIn("auth.accountDisabled", str(signin.data))

    def test_a_deactivated_account_can_be_brought_back(self):
        self.client.post(reverse("user-deactivate", args=[self.collector.pk]), format="json")
        self.client.post(reverse("user-activate", args=[self.collector.pk]), format="json")
        self.collector.refresh_from_db()
        self.assertTrue(self.collector.is_active)


class AgencyScopeTests(UserAdminFixture):
    """A contractor's administrator manages their own staff, not the city's."""

    def setUp(self):
        super().setUp()
        self.mine = User.objects.create_user(
            phone="01722000001", name="Mine", role=Role.COLLECTOR.value,
            password="x", agency=self.agency,
        )
        self.theirs = User.objects.create_user(
            phone="01733000001", name="Theirs", role=Role.COLLECTOR.value,
            password="x", agency=self.rival,
        )
        self.bound = User.objects.create_user(
            phone="01744000001", name="Bound Admin", role=Role.AGENCY_ADMIN.value,
            password="x", scope_kind=ScopeKind.AGENCY, agency=self.agency,
        )

    def test_a_kcc_admin_sees_every_agency(self):
        """KCC's own administrators have no agency, so nothing narrows them."""
        names = {row["name"] for row in self.client.get(reverse("user-list")).data["results"]}
        self.assertIn("Mine", names)
        self.assertIn("Theirs", names)

    def test_a_bound_admin_sees_only_their_own(self):
        self.client.force_authenticate(self.bound)
        names = {row["name"] for row in self.client.get(reverse("user-list")).data["results"]}
        self.assertIn("Mine", names)
        self.assertNotIn("Theirs", names)

    def test_a_bound_admin_cannot_reach_another_agencys_user(self):
        self.client.force_authenticate(self.bound)
        url = reverse("user-detail", args=[self.theirs.pk])
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(
            self.client.patch(url, {"name": "Hijacked"}, format="json").status_code, 404
        )

    def test_a_bound_admin_cannot_create_into_another_agency(self):
        self.client.force_authenticate(self.bound)
        response = self.create(agency=self.rival.id)
        self.assertEqual(response.status_code, 400)
        self.assertFalse(User.objects.filter(phone="01911000111").exists())

    def test_a_bound_admin_may_create_into_their_own(self):
        self.client.force_authenticate(self.bound)
        response = self.create(agency=self.agency.id)
        self.assertEqual(response.status_code, 201, response.data)
