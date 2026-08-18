from unittest.mock import Mock, patch

from django.core.cache import cache
from django.test import SimpleTestCase

from apps.geo_services import (
    NOMINATIM_PACE_KEY,
    NOMINATIM_PACE_LOCK_KEY,
    _nominatim_get,
    _pace_nominatim,
)


class NominatimCacheTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    def tearDown(self):
        cache.clear()

    @patch("httpx.get")
    @patch("apps.geo_services._pace_nominatim")
    def test_failed_query_is_negative_cached(self, pace, get):
        response = Mock()
        response.raise_for_status.side_effect = RuntimeError("offline")
        get.return_value = response

        self.assertIsNone(_nominatim_get("https://example.test", {}, "geo:test"))
        self.assertIsNone(_nominatim_get("https://example.test", {}, "geo:test"))
        get.assert_called_once()

    @patch("httpx.get")
    @patch("apps.geo_services._pace_nominatim")
    def test_failed_query_returns_last_good_snapshot(self, pace, get):
        response = Mock()
        response.raise_for_status.side_effect = RuntimeError("offline")
        get.return_value = response
        cache.set("geo:stale", {"name": "saved"}, 60)

        self.assertEqual(_nominatim_get("https://example.test", {}, "geo"), {"name": "saved"})

    @patch("apps.geo_services.cache")
    @patch("time.sleep")
    @patch("time.time", return_value=100.0)
    def test_pacing_uses_shared_lock_and_wall_clock(self, now, sleep, shared_cache):
        shared_cache.add.side_effect = [False, True]
        shared_cache.get.return_value = None

        _pace_nominatim()

        sleep.assert_called_once_with(0.05)
        shared_cache.set.assert_called_once_with(NOMINATIM_PACE_KEY, 100.0, 60)
        shared_cache.delete.assert_called_once_with(NOMINATIM_PACE_LOCK_KEY)
