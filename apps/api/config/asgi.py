"""
ASGI config for E-Boses API with Django Channels support.
"""
import os
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.production")

django_asgi_app = get_asgi_application()

# TODO: Add WebSocket URL routing for real-time features
application = ProtocolTypeRouter({
    "http": django_asgi_app,
    "websocket": AuthMiddlewareStack(
        URLRouter(
            # Add WebSocket URL patterns here
            # from modules.notifications import routing as notifications_routing
            # from modules.emergencies import routing as emergencies_routing
        )
    ),
})
