from datetime import date, timedelta
from types import SimpleNamespace

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.accounts.models import ResidentProfile, ResidentSettings
from apps.sms.normalize import SenderMatch, match_sender
from apps.sms.simulation_api import simulate_sms

from .location_resolution import resolve_incident_location
from .models import Community, EmergencyAlert, EmergencyResponderAssignment, MapGeometry
from .sms_intake import create_alert_from_sms


def square(min_lat, min_lng, max_lat, max_lng):
    return {
        "type": "Polygon",
        "coordinates": [[
            [min_lng, min_lat],
            [max_lng, min_lat],
            [max_lng, max_lat],
            [min_lng, max_lat],
            [min_lng, min_lat],
        ]],
    }


class CommunityLocationResolutionTests(TestCase):
    def setUp(self):
        self.first = self.community("Alpha", "alpha", 14.60, 121.10, 14.70, 121.20, 91001)
        self.second = self.community("Bravo", "bravo", 14.60, 121.20, 14.70, 121.30, 91002)
        User = get_user_model()
        self.user = User.objects.create_user(
            email="resident-location@example.com",
            phone_number="+639171112222",
            status=User.Status.VERIFIED,
            current_latitude="14.6500000",
            current_longitude="121.1500000",
            location_updated_at=timezone.now(),
        )
        ResidentProfile.objects.create(
            user=self.user,
            community=self.first,
            first_name="Mara",
            last_name="Santos",
            date_of_birth=date(1995, 1, 1),
            address="1 Sample Street",
            barangay=self.first.name,
            home_latitude="14.6400000",
            home_longitude="121.1400000",
        )
        ResidentSettings.objects.create(user=self.user, location_sharing_enabled=True)
        self.match = match_sender(self.user.phone_number)

    def community(self, name, code, min_lat, min_lng, max_lat, max_lng, osm_id):
        boundary = MapGeometry.objects.create(
            kind=MapGeometry.Kind.BOUNDARY,
            name=name,
            osm_type="R",
            osm_id=osm_id,
            geometry=square(min_lat, min_lng, max_lat, max_lng),
        )
        return Community.objects.create(
            name=name,
            code=code,
            status=Community.Status.ACTIVE,
            boundary=boundary,
            center_latitude=(min_lat + max_lat) / 2,
            center_longitude=(min_lng + max_lng) / 2,
            bbox_min_latitude=min_lat,
            bbox_max_latitude=max_lat,
            bbox_min_longitude=min_lng,
            bbox_max_longitude=max_lng,
        )

    def test_registered_fresh_location_is_a_fallback(self):
        result = resolve_incident_location(match=self.match)
        self.assertEqual(result.source, "recent_account_location")
        self.assertEqual(result.state, "fallback")
        self.assertEqual(result.community, self.first)
        self.assertTrue(result.has_destination)

    def test_stale_or_disabled_location_uses_profile_without_a_pin(self):
        self.user.location_updated_at = timezone.now() - timedelta(minutes=16)
        self.user.save(update_fields=["location_updated_at"])
        self.match = match_sender(self.user.phone_number)
        stale = resolve_incident_location(match=self.match)
        self.assertEqual(stale.source, "profile_community")
        self.assertEqual(stale.freshness, "stale")
        self.assertFalse(stale.has_destination)

        self.user.resident_settings.location_sharing_enabled = False
        self.user.resident_settings.save(update_fields=["location_sharing_enabled"])
        self.match = match_sender(self.user.phone_number)
        disabled = resolve_incident_location(match=self.match)
        self.assertEqual(disabled.source, "profile_community")
        self.assertFalse(disabled.has_destination)

    def test_gps_and_explicit_area_override_home_community(self):
        gps = resolve_incident_location(latitude=14.65, longitude=121.25, match=self.match)
        self.assertEqual(gps.community, self.second)
        self.assertEqual(gps.source, "sms_gps")
        area = resolve_incident_location(message_area="near Bravo hall", match=self.match)
        self.assertEqual(area.community, self.second)
        self.assertEqual(area.source, "message_area")
        self.assertFalse(area.has_destination)

    def test_unknown_and_needs_review_never_use_account_context(self):
        for match in (
            SenderMatch(SenderMatch.UNVERIFIED),
            SenderMatch(SenderMatch.NEEDS_REVIEW, candidates=(self.user,)),
        ):
            result = resolve_incident_location(match=match)
            self.assertEqual(result.source, "none")
            self.assertIsNone(result.community)
            self.assertFalse(result.has_destination)

    def test_unknown_number_can_use_sms_gps(self):
        result = resolve_incident_location(
            latitude=14.65,
            longitude=121.15,
            match=SenderMatch(SenderMatch.UNVERIFIED),
        )
        self.assertEqual(result.source, "sms_gps")
        self.assertEqual(result.community, self.first)

    def test_home_coordinates_identify_context_without_an_incident_pin(self):
        profile = self.user.resident_profile
        profile.community = None
        profile.barangay = ""
        profile.save(update_fields=["community", "barangay"])
        self.user.resident_settings.location_sharing_enabled = False
        self.user.resident_settings.save(update_fields=["location_sharing_enabled"])
        result = resolve_incident_location(match=match_sender(self.user.phone_number))
        self.assertEqual(result.source, "home_context")
        self.assertEqual(result.community, self.first)
        self.assertFalse(result.has_destination)

    def test_phone_prefix_and_previous_alert_do_not_create_location(self):
        EmergencyAlert.objects.create(
            reporter=self.user,
            type=EmergencyAlert.Type.FIRE,
            community=self.second,
            latitude=14.65,
            longitude=121.25,
        )
        result = resolve_incident_location(match=SenderMatch(SenderMatch.UNVERIFIED), message_area="0917 caller")
        self.assertEqual(result.source, "none")
        self.assertIsNone(result.community)

    def test_boundary_edge_is_inside_and_overlap_is_ambiguous(self):
        edge = resolve_incident_location(latitude=14.65, longitude=121.20, match=self.match)
        self.assertEqual(edge.state, "ambiguous")
        self.assertEqual({item.pk for item in edge.candidates}, {self.first.pk, self.second.pk})
        only_edge = resolve_incident_location(latitude=14.60, longitude=121.15, match=self.match)
        self.assertEqual(only_edge.community, self.first)

    def test_same_street_never_selects_a_community_without_area(self):
        for index, community in enumerate((self.first, self.second), start=1):
            MapGeometry.objects.create(
                kind=MapGeometry.Kind.STREET,
                name="Shared Street",
                osm_type="W",
                osm_id=92000 + index,
                locality=community.name,
                geometry={"type": "LineString", "coordinates": []},
            )
        result = resolve_incident_location(message_area="HELP FIRE on Shared Street", match=self.match)
        self.assertIsNone(result.community)
        self.assertEqual(result.state, "ambiguous")
        self.assertEqual({item.pk for item in result.candidates}, {self.first.pk, self.second.pk})

    def test_duplicate_normalized_number_needs_review(self):
        User = get_user_model()
        User.objects.create_user(
            email="duplicate-number@example.com",
            phone_number="09171112222",
            status=User.Status.VERIFIED,
        )
        result = match_sender("+639171112222")
        self.assertEqual(result.status, SenderMatch.NEEDS_REVIEW)
        self.assertIsNone(result.user)

    def test_disabling_location_sharing_clears_saved_location(self):
        from apps.accounts.views import ResidentSettingsView

        request = APIRequestFactory().patch(
            "/api/auth/settings/",
            {"location_sharing_enabled": False},
            format="json",
        )
        force_authenticate(request, user=self.user)
        response = ResidentSettingsView.as_view()(request)
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertIsNone(self.user.current_latitude)
        self.assertIsNone(self.user.current_longitude)
        self.assertIsNone(self.user.location_updated_at)

    def parsed(self, *, latitude=None, longitude=None, area=""):
        return SimpleNamespace(
            category_code=EmergencyAlert.Type.FIRE,
            note="Fire needs help",
            latitude=latitude,
            longitude=longitude,
            has_coordinates=latitude is not None and longitude is not None,
            reported_area=area,
            triage={},
            category_needs_confirmation=False,
            unresolved_fields=[],
            coordinate_status="ok" if latitude is not None else "missing",
        )

    def test_real_sms_persists_resolution_before_manual_dispatch(self):
        result = create_alert_from_sms(
            self.parsed(latitude=14.65, longitude=121.15),
            sender_number=self.user.phone_number,
            match=self.match,
        )
        alert = result.alert
        self.assertEqual(alert.community, self.first)
        self.assertEqual(alert.location_source, "sms_gps")
        self.assertEqual(alert.location_freshness, "fresh")
        self.assertEqual(alert.location_evidence["community"]["id"], self.first.pk)
        self.assertTrue(alert.escalations.exists())

    def test_unknown_without_location_stays_active_for_manual_dispatch(self):
        result = create_alert_from_sms(
            self.parsed(),
            sender_number="+639188887777",
            match=SenderMatch(SenderMatch.UNVERIFIED),
        )
        alert = result.alert
        self.assertIsNone(alert.community)
        self.assertEqual(alert.location_source, "none")
        self.assertEqual(alert.status, EmergencyAlert.Status.ESCALATION_REQUIRED)
        self.assertTrue(alert.escalations.exists())

    def test_sms_simulation_and_real_sms_share_location_resolution(self):
        message = "HELP FIRE LOC:14.6500,121.1500"
        simulated = simulate_sms(message=message, sender_mode="registered", user=self.user)
        created = create_alert_from_sms(
            self.parsed(latitude=14.65, longitude=121.15),
            sender_number=self.user.phone_number,
            match=self.match,
        ).alert
        self.assertEqual(simulated["location"]["source"], created.location_source)
        self.assertEqual(simulated["location"]["community"]["id"], created.community_id)

    def test_sms_simulation_creates_no_alert_or_assignment(self):
        before_alerts = EmergencyAlert.objects.count()
        before_assignments = EmergencyResponderAssignment.objects.count()
        result = simulate_sms(message="HELP FIRE LOC:14.6500,121.1500", sender_mode="registered", user=self.user)
        self.assertEqual(EmergencyAlert.objects.count(), before_alerts)
        self.assertEqual(EmergencyResponderAssignment.objects.count(), before_assignments)
        self.assertIn("geometry", result["routing"]["route"])
        self.assertIn("status", result["routing"]["route"])

    def test_sms_scenarios_are_reproducible_without_saved_settings(self):
        self.user.resident_settings.delete()
        fresh = simulate_sms(message="HELP FIRE", sender_mode="registered", scenario="fresh", user=self.user)
        stale = simulate_sms(message="HELP FIRE", sender_mode="registered", scenario="stale", user=self.user)
        context = simulate_sms(message="HELP FIRE", sender_mode="registered", scenario="context", user=self.user)
        self.assertEqual(fresh["location"]["source"], "recent_account_location")
        self.assertEqual(stale["location"]["source"], "profile_community")
        self.assertEqual(stale["location"]["freshness"], "stale")
        self.assertEqual(context["location"]["source"], "profile_community")
        self.assertFalse(context["location"]["has_destination"])
