from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.contrib.auth import get_user_model

from .tickets import consume_websocket_ticket


@database_sync_to_async
def get_user_from_ticket(ticket: str):
    user_id = consume_websocket_ticket(ticket)
    if not user_id:
        return None
    User = get_user_model()
    return User.objects.filter(pk=user_id, is_active=True, status=User.Status.VERIFIED).first()


@database_sync_to_async
def user_can_view_emergency(user, alert_id: int) -> bool:
    from apps.emergencies.views import can_view_alert
    from apps.emergencies.models import EmergencyAlert

    alert = EmergencyAlert.objects.filter(pk=alert_id).first()
    return bool(alert and can_view_alert(user, alert))


class AuthenticatedJsonConsumer(AsyncJsonWebsocketConsumer):
    user = None

    async def authenticate(self) -> bool:
        query_string = self.scope.get("query_string", b"").decode()
        ticket = parse_qs(query_string).get("ticket", [""])[0]
        if not ticket:
            await self.close(code=4401)
            return False
        self.user = await get_user_from_ticket(ticket)
        if not self.user or not self.user.is_authenticated:
            await self.close(code=4401)
            return False
        return True


class NotificationConsumer(AuthenticatedJsonConsumer):
    async def connect(self):
        if not await self.authenticate():
            return
        self.group_name = f"user_{self.user.pk}"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        if getattr(self, "group_name", None):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def notification_created(self, event):
        await self.send_json({"type": "notification.created", "payload": event["payload"]})


class EmergencyTrackingConsumer(AuthenticatedJsonConsumer):
    async def connect(self):
        if not await self.authenticate():
            return
        self.alert_id = int(self.scope["url_route"]["kwargs"]["alert_id"])
        if not await user_can_view_emergency(self.user, self.alert_id):
            await self.close(code=4403)
            return
        self.group_name = f"emergency_{self.alert_id}"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        if getattr(self, "group_name", None):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def emergency_update(self, event):
        await self.send_json({"type": "emergency.update", "payload": event["payload"]})

    async def emergency_chat(self, event):
        await self.send_json({"type": "emergency.chat", "payload": event["payload"]})


@database_sync_to_async
def user_can_view_live_map(user) -> bool:
    from apps.live_map import is_official

    return is_official(user)


class OfficialLiveMapConsumer(AuthenticatedJsonConsumer):
    async def connect(self):
        if not await self.authenticate():
            return
        if not await user_can_view_live_map(self.user):
            await self.close(code=4403)
            return
        self.group_name = "official_live_map"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        if getattr(self, "group_name", None):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def live_map_update(self, event):
        await self.send_json(event["payload"])
