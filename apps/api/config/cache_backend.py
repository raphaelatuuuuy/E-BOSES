"""Prefix-scoped Redis cache backend.

Django's stock ``RedisCacheClient.clear()`` calls ``FLUSHDB``, which would
also wipe Celery broker queues, Channels data, and anything else sharing the
same Redis database. This deployment shares one Upstash DB (Upstash does not
support multiple logical databases), so ``clear()`` is scoped to the
``KEY_PREFIX`` instead: it SCANs for ``*:<prefix>:*`` keys and deletes only
those. ``KEY_PREFIX`` is set to "eboses" in settings, so cache maintenance can
never touch non-cache keys.
"""

from django.core.cache.backends.redis import RedisCache


class PrefixScopedRedisCache(RedisCache):
    """RedisCache whose ``clear()`` only removes keys under ``KEY_PREFIX``."""

    def clear(self):
        if not self.key_prefix:
            # No prefix configured: fall back to stock behavior so clear() is
            # never silently a no-op in a deployment without a prefix.
            return super().clear()

        client = self._cache.get_client(write=True)
        # Django's default key format is "<key_prefix>:<version>:<key>", so the
        # prefix sits at the start of every key; "eboses:*" is the precise
        # glob. A "*:eboses:*" pattern would miss keys that begin with the
        # prefix (as the verification test proved).
        pattern = f"{self.key_prefix}:*"
        cursor = 0
        deleted = 0
        while True:
            cursor, keys = client.scan(cursor=cursor, match=pattern, count=500)
            if keys:
                deleted += client.delete(*keys)
            if cursor == 0:
                break
        return bool(deleted)
