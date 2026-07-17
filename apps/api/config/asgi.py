"""
ASGI config for the E-Boses API backend.

Supports Django Channels for WebSocket connections.
"""

import os

from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

django_asgi_app = get_asgi_application()

from apps.notifications import routing as notifications_routing  # noqa: E402

application = ProtocolTypeRouter({
    "http": django_asgi_app,
    "websocket": URLRouter(notifications_routing.websocket_urlpatterns),
})
