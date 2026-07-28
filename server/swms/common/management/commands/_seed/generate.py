"""Everything mockData.js computed at import time.

Records stay as plain dicts with the mock's own key names, because that is what
makes this file checkable against the JavaScript line by line. `load.py` turns
them into model instances.

The draw order of the PRNG is load-bearing: a JavaScript object literal evaluates
its values top to bottom, and short-circuiting `?:` / `||` skip draws entirely.
Every place that happens is marked, because reordering two lines here silently
changes the whole dataset.
"""

from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass

from swms.common.ids import bill_id

from .js import Lcg, add_months, js_round, natural_key
from .mockdata import (
    BILL_MONTHS,
    BLOOD_GROUPS,
    COLLECTORS,
    CURRENT_PRACTICES,
    FLOORS,
    FRIDAY,
    HEAD_NAMES,
    HISTORY_DAYS,
    HISTORY_SEED,
    HOLDING_TYPES,
    HOUSEHOLDS,
    PAYMENT_MODES,
    POTENTIAL_CUSTOMERS,
    POTENTIAL_REASONS,
    PROFESSIONS,
    RELATIONS,
    ROADS_BY_WARD,
    ROUTE_WINDOWS,
    SKIP_REASONS,
    STORAGE_TYPES,
    SUITABLE_TIMES,
    TIERS,
    TIME_GAPS,
    UNVERIFIED,
    WARD_CENTERS,
    effective_charge,
    tier_charge,
)


@dataclass(frozen=True)
class Dataset:
    """One complete demo dataset, ready to load."""

    households: list[dict]
    potential: list[dict]
    routes: list[dict]
    assignments: list[dict]
    visits: list[dict]
    bills: list[dict]
    payments: list[dict]
    deposits: list[dict]


def build(today: dt.date) -> Dataset:
    homes = build_households()
    routes = build_routes(homes)
    assignments = build_assignments(routes)
    return Dataset(
        households=homes,
        potential=build_potential_customers(),
        routes=routes,
        assignments=assignments,
        **build_history(homes, routes, assignments, today),
    )


# --------------------------------------------------------------------------- #
# Households
# --------------------------------------------------------------------------- #


def generate_extra() -> list[dict]:
    """`generateExtra()` — four scattered homes per ward, so routes are populated."""
    rnd = Lcg(HISTORY_SEED)
    tier_ids = [tier["id"] for tier in TIERS]
    homes: list[dict] = []
    n = 0
    head_index = 0

    for ward_id, (centre_lat, centre_lng) in WARD_CENTERS.items():
        roads = ROADS_BY_WARD[ward_id]
        ward_collectors = [c for c in COLLECTORS if c["zone"] == ward_id]
        for k in range(4):
            n += 1
            head = HEAD_NAMES[head_index % len(HEAD_NAMES)]
            head_index += 1
            tier = tier_ids[rnd.below(len(tier_ids))]
            dues_roll = rnd.next()
            dues = (
                0
                if dues_roll < 0.55
                else js_round(tier_charge(tier) * (1 if dues_roll < 0.85 else 2))
            )
            homes.append(
                {
                    "id": f"HH-KCC-05{n:03d}",
                    "qr": f"SS-05{n:03d}",
                    "ward": ward_id,
                    "road": rnd.pick(roads),
                    "holding": f"{100 + n}{'/A' if k % 2 else ''}",
                    "head": head,
                    "phone": f"+8801713-3{n:04d}",
                    "tier": tier,
                    "status": "active" if rnd.next() < 0.92 else "inactive",
                    "dues": dues,
                    "lat": round(centre_lat + (rnd.next() - 0.5) * 0.0085, 4),
                    "lng": round(centre_lng + (rnd.next() - 0.5) * 0.0085, 4),
                }
            )

            # generateExtra() also emitted a July visit and a July bill per home.
            # Both are dead in the mock — buildHistory() replaces them wholesale —
            # but their draws still have to be taken, or every later home shifts.
            if (k % 2 == 0 or k == 3) and ward_collectors:
                rnd.next()  # visit.synced
            paid_roll = rnd.next()
            if dues == 0 and paid_roll < 0.8:  # bill.status === 'paid'
                rnd.next()  # pick(['cash', 'bkash', 'nagad'])
    return homes


