from django.core.cache import cache


PRESENCE_HEARTBEAT_SECONDS = 3
PRESENCE_LEASE_SECONDS = 10


def presence_key(user_id: int) -> str:
    return f"presence:user:{user_id}"


def mark_presence(user_id: int) -> None:
    cache.set(presence_key(user_id), True, timeout=PRESENCE_LEASE_SECONDS)


def is_user_online(user_id: int) -> bool:
    try:
        return bool(cache.get(presence_key(user_id)))
    except Exception:
        return False
