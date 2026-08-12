"""Create the block divisions of a ward.

    manage.py seed_blocks                          # Block-A..D in every ward
    manage.py seed_blocks --through F              # Block-A..F instead
    manage.py seed_blocks --ward W-14              # just that one
    manage.py seed_blocks --ward W-14 --names "Shibbari, Boyra, Gollamari"

A block is the patch a surveyor is given to walk; a ward is too coarse for
door-to-door work. The lettered scheme is what the printed survey form uses, so
it is the default — but a corporation that calls its blocks by name loads those
instead with `--names`, and nothing about the module cares which it is.

Re-running is safe. Blocks are matched on (ward, name), so this adds what is
missing and leaves alone what is there; it never renames or deletes, because a
block id may already be written across surveys.
"""

from __future__ import annotations

from string import ascii_uppercase

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from swms.catalog.models import Block, Ward


class Command(BaseCommand):
    help = "Create Block rows under wards."

    def add_arguments(self, parser):
        parser.add_argument(
            "--ward", action="append", dest="wards", metavar="WARD_ID",
            help="Limit to this ward. Repeatable. Defaults to every active ward.",
        )
        parser.add_argument(
            "--through", default="D", metavar="LETTER",
            help="Last letter of the lettered scheme, e.g. 'F' for Block-A..F. Default D.",
        )
        parser.add_argument(
            "--names", default="",
            help="Comma-separated block names to use instead of letters. "
                 "Needs a single --ward, since names are not shared between wards.",
        )
        parser.add_argument(
            "--dry-run", action="store_true",
            help="Print what would be created and write nothing.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        wards = self._wards(options["wards"])
        names = [n.strip() for n in options["names"].split(",") if n.strip()]

        if names and len(wards) != 1:
            raise CommandError(
                "--names applies to one ward; pass a single --ward with it. "
                "Block names are the ward's own, not a scheme shared across the city."
            )

        made, skipped = [], []
        for ward in wards:
            for order, name in enumerate(names or self._letters(options["through"]), start=1):
                block_id = self._id_for(ward, name, order)
                if Block.objects.filter(ward=ward, name__iexact=name).exists():
                    skipped.append(f"{ward.id} {name}")
                    continue
                if not options["dry_run"]:
                    Block.objects.create(
                        id=block_id, ward=ward, name=name, sort_order=order
                    )
                made.append(f"{block_id}  {name}  ({ward.short_label})")

        for line in made:
            self.stdout.write(f"  + {line}")
        if skipped:
            self.stdout.write(self.style.WARNING(
                f"  {len(skipped)} already existed and were left alone: "
                f"{', '.join(skipped[:6])}{'…' if len(skipped) > 6 else ''}"
            ))
        verb = "Would create" if options["dry_run"] else "Created"
        self.stdout.write(self.style.SUCCESS(
            f"{verb} {len(made)} block(s) across {len(wards)} ward(s)."
        ))

    # ------------------------------------------------------------------ #

    def _wards(self, ids):
        if not ids:
            wards = list(Ward.objects.filter(active=True))
            if not wards:
                raise CommandError("There are no active wards to divide.")
            return wards
        wards = list(Ward.objects.filter(id__in=ids))
        missing = set(ids) - {w.id for w in wards}
        if missing:
            raise CommandError(f"No such ward(s): {', '.join(sorted(missing))}.")
        return wards

    def _letters(self, through):
        last = (through or "D").strip().upper()
        if len(last) != 1 or last not in ascii_uppercase:
            raise CommandError(f"--through wants a single letter A-Z, not '{through}'.")
        return [f"Block-{c}" for c in ascii_uppercase[: ascii_uppercase.index(last) + 1]]

    def _id_for(self, ward, name, order):
        """'W-14' + 'Block-A' -> 'W-14-A'; a named block falls back to its number.

        The id is read by people — it appears on a survey and in an export — so
        the letter is carried through where there is one. `Block.id` is 16
        characters, which a long name would overrun, hence the numeric fallback.
        """
        suffix = name.rsplit("-", 1)[-1].strip()
        if not (len(suffix) == 1 and suffix.upper() in ascii_uppercase):
            suffix = f"{order:02d}"
        candidate = f"{ward.id}-{suffix.upper()}"
        if len(candidate) > 16:
            raise CommandError(f"Block id '{candidate}' is longer than 16 characters.")
        return candidate
