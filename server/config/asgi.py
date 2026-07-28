"""ASGI entrypoint — HTTP via Django, websockets via Channels (live map)."""

import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

# The HTTP application must be built before importing anything that touches
# models, so Channels routing is imported lazily below.
django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402

from swms.common.realtime import websocket_urlpatterns  # noqa: E402
from swms.common.ws_auth import JWTAuthMiddlewareStack  # noqa: E402

application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": JWTAuthMiddlewareStack(URLRouter(websocket_urlpatterns)),
    }
)
