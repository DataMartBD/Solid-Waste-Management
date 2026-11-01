"""The client's registration feedback: lane, 11-digit phones, President /
Secretary, no owner email or alt phone, single collection point, optional
holding type and customer defaults."""

from __future__ import annotations

from django.urls import reverse
from rest_framework.test import APIClient

from swms.accounts.models import ScopeKind, User
from swms.common.roles import Role
from swms.fieldops.tests import FieldOpsData

from .models import CollectionPoint, Holding, Household


class FeedbackData(FieldOpsData):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user(
            phone="01799000009", name="Admin", role=Role.SUPER_ADMIN.value,
            password="x", scope_kind=ScopeKind.CITY,
        ))

    def body(self, **extra):
        return {"ward": self.ward.id, "road": self.road.name, "holdingNo": "7/A",
                "ownerName": "Karim", **extra}

    def create(self, **extra):
        return self.client.post(reverse("holding-list"), self.body(**extra), format="json")


class HoldingFeedbackTests(FeedbackData):
    def test_lane_role_and_single_point_are_saved_without_a_holding_type(self):
        response = self.create(lane="Lane 3", ownerRole="president", ownerPhone="+8801711-222333")
        self.assertEqual(response.status_code, 201, response.data)
        holding = Holding.objects.get(pk=response.data["id"])
        self.assertEqual(holding.lane, "Lane 3")
        self.assertEqual(holding.owner_role, "president")
        self.assertEqual(holding.owner_phone, "01711222333")
        self.assertIsNone(holding.holding_type)
        self.assertEqual(holding.collection_point, CollectionPoint.SINGLE)
        self.assertEqual(holding.address, "Holding 7/A, Lane 3, KDA Avenue")

    def test_a_phone_must_be_exactly_eleven_digits(self):
        for bad in ("0171122233", "017112223334", "+8801713-30014"):
            response = self.create(ownerPhone=bad)
            self.assertEqual(response.status_code, 400, bad)
            self.assertIn("ownerPhone", response.data["fields"])

    def test_owner_email_and_alt_phone_are_gone(self):
        response = self.create(ownerEmail="a@b.com", ownerAltPhone="01711000000")
        self.assertEqual(response.status_code, 201)
        self.assertNotIn("ownerEmail", response.data)
        self.assertNotIn("ownerAltPhone", response.data)

    def test_a_single_point_holding_registers_no_customers(self):
        response = self.create(collectionPoint="single", households=[{"head": "Rahim"}])
        self.assertEqual(response.status_code, 400)
        self.assertIn("households", response.data["fields"])

    def test_floor_by_floor_registers_customers_with_defaults_and_checks_their_phone(self):
        response = self.create(collectionPoint="floor", unitsTotal=2,
                               households=[{"head": "Rahim", "unit": "1A", "phone": "01811444555"}])
        self.assertEqual(response.status_code, 201, response.data)
        family = Household.objects.get(holding_id=response.data["id"])
        self.assertEqual(family.phone, "01811444555")
        self.assertIsNotNone(family.holding_type_id)  # filled by default, not asked

        bad = self.create(holdingNo="8/A", collectionPoint="floor",
                          households=[{"head": "Rahim", "phone": "12345"}])
        self.assertEqual(bad.status_code, 400)

    def test_households_equal_units_only_applies_floor_by_floor(self):
        holding = self.make_holding("9/A")
        holding.units_total = 3
        holding.collection_point = CollectionPoint.SINGLE
        holding.save()
        self.assertIsNone(holding.units_match)
        holding.collection_point = CollectionPoint.FLOOR
        holding.save()
        self.assertFalse(holding.units_match)

    def test_the_households_endpoint_refuses_a_single_point_holding(self):
        holding = self.make_holding("10/A")
        response = self.client.post(reverse("household-list"),
                                    {"holding": holding.pk, "head": "Rahim"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("holding", response.data["fields"])

        holding.collection_point = CollectionPoint.FLOOR
        holding.save()
        response = self.client.post(reverse("household-list"),
                                    {"holding": holding.pk, "head": "Rahim"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)


class FlatTableTests(FeedbackData):
    def test_flats_save_with_name_mobile_unit_members_and_occupancy(self):
        response = self.create(collectionPoint="floor", unitsTotal=2, households=[
            {"head": "Rahim", "phone": "01811444555", "unit": "1A", "members": 4, "occupancy": "own"},
            {"head": "Karim", "phone": "01812345678", "unit": "1B", "members": 2, "occupancy": "rented"},
        ])
        self.assertEqual(response.status_code, 201, response.data)
        rows = dict(Household.objects.filter(holding_id=response.data["id"]).values_list("unit", "occupancy"))
        self.assertEqual(rows, {"1A": "own", "1B": "rented"})

    def test_an_unknown_occupancy_is_refused(self):
        response = self.create(collectionPoint="floor",
                               households=[{"head": "Rahim", "unit": "1A", "occupancy": "lease"}])
        self.assertEqual(response.status_code, 400)


class TypedRoadTests(FeedbackData):
    def test_a_new_road_name_is_added_to_the_ward(self):
        from swms.catalog.models import Road

        response = self.create(road="  Notun   Rasta ")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["road"], "Notun Rasta")
        self.assertTrue(Road.objects.filter(ward=self.ward, name="Notun Rasta").exists())

    def test_a_known_road_is_matched_ignoring_case(self):
        from swms.catalog.models import Road

        before = Road.objects.count()
        response = self.create(road="kda avenue")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(Road.objects.count(), before)

    def test_a_refused_form_leaves_no_new_road(self):
        from swms.catalog.models import Road

        response = self.create(road="Ghost Road", ownerPhone="123")
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Road.objects.filter(name="Ghost Road").exists())


class CollectionPointChargeTests(FeedbackData):
    """The collection point decides the charge: one place, floor by floor, or both."""

    def flats(self, point, charge=0):
        return self.create(collectionPoint=point, charge=charge, unitsTotal=3, households=[
            {"phone": "01712345678", "head": "A", "unit": "1A", "charge": 300},
            {"phone": "01712345678", "head": "B", "unit": "1B", "charge": 200},
            {"phone": "01712345678", "head": "C", "unit": "1C"},  # partial: this flat is not charged
        ])

    def test_a_single_point_bills_the_typed_building_amount(self):
        response = self.create(collectionPoint="single", charge=500)
        self.assertEqual(response.data["effectiveCharge"], 500)

    def test_floor_by_floor_bills_the_total_of_the_flats(self):
        response = self.flats("floor", charge=999)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["effectiveCharge"], 500)  # the building amount is not used
        self.assertEqual(response.data["flatsCharge"], 500)

    def test_both_adds_the_building_and_the_flats(self):
        response = self.flats("both", charge=400)
        self.assertEqual(response.data["effectiveCharge"], 900)

    def test_the_tier_sets_no_amount(self):
        response = self.create(tier=self.tier.id, charge=0)
        self.assertEqual(response.data["effectiveCharge"], 0)

    def test_a_retired_flat_is_not_charged(self):
        holding = Holding.objects.get(pk=self.flats("floor").data["id"])
        Household.objects.filter(holding=holding, unit="1A").update(status="inactive")
        holding.refresh_from_db()
        self.assertEqual(holding.effective_charge, 200)


