"""Geocoding proxy: no browser ever talks to Nominatim, and a rate limit degrades."""

from unittest.mock import patch

from django.test import override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from apps.emergencies.models import MapAddressPoint, MapGeometry

REVERSE = "/api/locations/geocode/reverse/"
SEARCH = "/api/locations/geocode/search/"


@override_settings(REVERSE_GEOCODE_ENABLED=True)
class GeocodeProxyTests(APITestCase):
    def setUp(self):
        from django.core.cache import cache

        cache.clear()
        MapGeometry.objects.create(
            kind=MapGeometry.Kind.STREET,
            name="Narra Street",
            osm_type="W",
            osm_id=99001,
            geometry={
                "type": "LineString",
                "coordinates": [[121.11896, 14.65094], [121.11910, 14.65120]],
            },
        )

    # -- anonymous access -------------------------------------------------

    def test_reverse_is_open_to_anonymous_callers(self):
        # Address capture happens during sign-up, before an account exists.
        with patch("apps.geo_services.nominatim_reverse", return_value=None):
            response = self.client.get(REVERSE, {"lat": "14.65094", "lng": "121.11896"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    # -- validation -------------------------------------------------------

    def test_missing_or_bad_coordinates_are_rejected(self):
        for params in ({}, {"lat": "abc", "lng": "1"}, {"lat": "999", "lng": "1"}):
            self.assertEqual(
                self.client.get(REVERSE, params).status_code,
                status.HTTP_400_BAD_REQUEST,
                params,
            )

    def test_a_short_search_query_is_rejected(self):
        self.assertEqual(
            self.client.get(SEARCH, {"q": "ab"}).status_code,
            status.HTTP_400_BAD_REQUEST,
        )

    # -- the failure that started this ------------------------------------

    def test_a_rate_limited_upstream_falls_back_to_local_street_data(self):
        # Nominatim 429s the barangay's whole public IP. The pin must still
        # resolve to a street, because the data is already in our database.
        with patch("apps.geo_services.nominatim_reverse", return_value=None):
            response = self.client.get(REVERSE, {"lat": "14.65094", "lng": "121.11896"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["ok"])
        self.assertEqual(response.data["source"], "local")
        self.assertEqual(response.data["result"]["address"]["road"], "Narra Street")

    def test_a_nearby_house_number_is_included(self):
        MapAddressPoint.objects.create(
            osm_type="N", osm_id=555001, house_number="188",
            street="Narra Street", latitude="14.6509", longitude="121.11894",
        )
        with patch("apps.geo_services.nominatim_reverse", return_value=None):
            response = self.client.get(REVERSE, {"lat": "14.65094", "lng": "121.11896"})
        self.assertEqual(response.data["result"]["address"]["house_number"], "188")
        self.assertTrue(response.data["result"]["display_name"].startswith("188 Narra Street"))

    def test_a_distant_house_number_is_not_guessed(self):
        # ~200 m away: a confidently wrong number sends responders to the wrong gate.
        MapAddressPoint.objects.create(
            osm_type="N", osm_id=555002, house_number="999",
            street="Narra Street", latitude="14.6528", longitude="121.11894",
        )
        with patch("apps.geo_services.nominatim_reverse", return_value=None):
            response = self.client.get(REVERSE, {"lat": "14.65094", "lng": "121.11896"})
        self.assertNotIn("house_number", response.data["result"]["address"])

    def test_a_house_number_on_a_different_street_is_ignored(self):
        MapAddressPoint.objects.create(
            osm_type="N", osm_id=555003, house_number="12",
            street="Champaca Street", latitude="14.65094", longitude="121.11896",
        )
        with patch("apps.geo_services.nominatim_reverse", return_value=None):
            response = self.client.get(REVERSE, {"lat": "14.65094", "lng": "121.11896"})
        self.assertNotIn("house_number", response.data["result"]["address"])

    def test_a_pin_far_from_any_known_street_reports_unavailable_not_an_error(self):
        with patch("apps.geo_services.nominatim_reverse", return_value=None):
            response = self.client.get(REVERSE, {"lat": "10.0", "lng": "120.0"})
        # 200 with a null result: the caller falls back to raw coordinates and
        # must not treat this as a broken request.
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data["ok"])
        self.assertIsNone(response.data["result"])

    def test_nominatim_wins_when_it_answers(self):
        payload = {"display_name": "Champaca Street, Marikina", "address": {"road": "Champaca Street"}}
        with patch("apps.geo_services.nominatim_reverse", return_value=payload):
            response = self.client.get(REVERSE, {"lat": "14.65094", "lng": "121.11896"})
        self.assertEqual(response.data["source"], "nominatim")
        self.assertEqual(response.data["result"]["address"]["road"], "Champaca Street")

    def test_search_returns_an_empty_list_rather_than_failing(self):
        with patch("apps.geo_services.nominatim_search", return_value=None):
            response = self.client.get(SEARCH, {"q": "Champaca Street Marikina"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data["ok"])
        self.assertEqual(response.data["results"], [])

    # -- outbound hygiene -------------------------------------------------

    def test_outbound_calls_identify_themselves_and_are_cached(self):
        from apps.geo_services import NOMINATIM_USER_AGENT, nominatim_reverse

        self.assertIn("E-Boses", NOMINATIM_USER_AGENT)

        with patch("httpx.get") as mock_get:
            mock_get.return_value.json.return_value = {"display_name": "x"}
            mock_get.return_value.raise_for_status.return_value = None
            nominatim_reverse(14.65094, 121.11896)
            nominatim_reverse(14.65094, 121.11896)

        # Second identical lookup must be served from cache.
        self.assertEqual(mock_get.call_count, 1)
        self.assertEqual(
            mock_get.call_args.kwargs["headers"]["User-Agent"],
            NOMINATIM_USER_AGENT,
        )
