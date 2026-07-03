from .models import Notification


def create_notification(*, recipient, type, title, body, data=None):
    return Notification.objects.create(recipient=recipient, type=type, title=title, body=body, data=data or {})