def attach_profile(record: dict, index: int) -> dict:
    """`attachProfile` — the customer sheet, layered on deterministically by index."""
    tier = record.get("tier") or record.get("estTier") or ""
    commercial = tier.startswith("commercial")
    members = 0 if commercial else 3 + (index % 5)
    slug = _slug(record["head"])
    profile = {
        "customerType": (
            ("institutional" if index % 4 == 0 else "commercial") if commercial else "residential"
        ),
        "profession": PROFESSIONS[index % len(PROFESSIONS)],
        "address": f"Holding {record['holding']}, {record['road']}",
        "email": f"{slug}@mail.com" if index % 3 == 0 else "",
        "altPhone": f"+8801912-{str(200000 + index * 37)[-6:]}" if index % 2 == 0 else "",
        "contactPerson": (
            f"{RELATIONS[index % len(RELATIONS)]} — {record['head'].split(' ')[0]} family"
            if index % 2 == 0
            else ""
        ),
        "bloodGroup": BLOOD_GROUPS[index % len(BLOOD_GROUPS)],
        "members": members,
        "membersUnder5": (1 if index % 3 == 0 else 0) if members else 0,
        "membersFemale": 1 + (index % 3) if members else 0,
        "storage": STORAGE_TYPES[index % len(STORAGE_TYPES)]["id"],
        "holdingType": (
            HOLDING_TYPES[4 + (index % 2)]["id"] if commercial else HOLDING_TYPES[index % 4]["id"]
        ),
        "floor": FLOORS[index % len(FLOORS)],
        "suitableTime": SUITABLE_TIMES[index % len(SUITABLE_TIMES)]["id"],
        # A few holdings negotiated a rate away from their tier's standard charge.
        # The rest get the tier charge written out verbatim rather than the 0 that
        # Household.charge treats as "use the tier": `effective_charge` returns the
        # same number either way, and this keeps bill amounts identical to the mock.
        "charge": tier_charge(tier) + 50 if index % 7 == 3 else tier_charge(tier),
        "paymentMode": PAYMENT_MODES[index % len(PAYMENT_MODES)]["id"],
        "paymentDay": 1 + (index % 10),
    }
    return {**profile, **record}


def attach_verification(record: dict, index: int) -> dict:
    """`attachVerification` — a pin nobody has stood at is not a location."""
    if record["id"] in UNVERIFIED:
        return {
            **record,
            "lat": None,
            "lng": None,
            "verified": False,
            "verifiedAt": None,
            "verifiedBy": None,
            "accuracy": None,
        }
    return {
        **record,
        "verified": True,
        "verifiedAt": f"2026-07-0{1 + (index % 4)}",
        "verifiedBy": COLLECTORS[index % len(COLLECTORS)]["id"],
        "accuracy": 4 + (index % 9),
    }


def attach_survey(record: dict, index: int) -> dict:
    """`attachSurvey` — profile minus payment terms, plus the "to be customer" answers.

    Payment terms are absent on purpose: nothing is billed until the holding is
    signed up, so they are only agreed at conversion time.
    """
    profile = attach_profile(record, index)
    for terms in ("charge", "paymentMode", "paymentDay"):
        profile.pop(terms)
    return {
        **profile,
        "reason": POTENTIAL_REASONS[index % len(POTENTIAL_REASONS)]["id"],
        "timeGap": TIME_GAPS[index % len(TIME_GAPS)]["id"],
        "currentPractice": CURRENT_PRACTICES[index % len(CURRENT_PRACTICES)]["id"],
        "verified": False,
        "verifiedAt": None,
        "verifiedBy": None,
        "accuracy": None,
    }


def build_households() -> list[dict]:
    rows = [*HOUSEHOLDS, *generate_extra()]
    return [
        attach_verification(attach_profile(record, index), index)
        for index, record in enumerate(rows)
    ]


def build_potential_customers() -> list[dict]:
    return [attach_survey(record, index) for index, record in enumerate(POTENTIAL_CUSTOMERS)]


_NON_ALPHA = re.compile(r"[^a-z]+")


def _slug(head: str) -> str:
    """`head.toLowerCase().replace(/[^a-z]+/g, '.')`."""
    return _NON_ALPHA.sub(".", head.lower())


# --------------------------------------------------------------------------- #
# Route plan
# --------------------------------------------------------------------------- #


