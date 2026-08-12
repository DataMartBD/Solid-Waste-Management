"""The demo teardown list, checked structurally rather than by running the seed.

`seed_demo --flush` deletes `_TEARDOWN` in order. Two ways that list goes wrong,
both of which have already happened once:

* a new model is added and nobody puts it in the list — `Holding` was missed,
  and the flush failed on the households that PROTECT it;
* a model is in the list but *after* something that PROTECTs it, so the delete
  raises.

Running the seed to find out is a minute of history generation, which is why
nothing did. The rule itself is cheap to check: for every PROTECT foreign key
pointing at a model in the list, the model holding that key must also be in the
list and must be deleted first.
"""

from __future__ import annotations

from io import StringIO

from django.core.management.base import CommandError, OutputWrapper
from django.core.management.color import no_style
from django.test import SimpleTestCase, TestCase

from swms.agencies.models import Agency
from swms.accounts.models import User
from swms.common.roles import Role

from .management.commands._seed import mockdata as mock
from .management.commands.seed_demo import Command, _TEARDOWN, protecting_relations

#: Cleared by `seed_demo` outside the `_TEARDOWN` loop, so their absence from it
#: is deliberate rather than an oversight. The flush removes the demo logins by
#: phone number before the loop runs; anyone else survives, which is exactly what
#: the command's pre-flight check exists to catch.
DELETED_SEPARATELY = {"User"}



class TeardownOrderTests(SimpleTestCase):
    def setUp(self):
        self.order = {model: index for index, model in enumerate(_TEARDOWN)}

    def test_nothing_in_the_list_is_protected_by_something_outside_it(self):
        """A model left out of the list will block the delete of one that is in it."""
        missing = sorted(
            f"{holder.__name__}.{name} -> {target.__name__}"
            for holder, target, name in protecting_relations()
            if target in self.order
            and holder not in self.order
            and holder.__name__ not in DELETED_SEPARATELY
        )
        self.assertEqual(
            missing, [],
            "These models PROTECT something seed_demo --flush deletes, but are "
            "not deleted themselves. Add them to _TEARDOWN, before their target.",
        )

    def test_every_protected_target_is_deleted_after_its_holder(self):
        out_of_order = sorted(
            f"{holder.__name__} (position {self.order[holder]}) must be deleted "
            f"before {target.__name__} (position {self.order[target]}), which it "
            f"PROTECTs through .{name}"
            for holder, target, name in protecting_relations()
            if holder in self.order and target in self.order
            and self.order[holder] > self.order[target]
        )
        self.assertEqual(out_of_order, [])

    def test_the_list_has_no_duplicates(self):
        self.assertEqual(len(_TEARDOWN), len(set(_TEARDOWN)))


class FlushPreflightTests(TestCase):
    """The check that runs before the first delete.

    `seed_demo --flush` spares accounts it did not create. An operator assigned
    to a demo agency therefore outlives that agency, and the delete fails on a
    `ProtectedError` naming a constraint rather than a person — after some of
    the teardown has already run. These cover the check that catches it first.
    """

    @classmethod
    def setUpTestData(cls):
        cls.agency = Agency.objects.create(name="Premier Clean", short_code="PCM")

    def flush(self, **options):
        command = Command()
        command.stdout = OutputWrapper(StringIO())
        command.style = no_style()
        command._flush(**options)
        return command.stdout._out.getvalue()

    def test_a_clean_database_flushes(self):
        self.flush()
        self.assertFalse(Agency.objects.exists())

    def test_a_demo_operator_does_not_block_it(self):
        """The flush deletes those accounts itself, so they are not survivors."""
        User.objects.create_user(
            phone=mock.OPERATORS[0]["phone"], name="Demo", role=Role.AGENCY_ADMIN.value,
            password="x", agency=self.agency,
        )
        self.flush()
        self.assertFalse(Agency.objects.exists())

    def test_an_outside_operator_blocks_it_and_is_named(self):
        User.objects.create_user(
            phone="01799999999", name="Real Operator", role=Role.AGENCY_ADMIN.value,
            password="x", agency=self.agency,
        )
        with self.assertRaises(CommandError) as caught:
            self.flush()
        message = str(caught.exception)
        self.assertIn("Real Operator", message)
        self.assertIn("--detach", message)

    def test_nothing_is_deleted_when_the_check_refuses(self):
        """The point of running it first: a refusal costs nothing."""
        User.objects.create_user(
            phone="01799999999", name="Real Operator", role=Role.AGENCY_ADMIN.value,
            password="x", agency=self.agency,
        )
        with self.assertRaises(CommandError):
            self.flush()
        self.assertTrue(Agency.objects.exists())

    def test_detach_clears_the_reference_and_keeps_the_account(self):
        user = User.objects.create_user(
            phone="01799999999", name="Real Operator", role=Role.AGENCY_ADMIN.value,
            password="x", agency=self.agency,
        )
        output = self.flush(detach=True)
        self.assertIn("Detached 1", output)
        user.refresh_from_db()
        self.assertIsNone(user.agency_id)
        # The account itself is not demo data and must survive.
        self.assertTrue(User.objects.filter(pk=user.pk).exists())
        self.assertFalse(Agency.objects.exists())

    def test_an_untouched_operator_is_left_alone_by_detach(self):
        clean = User.objects.create_user(
            phone="01788888888", name="Unrelated", role=Role.SUPERVISOR.value, password="x"
        )
        User.objects.create_user(
            phone="01799999999", name="Real Operator", role=Role.AGENCY_ADMIN.value,
            password="x", agency=self.agency,
        )
        self.flush(detach=True)
        clean.refresh_from_db()
        self.assertEqual(clean.name, "Unrelated")
