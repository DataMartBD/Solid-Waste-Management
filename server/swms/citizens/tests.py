"""The citizen portal: PIN login, who sees what, and complaints."""

from __future__ import annotations

from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from swms.accounts.models import ScopeKind, User
from swms.catalog.models import City, Zone
from swms.common.roles import Role
from swms.complaints.models import Complaint, ComplaintType
from swms.customers.models import Holding, Household
from swms.fieldops.collection_day import close_day
from swms.fieldops.models import Visit, VisitStatus
from swms.fieldops.tests import FieldOpsData

from .models import CitizenAccount

OWNER = "01711222333"
TENANT = "01811444555"


class CitizenData(FieldOpsData):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.city = City.objects.create(id="KCC", name="Khulna City Corporation")
        Zone.objects.filter(pk="Z-03").update(city=cls.city)

    def setUp(self):
        family = self.make_household("101")
        self.holding = family.holding
        # Stored the way an office user typed it, to prove matching is on digits.
        Holding.objects.filter(pk=self.holding.pk).update(owner_phone="+8801711-222333", owner_name="Karim")
        self.family = family
        Household.objects.filter(pk=family.pk).update(phone=TENANT, head="Rahim")
        self.other = self.make_household("202").holding
        self.client = APIClient()

    def login(self, phone=OWNER, pin=None):
        response = self.client.post(
            reverse("citizen-login"), {"phone": phone, "pin": pin or phone[-4:]}, format="json"
        )
        if response.status_code == 200:
            self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['token']}")
        return response


class LoginTests(CitizenData):
    def test_the_default_pin_is_the_last_four_digits(self):
        response = self.login()
        self.assertEqual(response.status_code, 200, response.data)
        account = response.data["account"]
        self.assertTrue(account["usingDefaultPin"])
        self.assertEqual(account["name"], "Karim")
        self.assertEqual([h["id"] for h in account["holdings"]], [self.holding.pk])
        self.assertEqual(account["holdings"][0]["role"], "owner")

    def test_an_unregistered_number_is_refused(self):
        response = self.login(phone="01999000111")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "citizen_not_registered")
        self.assertFalse(CitizenAccount.objects.exists())

    def test_a_wrong_pin_is_refused_and_five_lock_the_account(self):
        for _ in range(4):
            self.assertEqual(self.login(pin="9999").data["code"], "citizen_wrong_pin")
        self.assertEqual(self.login(pin="9999").data["code"], "citizen_locked")
        self.assertEqual(self.login().data["code"], "citizen_locked")

    def test_after_changing_the_pin_the_default_stops_working(self):
        self.login()
        response = self.client.put(reverse("citizen-pin"), {"currentPin": "2333", "pin": "4826"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.client.credentials()
        self.assertEqual(self.login().data["code"], "citizen_wrong_pin")
        self.assertEqual(self.login(pin="4826").status_code, 200)

    def test_a_simple_or_default_pin_cannot_be_chosen(self):
        self.login()
        for pin, code in (("1234", "citizen_pin_tooSimple"), ("2333", "citizen_pin_default")):
            response = self.client.put(reverse("citizen-pin"), {"currentPin": "2333", "pin": pin}, format="json")
            self.assertEqual(response.data["code"], code)

    def test_a_household_number_gets_household_access(self):
        account = self.login(phone=TENANT).data["account"]
        self.assertEqual(account["holdings"][0]["role"], "household")
        self.assertEqual(account["holdings"][0]["household"], self.family.pk)


class TokenSeparationTests(CitizenData):
    def test_a_citizen_token_is_refused_by_staff_endpoints(self):
        self.login()
        self.assertEqual(self.client.get("/api/holdings/").status_code, 401)

    def test_a_staff_token_is_refused_by_citizen_endpoints(self):
        staff = User.objects.create_user(phone="01700000001", name="Sup", role=Role.SUPER_ADMIN.value,
                                         password="x", scope_kind=ScopeKind.CITY)
        token = self.client.post(reverse("password-login"), {"phone": staff.phone, "password": "x"},
                                 format="json").data["access"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        self.assertEqual(self.client.get(reverse("citizen-me")).status_code, 401)


class HoldingTests(CitizenData):
    def test_another_holding_cannot_be_read(self):
        self.login()
        response = self.client.get(reverse("citizen-holding", args=[self.other.pk]))
        self.assertEqual(response.status_code, 404)

    def test_collection_shows_thirty_days_and_today(self):
        Visit.objects.create(holding=self.holding, status=VisitStatus.COLLECTED, source="scan",
                             at=timezone.now())
        self.login()
        data = self.client.get(reverse("citizen-holding", args=[self.holding.pk])).data
        self.assertEqual(len(data["collection"]["days"]), 30)
        self.assertEqual(data["collection"]["today"]["status"], "confirmed")

    def test_there_is_no_bills_endpoint(self):
        self.login()
        response = self.client.get(f"/api/citizen/holdings/{self.holding.pk}/bills/")
        self.assertEqual(response.status_code, 404)


class ComplaintTests(CitizenData):
    def complain(self, **body):
        return self.client.post(reverse("citizen-complaints"),
                                {"holding": self.holding.pk, "type": "overflow", **body}, format="json")

    def test_a_complaint_joins_the_staff_queue(self):
        self.login(phone=TENANT)
        response = self.complain(description="Bin full for two days")
        self.assertEqual(response.status_code, 201, response.data)
        complaint = Complaint.objects.get(pk=response.data["id"])
        self.assertEqual(complaint.channel, "app")
        self.assertEqual(complaint.household_id, self.family.pk)
        self.assertEqual(complaint.reporter_phone, TENANT)
        self.assertEqual(complaint.activity.first().actor, "Citizen · App")

    def test_a_missed_collection_turns_an_auto_day_into_missed(self):
        self.route = self.make_route("KDA Avenue", households=[self.family])
        today = timezone.localdate()
        close_day(self.city, today, force=True)
        self.login()
        response = self.complain(type=ComplaintType.MISSED_COLLECTION)
        self.assertEqual(response.status_code, 201, response.data)
        visit = Visit.objects.get(holding=self.holding, served_on=today)
        self.assertEqual(visit.status, VisitStatus.SKIPPED)

    def test_a_household_sees_only_its_own_complaints_and_the_owner_sees_all(self):
        Complaint.objects.create(holding=self.holding, type="other", sla=24, reporter_phone="01900111222")
        self.login(phone=TENANT)
        self.complain()
        self.assertEqual(len(self.client.get(reverse("citizen-complaints"), {"holding": self.holding.pk}).data), 1)
        self.client.credentials()
        self.login()
        self.assertEqual(len(self.client.get(reverse("citizen-complaints"), {"holding": self.holding.pk}).data), 2)

    def test_a_resolved_complaint_can_be_reopened(self):
        self.login()
        complaint = Complaint.objects.get(pk=self.complain().data["id"])
        Complaint.objects.filter(pk=complaint.pk).update(status="resolved", resolved_at=timezone.now())
        response = self.client.post(reverse("citizen-reopen", args=[complaint.pk]), {}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "open")

    def test_a_complaint_cannot_be_filed_on_someone_elses_holding(self):
        self.login()
        response = self.client.post(reverse("citizen-complaints"),
                                    {"holding": self.other.pk, "type": "overflow"}, format="json")
        self.assertEqual(response.status_code, 404)
