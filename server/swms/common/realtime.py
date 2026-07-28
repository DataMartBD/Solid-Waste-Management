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
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from channels.layers import get_channel_layer
from django.urls import path
from django.utils import timezone

logger = logging.getLogger("swms.realtime")

LIVE_GROUP = "live"

VEHICLE_POSITION = "vehicle.position"
VISIT_RECORDED = "visit.recorded"
COMPLAINT_OPENED = "complaint.opened"
COMPLAINT_UPDATED = "complaint.updated"
COLLECTOR_STATUS = "collector.status"


def publish(event_type: str, payload: dict) -> None:
    """Broadcast one event to every connected client."""
    layer = get_channel_layer()
    if layer is None:
        return
    frame = {
        "type": "live.event",  # channels handler name
        "event": event_type,
        "payload": payload,
        "at": timezone.now().isoformat(),
    }
    try:
        async_to_sync(layer.group_send)(LIVE_GROUP, frame)
    except Exception:  # pragma: no cover — never break the originating write
        logger.warning("live broadcast failed for %s", event_type, exc_info=True)


class LiveConsumer(AsyncJsonWebsocketConsumer):
    """Read-only event stream. Authentication happens in ws_auth."""

    async def connect(self):
        user = self.scope.get("user")
        if user is None or not user.is_authenticated:
            await self.close(code=4401)
            return
        await self.channel_layer.group_add(LIVE_GROUP, self.channel_name)
        await self.accept()
        await self.send_json({"event": "ready", "payload": {"role": user.role}})

    async def disconnect(self, code):
        await self.channel_layer.group_discard(LIVE_GROUP, self.channel_name)

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
