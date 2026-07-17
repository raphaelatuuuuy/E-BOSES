import secrets

from django.core import signing
from django.core.cache import cache


TICKET_SALT = "eboses.websocket"
TICKET_TTL_SECONDS = 60


def issue_websocket_ticket(user):
    nonce = secrets.token_urlsafe(24)
    cache.set(f"websocket-ticket:{nonce}", user.pk, timeout=TICKET_TTL_SECONDS)
    return signing.dumps({"user_id": user.pk, "nonce": nonce}, salt=TICKET_SALT, compress=True)


def consume_websocket_ticket(ticket):
    try:
        payload = signing.loads(ticket, salt=TICKET_SALT, max_age=TICKET_TTL_SECONDS)
    except signing.BadSignature:
        return None
    nonce = payload.get("nonce")
    user_id = payload.get("user_id")
    if not nonce or not user_id:
        return None
    cache_key = f"websocket-ticket:{nonce}"
    cached_user_id = cache.get(cache_key)
    cache.delete(cache_key)
    return user_id if cached_user_id == user_id else None