def build_routes(homes: list[dict]) -> list[dict]:
    """One route per (ward, road) over verified holdings, in walking order.

    The number in the id is the *global* grouping index, not a per-ward counter,
    so W-15's first route is `RT-W-15-04`. That is what buildRoutes() produced and
    what the UI has always displayed, so it is kept.
    """
    grouped: dict[tuple[str, str], list[dict]] = {}
    for home in homes:
        if home["verified"]:
            grouped.setdefault((home["ward"], home["road"]), []).append(home)

    routes = []
    for index, ((ward, road), members) in enumerate(grouped.items()):
        window_start, window_end = ROUTE_WINDOWS[index % len(ROUTE_WINDOWS)]
        routes.append(
            {
                "id": f"RT-{ward}-{index + 1:02d}",
                "name": road,
                "ward": ward,
                "window_start": window_start,
                "window_end": window_end,
                "stops": [
                    home["id"]
                    for home in sorted(members, key=lambda h: natural_key(h["holding"]))
                ],
                "active": True,
            }
        )
    return routes


def build_assignments(routes: list[dict]) -> list[dict]:
    """Deal each ward's routes round-robin across that ward's collectors.

    Wards with more roads than collectors leave somebody holding two routes, which
    is exactly the case a daily round has to cope with.
    """
    pool: dict[str, list[str]] = {}
    for collector in COLLECTORS:
        if collector["status"] != "off_route":
            pool.setdefault(collector["zone"], []).append(collector["id"])

    held: dict[str, list[str]] = {}
    turn: dict[str, int] = {}
    for route in routes:
        ward_pool = pool.get(route["ward"])
        if not ward_pool:
            continue
        collector = ward_pool[turn.get(route["ward"], 0) % len(ward_pool)]
        turn[route["ward"]] = turn.get(route["ward"], 0) + 1
        held.setdefault(collector, []).append(route["id"])

    return [
        {"id": f"AS-{collector}", "collector": collector, "routes": route_ids, "active": True}
        for collector, route_ids in held.items()
    ]


# --------------------------------------------------------------------------- #
# Operational history
# --------------------------------------------------------------------------- #


def build_history(
    homes: list[dict], routes: list[dict], assignments: list[dict], today: dt.date
) -> dict:
    """`buildHistory()` — 90 days of rounds and 14 months of billing, ending today.

    Everything derives from the route plan, so a holding's service history, its
    bills and the collector credited with them agree by construction.
    """
    rnd = Lcg(HISTORY_SEED)
    by_id = {home["id"]: home for home in homes}
    holder_of_route = {
        route_id: assignment["collector"]
        for assignment in assignments
        for route_id in assignment["routes"]
    }

    # Who walks each holding, which route they walk it on, and each collector's round.
    owner: dict[str, str] = {}
    route_of: dict[str, str] = {}
    rounds: dict[str, list[str]] = {}
    for route in routes:
        holder = holder_of_route.get(route["id"])
        if holder is None:
            continue
        for household_id in route["stops"]:
            owner[household_id] = holder
            route_of[household_id] = route["id"]
            rounds.setdefault(holder, []).append(household_id)

    visits = _service_history(rnd, by_id, route_of, rounds, today)
    bills, payments = _billing_history(rnd, homes, owner, today)
    deposits = _cash_handling(rnd, payments)
    return {"visits": visits, "bills": bills, "payments": payments, "deposits": deposits}


def _service_history(
    rnd: Lcg,
    by_id: dict[str, dict],
    route_of: dict[str, str],
    rounds: dict[str, list[str]],
    today: dt.date,
) -> list[dict]:
    visits: list[dict] = []
    number = 0
    for back in range(HISTORY_DAYS, -1, -1):
        day = today - dt.timedelta(days=back)
        is_today = back == 0
        if day.weekday() == FRIDAY:
            continue

        for collector, stops in rounds.items():
            for i, household_id in enumerate(stops):
                # Today is still in progress — roughly half the round so far.
                if is_today and rnd.next() > 0.55:
                    continue
                roll = rnd.next()
                if roll > 0.97:  # never reached
                    continue
                skipped = roll > 0.9
                number += 1
                hour = 6 + (i % 4)
                minute = (i * 7 + rnd.below(6)) % 60
                accuracy = None if skipped else 4 + rnd.below(9)
                source = "scan" if rnd.next() > 0.35 else "manual"
                reason = rnd.pick(SKIP_REASONS) if skipped else ""
                visits.append(
                    {
                        "id": f"V-{number:06d}",
                        "hh": household_id,
                        "collector": collector,
                        # The mock carried no route on a visit; the plan knows it,
                        # and the on-time report needs a window to judge against.
                        "route": route_of.get(household_id),
                        "qr": by_id[household_id].get("qr") or "",
                        "status": "skipped" if skipped else "collected",
                        "at": dt.datetime.combine(day, dt.time(hour, minute)),
                        "served_on": day,
                        "accuracy": accuracy,
                        "source": source,
                        "reason": reason,
                        # The newest day may not have reached the server yet.
                        "synced": True if not is_today else rnd.next() > 0.4,
                    }
                )
    return visits


