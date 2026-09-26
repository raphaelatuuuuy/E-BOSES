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


def are_users_online(user_ids: list[int]) -> dict[int, bool]:
    """Batch presence lookup in one Redis round-trip.

    Sequential cache.get() calls cost one WAN RTT each on hosted Redis;
    get_many() keeps the endpoint at ~1 RTT regardless of ID count.
    Unknown/offline on any cache failure — never raise for presence.
    """
    deduped = list(dict.fromkeys(int(uid) for uid in user_ids))
    if not deduped:
        return {}
    keys = [presence_key(uid) for uid in deduped]
    key_to_uid = dict(zip(keys, deduped))
    try:
        values = cache.get_many(keys) or {}
    except Exception:
        return {uid: False for uid in deduped}
    return {uid: bool(values.get(key)) for key, uid in key_to_uid.items()}
