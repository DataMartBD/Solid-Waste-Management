"""Realtime fan-out for the live map.

One websocket at `/ws/live/` carries every operational event the map and
dashboard care about. Clients subscribe to the `live` group and receive frames
shaped as::

    { "type": "vehicle.position", "payload": {...}, "at": "2026-07-28T09:14:02Z" }

Publishers are ordinary synchronous view code, so `publish()` wraps the async
channel-layer call. Failures are swallowed and logged: a dropped map update must
never fail the write that produced it.
"""

from __future__ import annotations

import logging

from asgiref.sync import async_to_sync
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from channels.layers import get_channel_layer
from django.urls import path
from django.utils import timezone

logger = logging.getLogger("swms.realtime")

#: KCC's own staff, who see the whole city.
LIVE_GROUP = "live"

VEHICLE_POSITION = "vehicle.position"
VISIT_RECORDED = "visit.recorded"
COMPLAINT_OPENED = "complaint.opened"
COMPLAINT_UPDATED = "complaint.updated"
COLLECTOR_STATUS = "collector.status"


def agency_group(agency_id: str) -> str:
    """One group per contractor. Group names must be ASCII and punctuation-free
    beyond `.-_`, which agency ids already satisfy (`AGN-KCC-0001`)."""
    return f"live.agency.{agency_id}"


def publish(event_type: str, payload: dict, *, agency_id: str | None = None) -> None:
    """Broadcast one event.

    Every frame goes to `LIVE_GROUP`, which only KCC's own staff join, and — when
    the event belongs to a contractor — to that contractor's group as well.

    Before this there was a single group: every authenticated client received
    every vehicle position and visit in the city, and `LiveMap.jsx` dropped the
    ones it could not place. That is a rendering filter, not a boundary; the
    payload had already reached the browser. With two contractors that means one
    receiving the other's live vehicle tracking.

    An event with no `agency_id` reaches KCC only. That is the safe direction:
    an agency missing a frame sees a stale marker, whereas a rival receiving one
    cannot be undone.
    """
    layer = get_channel_layer()
    if layer is None:
        return
    frame = {
        "type": "live.event",  # channels handler name
        "event": event_type,
        "payload": payload,
        "at": timezone.now().isoformat(),
    }
    targets = [LIVE_GROUP]
    if agency_id:
        targets.append(agency_group(agency_id))
    try:
        for target in targets:
            async_to_sync(layer.group_send)(target, frame)
    except Exception:  # pragma: no cover — never break the originating write
        logger.warning("live broadcast failed for %s", event_type, exc_info=True)


class LiveConsumer(AsyncJsonWebsocketConsumer):
    """Read-only event stream. Authentication happens in ws_auth."""

    async def connect(self):
        user = self.scope.get("user")
        if user is None or not user.is_authenticated:
            await self.close(code=4401)
            return
        # A contractor joins only their own group, so a rival's frames are never
        # written to this socket — as opposed to being filtered in the browser,
        # which is where this used to happen.
        agency_id = await database_sync_to_async(user.visible_agency_id)()
        self.group = agency_group(agency_id) if agency_id else LIVE_GROUP
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()
        await self.send_json({"event": "ready", "payload": {"role": user.role}})

    async def disconnect(self, code):
        await self.channel_layer.group_discard(
            getattr(self, "group", LIVE_GROUP), self.channel_name
        )

    async def receive_json(self, content, **kwargs):
        # The only client message is a keepalive.
        if content.get("event") == "ping":
            await self.send_json({"event": "pong"})

    async def live_event(self, message):
        await self.send_json(
            {
                "event": message["event"],
                "payload": message["payload"],
                "at": message["at"],
            }
        )


websocket_urlpatterns = [
    path("ws/live/", LiveConsumer.as_asgi()),
]
