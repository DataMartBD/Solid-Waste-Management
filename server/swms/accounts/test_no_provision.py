"""Signing in never creates a staff account.

An unknown number completing the SMS-code login used to become a new
'Field Operator' collector. Staff accounts are now made on the Users page only.
"""

from __future__ import annotations

from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from swms.common.roles import Role

from .models import OtpCode, ScopeKind, User


class NoAutoProvisionTests(TestCase):
    def verify(self, phone):
        _row, code = OtpCode.issue(phone)
        return APIClient().post(reverse("otp-verify"), {"phone": phone, "code": code}, format="json")

    def test_an_unknown_number_is_refused_and_no_account_is_made(self):
        response = self.verify("01713100009")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "account_unknown")
        self.assertFalse(User.objects.filter(phone="01713100009").exists())

    def test_an_existing_staff_account_still_signs_in(self):
        User.objects.create_user(phone="01713100008", name="Rafiq", role=Role.COLLECTOR,
                                 scope_kind=ScopeKind.WARD)
        response = self.verify("01713100008")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(User.objects.filter(phone="01713100008").count(), 1)
