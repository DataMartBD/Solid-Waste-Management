"""Agency Reports — money: collector cash in hand, and dues ageing.

Both take the caller's scope (`ward_ids`, `agency_id`) the same way the other
reports do. Neither is shown to the City Viewer (see `IsAgencyReporter`).
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict

from django.db.models import Sum
from django.utils import timezone

#: Days a collector may hold cash before it is late, then overdue.
CASH_LATE_DAYS = 3
CASH_OVERDUE_DAYS = 7

#: Ageing buckets by days past the due date: (key, lowest day, highest day).
AGE_BUCKETS = (
    ("notDue", None, 0),
    ("d0_30", 1, 30),
    ("d31_60", 31, 60),
    ("d61_90", 61, 90),
    ("d90", 91, None),
)


def _bucket(days: int) -> str:
    for key, low, high in AGE_BUCKETS:
        if (low is None or days >= low) and (high is None or days <= high):
            return key
    return AGE_BUCKETS[-1][0]


def cash_in_hand(*, ward_ids=None, agency_id=None, today=None) -> dict:
    """Money each collector has taken from customers and not yet handed in.

    A payment is "in hand" until a deposit covers it (`Payment.deposit` is set by
    `record_deposit`). Age is counted from the oldest payment still in hand.
    """
    from swms.billing.models import Deposit, Payment
    from swms.fieldops.models import Collector

    today = today or timezone.localdate()
    payments = Payment.objects.filter(collector__isnull=False, deposit__isnull=True)
    collectors = Collector.objects.all()
    if agency_id is not None:
        payments = payments.filter(agency_id=agency_id)
        collectors = collectors.filter(agency_id=agency_id)
    if ward_ids is not None:
        payments = payments.filter(holding__ward_id__in=ward_ids)

    held = defaultdict(lambda: {"amount": 0, "payments": 0, "oldest": None, "methods": defaultdict(int)})
    for p in payments.values("collector_id", "amount", "at", "method__label"):
        row = held[p["collector_id"]]
        row["amount"] += p["amount"]
        row["payments"] += 1
        day = timezone.localtime(p["at"]).date()
        row["oldest"] = day if row["oldest"] is None or day < row["oldest"] else row["oldest"]
        row["methods"][p["method__label"] or "—"] += p["amount"]

    last_at = {}
    for d in Deposit.objects.filter(collector_id__in=held.keys()).values("collector_id", "at"):
        when = timezone.localtime(d["at"]).date()
        if d["collector_id"] not in last_at or when > last_at[d["collector_id"]]:
            last_at[d["collector_id"]] = when

    names = {c.id: c for c in collectors.select_related("agency").filter(id__in=held.keys())}
    rows = []
    for cid, row in held.items():
        c = names.get(cid)
        if c is None:  # outside the agency asked for
            continue
        days = (today - row["oldest"]).days
        status = "overdue" if days > CASH_OVERDUE_DAYS else "late" if days >= CASH_LATE_DAYS else "ok"
        rows.append({
            "id": cid, "name": c.name, "dspId": c.dsp_id, "phone": c.phone,
            "agency": c.agency.name if c.agency_id else "",
            "amount": row["amount"], "payments": row["payments"],
            "oldest": row["oldest"].isoformat(), "days": days, "status": status,
            "methods": ", ".join(f"{m} {a}" for m, a in sorted(row["methods"].items())),
            "lastDeposit": last_at[cid].isoformat() if cid in last_at else None,
        })
    rows.sort(key=lambda r: (-r["days"], -r["amount"]))
    return {
        "rows": rows,
        "total": sum(r["amount"] for r in rows),
        "overdue": sum(r["amount"] for r in rows if r["status"] == "overdue"),
        "collectors": len(rows),
        "lateDays": CASH_LATE_DAYS, "overdueDays": CASH_OVERDUE_DAYS,
    }


def dues_ageing(*, by="holding", ward_ids=None, agency_id=None, today=None) -> dict:
    """Unpaid money, split by how long past its due date, per holding or per ward.

    A bill with no due date is counted from the day it was issued.
    """
    from swms.billing.models import Bill

    today = today or timezone.localdate()
    bills = Bill.objects.filter(status__in=("unpaid", "partial", "overdue"))
    if ward_ids is not None:
        bills = bills.filter(ward_id__in=ward_ids)
    if agency_id is not None:
        bills = bills.filter(holding__agency_id=agency_id)
    bills = bills.annotate(paid=Sum("payments__amount")).values(
        "id", "amount", "paid", "due_on", "issued_at", "period", "holding_id",
        "holding__holding_no", "holding__owner_name", "holding__owner_phone",
        "holding__road__name", "ward_id", "ward__name",
    )

    keys = [k for k, _, _ in AGE_BUCKETS]
    groups: dict[str, dict] = {}
    totals = dict.fromkeys(keys, 0)
    for b in bills:
        owed = max(b["amount"] - (b["paid"] or 0), 0)
        if not owed:
            continue
        due = b["due_on"] or b["issued_at"]
        bucket = _bucket((today - due).days if due else 0)
        totals[bucket] += owed
        if by == "ward":
            key = b["ward_id"]
            seed = {"ward": b["ward_id"], "wardName": b["ward__name"], "holdings": set()}
        else:
            key = b["holding_id"]
            seed = {"holding": b["holding_id"], "holdingNo": b["holding__holding_no"],
                    "owner": b["holding__owner_name"], "phone": b["holding__owner_phone"],
                    "road": b["holding__road__name"], "ward": b["ward_id"], "wardName": b["ward__name"],
                    "oldestPeriod": b["period"]}
        row = groups.setdefault(key, {**seed, "bills": 0, "outstanding": 0, **dict.fromkeys(keys, 0)})
        row["bills"] += 1
        row["outstanding"] += owed
        row[bucket] += owed
        if by == "ward":
            row["holdings"].add(b["holding_id"])
        elif b["period"] < row["oldestPeriod"]:
            row["oldestPeriod"] = b["period"]

    rows = list(groups.values())
    for row in rows:
        if by == "ward":
            row["holdings"] = len(row["holdings"])
        row["over60"] = row["d61_90"] + row["d90"]
    rows.sort(key=lambda r: (-r["d90"], -r["over60"], -r["outstanding"]))
    return {"rows": rows, "totals": {**totals, "outstanding": sum(totals.values())},
            "buckets": keys, "by": by, "asOf": today.isoformat()}