def _billing_history(
    rnd: Lcg, homes: list[dict], owner: dict[str, str], today: dt.date
) -> tuple[list[dict], list[dict]]:
    bills: list[dict] = []
    payments: list[dict] = []
    per_period: dict[str, int] = {}
    first_month = add_months(today, -(BILL_MONTHS - 1))
    current_period = f"{today:%Y-%m}"

    for offset in range(BILL_MONTHS):
        month = add_months(first_month, offset)
        period = f"{month:%Y-%m}"
        is_current = period == current_period

        for home in homes:
            if home["id"] not in owner or home["status"] != "active":
                continue
            amount = effective_charge(home)
            bill = {
                "id": bill_id(period, home["id"]),
                "hh": home["id"],
                "period": period,
                "issued_at": month,
                "amount": amount,
                "ward": home["ward"],
            }
            bills.append(bill)

            # Older months settle more completely than the current one.
            roll = rnd.next()
            if roll >= (0.55 if is_current else 0.88):
                continue

            partial = rnd.next() < 0.14
            received = js_round(amount * (0.3 + rnd.next() * 0.4)) if partial else amount
            pay_day = min(28, home["paymentDay"] + rnd.below(6))
            hour = 10 + rnd.below(7)
            per_period[period] = per_period.get(period, 0) + 1
            payments.append(
                {
                    "id": f"PAY-{period}-{per_period[period]:05d}",
                    "bill": bill["id"],
                    "hh": home["id"],
                    "collector": owner[home["id"]],
                    "amount": received,
                    "method": home["paymentMode"],
                    "at": dt.datetime.combine(
                        month.replace(day=pay_day), dt.time(hour, 0)
                    ),
                    "period": period,
                    "deposit": None,
                }
            )
    return bills, payments


def _cash_handling(rnd: Lcg, payments: list[dict]) -> list[dict]:
    """What each collector handed in, per month and method.

    Most hand-ins reconcile exactly; 12% are short and 6% never arrive, which is
    the whole reason a reconciliation report exists.
    """
    takings: dict[tuple[str, str, str], int] = {}
    for payment in payments:
        key = (payment["collector"], payment["period"], payment["method"])
        takings[key] = takings.get(key, 0) + payment["amount"]

    deposits: list[dict] = []
    per_period: dict[str, int] = {}
    slip = 0
    for (collector, period, method), amount in takings.items():
        roll = rnd.next()
        if roll < 0.06:
            continue
        handed = js_round(amount * (0.8 + rnd.next() * 0.15)) if roll < 0.18 else amount
        slip += 1
        day = 26 + rnd.below(3)
        per_period[period] = per_period.get(period, 0) + 1
        deposits.append(
            {
                "id": f"DEP-{period}-{per_period[period]:04d}",
                "collector": collector,
                "period": period,
                "method": method,
                "amount": handed,
                "at": dt.datetime.combine(
                    dt.date(int(period[:4]), int(period[5:]), day), dt.time(16, 0)
                ),
                "ref": f"DR-{slip:05d}",
            }
        )

    # Point each payment at the hand-in that carried it. The mock left the two
    # unrelated, which meant "cash still with the collector" was unanswerable;
    # payments in the 6% of groups that never arrived stay unlinked, correctly.
    by_group = {(d["collector"], d["period"], d["method"]): d["id"] for d in deposits}
    for payment in payments:
        payment["deposit"] = by_group.get(
            (payment["collector"], payment["period"], payment["method"])
        )
    return deposits
