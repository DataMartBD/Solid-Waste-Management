"""Shared model building blocks."""

from django.db import models

# Re-exported so `makemigrations` picks the sequence table up under this app.
from .ids import IdSequence  # noqa: F401


class TimeStampedModel(models.Model):
    """Audit columns every domain table carries."""

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class TextKeyModel(TimeStampedModel):
    """A record whose primary key is a human-readable string.

    Ids come from swms.common.ids so the database keeps the same identifiers the
    UI displays (`HH-KCC-0012840`, `RT-W-14-01`, `CMP-20714`).
    """

    id = models.CharField(max_length=32, primary_key=True, editable=False)

    class Meta:
        abstract = True

    def __str__(self) -> str:
        return self.id


class OptionModel(models.Model):
    """A lookup list rendered in a <select>.

    `key` is the i18n key the React dictionaries already use
    (`'opt.tier.residential_standard'`) and `label` is the English fallback —
    the frontend needs both, so both are stored.
    """

    id = models.CharField(max_length=48, primary_key=True)
    key = models.CharField(max_length=96)
    label = models.CharField(max_length=96)
    sort_order = models.PositiveSmallIntegerField(default=0)
    active = models.BooleanField(default=True)

    class Meta:
        abstract = True
        ordering = ["sort_order", "id"]

    def __str__(self) -> str:
        return self.label