class KachaTests(FeedbackData):
    def test_a_kacha_house_is_always_a_single_point(self):
        from swms.catalog.models import HoldingType

        HoldingType.objects.get_or_create(id="kacha", defaults={"key": "opt.holdingType.kacha", "label": "Kacha"})
        response = self.create(holdingType="kacha", collectionPoint="floor", charge=100)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["collectionPoint"], "single")
        self.assertEqual(response.data["effectiveCharge"], 100)


class HoldingPhotoTests(FeedbackData):
    def image(self, name="front.png"):
        from io import BytesIO

        from django.core.files.uploadedfile import SimpleUploadedFile
        from PIL import Image

        buffer = BytesIO()
        Image.new("RGB", (40, 30), "green").save(buffer, "PNG")
        return SimpleUploadedFile(name, buffer.getvalue(), content_type="image/png")

    def test_a_photo_is_uploaded_shown_and_removed(self):
        import tempfile

        from django.test import override_settings

        with tempfile.TemporaryDirectory() as media, override_settings(MEDIA_ROOT=media):
            holding_id = self.create().data["id"]
            url = reverse("holding-photo", args=[holding_id])
            response = self.client.post(url, {"image": self.image()}, format="multipart")
            self.assertEqual(response.status_code, 200, response.data)
            self.assertIn("/holdings/", response.data["photoUrl"])

            response = self.client.delete(url)
            self.assertEqual(response.status_code, 200)
            self.assertIsNone(response.data["photoUrl"])

    def test_a_file_that_is_not_an_image_is_refused(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        holding_id = self.create().data["id"]
        fake = SimpleUploadedFile("x.png", b"not an image", content_type="image/png")
        response = self.client.post(reverse("holding-photo", args=[holding_id]), {"image": fake}, format="multipart")
        self.assertEqual(response.status_code, 400)


class CustomerMobileTests(FeedbackData):
    def test_a_new_customer_needs_a_mobile(self):
        response = self.create(collectionPoint="floor", households=[{"head": "Rahim", "unit": "1A"}])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(list(response.data["fields"]["households"][0]), ["phone"])
