"""Complaint domain tests.

These cover the rules the mock enforced only by hiding buttons — the lifecycle
guards, the SLA clock and the audit trail — plus the upload check, because that
one is a security boundary rather than a convenience.

Reference rows are built inline instead of loaded from a fixture so the required
columns stay visible: a household needs a ward, a road inside that ward, a tier,
a payment mode and the whole contact profile before a complaint can exist.
"""

from __future__ import annotations

from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone

from swms.catalog.models import (
    CustomerType,
    HoldingType,
    PaymentMode,
    Road,
    StorageType,
    SuitableTime,
    Tier,
    Ward,
    Zone,
)
from swms.common.exceptions import DomainError
from swms.customers.models import Holding, Household
from swms.fieldops.models import Collector

from . import services
from .models import (
    SLA_HOURS,
    ActivityAction,
    Complaint,
    ComplaintStatus,
    Priority,
)
from .views import validate_image_upload


def _option(model, key: str):
    return model.objects.create(id=key, key=f"opt.{key}", label=key.title())


class ComplaintTestCase(TestCase):
    @classmethod
    def setUpTestData(cls):
        zone = Zone.objects.create(id="Z-03", name="Sonadanga")
        cls.ward = Ward.objects.create(id="W-14", name="Ward 14 — Sonadanga", zone=zone)
        cls.road = Road.objects.create(ward=cls.ward, name="KDA Avenue")

        cls.tier = Tier.objects.create(
            id="residential_standard", key="opt.tier.std", label="Residential", charge=150
        )
        profile = {
            "customer_type": _option(CustomerType, "residential"),
            "storage": _option(StorageType, "bin"),
            "holding_type": _option(HoldingType, "house"),
            "suitable_time": _option(SuitableTime, "morning"),
        }
        cls.payment_mode = _option(PaymentMode, "cash")

        def _holding(number):
            return Holding.objects.create(
                ward=cls.ward,
                road=cls.road,
                holding_no=number,
                holding_type=profile["holding_type"],
                owner_name=f"Owner {number}",
                verified=True,
            )

        cls.household = Household.objects.create(
            holding=_holding("142/B"),
            head="Rahima Begum",
            phone="01711000001",
            tier=cls.tier,
            payment_mode=cls.payment_mode,
            **profile,
        )
        cls.other_household = Household.objects.create(
            holding=_holding("143/A"),
            head="Karim Mia",
            tier=cls.tier,
            payment_mode=cls.payment_mode,
            **profile,
        )
        cls.collector = Collector.objects.create(name="Abdul Karim", ward=cls.ward)
        cls.other_collector = Collector.objects.create(name="Sultana Razia", ward=cls.ward)

    # --- helpers ----------------------------------------------------------- #

    def make(self, *, household=None, hours_ago: float = 0, **kwargs) -> Complaint:
        kwargs.setdefault("type", "missed_collection")
        kwargs.setdefault("priority", Priority.MEDIUM)
        return services.open_complaint(
            household=household or self.household,
            opened=timezone.now() - timedelta(hours=hours_ago),
            **kwargs,
        )

    # --- SLA --------------------------------------------------------------- #

    def test_sla_hours_derive_from_priority(self):
        for priority, hours in SLA_HOURS.items():
            with self.subTest(priority=priority):
                complaint = self.make(priority=priority)
                self.assertEqual(complaint.sla, hours)

    def test_explicit_sla_overrides_the_priority_default(self):
        complaint = self.make(priority=Priority.LOW, sla=6)
        self.assertEqual(complaint.sla, 6)

    def test_changing_priority_recomputes_sla(self):
        complaint = self.make(priority=Priority.LOW)
        self.assertEqual(complaint.sla, SLA_HOURS[Priority.LOW])

        services.change_priority(complaint, Priority.URGENT)
        complaint.refresh_from_db()
        self.assertEqual(complaint.priority, Priority.URGENT)
        self.assertEqual(complaint.sla, SLA_HOURS[Priority.URGENT])

    def test_sla_state_breaches_only_while_active(self):
        complaint = self.make(priority=Priority.URGENT, hours_ago=10)  # budget 4h
        state = complaint.sla_state()
        self.assertTrue(state["active"])
        self.assertTrue(state["breached"])
        self.assertLess(state["remaining"], 0)

        services.resolve_with(complaint, "Cleared the overflow.")
        settled = complaint.sla_state()
        self.assertFalse(settled["active"])
        self.assertFalse(settled["breached"])

    def test_sla_state_stops_the_clock_at_resolved_at(self):
        complaint = self.make(priority=Priority.URGENT, hours_ago=10)
        # Resolved two hours after it was opened, then left alone for eight more.
        complaint.status = ComplaintStatus.RESOLVED
        complaint.resolved_at = complaint.opened + timedelta(hours=2)
        complaint.save(update_fields=["status", "resolved_at"])

        state = complaint.sla_state()
        self.assertAlmostEqual(state["elapsed"], 2.0, places=1)
        self.assertFalse(state["breached"])

    # --- lifecycle guards -------------------------------------------------- #

    def test_advance_refuses_when_already_closed(self):
        complaint = self.make()
        services.assign(complaint, self.collector)
        for _ in range(3):  # assigned -> in_progress -> resolved -> closed
            services.advance(complaint)
        self.assertEqual(complaint.status, ComplaintStatus.CLOSED)

        with self.assertRaises(DomainError) as caught:
            services.advance(complaint)
        self.assertEqual(caught.exception.code, "already_closed")

    def test_advance_from_open_requires_an_assignee(self):
        complaint = self.make()
        self.assertIsNone(complaint.assigned_id)

        with self.assertRaises(DomainError) as caught:
            services.advance(complaint)
        self.assertEqual(caught.exception.code, "no_assignee")

        services.assign(complaint, self.collector)
        self.assertEqual(complaint.status, ComplaintStatus.ASSIGNED)

    def test_assigning_moves_open_to_assigned_and_reassigning_is_a_distinct_event(self):
        complaint = self.make()
        services.assign(complaint, self.collector)
        self.assertEqual(
            complaint.activity.latest("at", "id").action, ActivityAction.ASSIGNED
        )

        services.assign(complaint, self.other_collector)
        self.assertEqual(complaint.assigned_id, self.other_collector.id)
        self.assertEqual(
            complaint.activity.latest("at", "id").action, ActivityAction.REASSIGNED
        )

    def test_assigning_the_same_collector_writes_nothing(self):
        complaint = self.make()
        services.assign(complaint, self.collector)
        before = complaint.activity.count()

        services.assign(complaint, self.collector)
        self.assertEqual(complaint.activity.count(), before)

    def test_reopen_only_from_resolved_or_closed(self):
        complaint = self.make()
        with self.assertRaises(DomainError) as caught:
            services.reopen(complaint)
        self.assertEqual(caught.exception.code, "not_settled")

        services.resolve_with(complaint, "Fixed.")
        services.reopen(complaint, note="Citizen says it is still there.")
        complaint.refresh_from_db()
        self.assertEqual(complaint.status, ComplaintStatus.OPEN)
        # The clock restarts from `opened`, so both stamps are cleared.
        self.assertIsNone(complaint.resolved_at)
        self.assertIsNone(complaint.closed_at)

    # --- audit trail ------------------------------------------------------- #

    def test_creating_writes_a_created_entry(self):
        complaint = self.make()
        entries = list(complaint.activity.all())
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].action, ActivityAction.CREATED)

    def test_every_mutation_appends_exactly_one_activity_row(self):
        complaint = self.make(priority=Priority.LOW)
        mutations = [
            lambda: services.assign(complaint, self.collector),
            lambda: services.change_priority(complaint, Priority.URGENT),
            lambda: services.add_note(complaint, "Called the citizen back."),
            lambda: services.advance(complaint),  # assigned -> in_progress
            lambda: services.resolve_with(complaint, "Bin emptied."),
            lambda: services.reopen(complaint),
        ]
        count = complaint.activity.count()
        for index, mutate in enumerate(mutations):
            with self.subTest(step=index):
                mutate()
                count += 1
                self.assertEqual(complaint.activity.count(), count)

    def test_an_empty_note_is_refused(self):
        complaint = self.make()
        with self.assertRaises(DomainError) as caught:
            services.add_note(complaint, "   ")
        self.assertEqual(caught.exception.code, "empty_note")

    def test_unauthenticated_tickets_are_signed_with_their_channel(self):
        complaint = self.make(channel="sms")
        self.assertEqual(complaint.activity.first().actor, services.CITIZEN_SMS_ACTOR)

    # --- triage ordering --------------------------------------------------- #

    def test_triage_order_puts_a_breached_urgent_ticket_above_a_fresh_low_one(self):
        breached = self.make(priority=Priority.URGENT, hours_ago=10)
        fresh = self.make(household=self.other_household, priority=Priority.LOW)
        settled = self.make(priority=Priority.URGENT, hours_ago=30)
        services.resolve_with(settled, "Done.")

        order = list(services.triage_order(Complaint.objects.all()).values_list("id", flat=True))
        self.assertEqual(order.index(breached.id), 0)
        self.assertLess(order.index(fresh.id), order.index(settled.id))

    def test_triage_order_breaks_priority_ties_oldest_first(self):
        older = self.make(priority=Priority.MEDIUM, hours_ago=5)
        newer = self.make(household=self.other_household, priority=Priority.MEDIUM)
        order = list(services.triage_order(Complaint.objects.all()).values_list("id", flat=True))
        self.assertLess(order.index(older.id), order.index(newer.id))

    # --- uploads ----------------------------------------------------------- #

    def test_a_non_image_upload_is_rejected_by_declared_type(self):
        upload = SimpleUploadedFile("notes.txt", b"just some text", content_type="text/plain")
        with self.assertRaises(DomainError) as caught:
            validate_image_upload(upload)
        self.assertEqual(caught.exception.code, "unsupported_type")

    def test_a_non_image_masquerading_as_a_jpeg_is_rejected(self):
        """The client's content_type is a claim, not evidence — Pillow decides."""
        upload = SimpleUploadedFile(
            "payload.jpg", b"#!/bin/sh\nrm -rf /\n", content_type="image/jpeg"
        )
        with self.assertRaises(DomainError) as caught:
            validate_image_upload(upload)
        self.assertEqual(caught.exception.code, "not_an_image")

    def test_a_real_png_passes_and_the_file_pointer_is_rewound(self):
        # Smallest valid PNG: a 1x1 transparent pixel.
        png = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06"
            b"\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05"
            b"\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        upload = SimpleUploadedFile("pixel.png", png, content_type="image/png")
        self.assertEqual(validate_image_upload(upload), "image/png")
        self.assertEqual(upload.tell(), 0)
