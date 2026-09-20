"""Unit-based SOS filtering, safe duplicate SOS SMS, and acceptance-zone locations.

These cover the acceptance scenarios from the unit-filtering plan:

* a first SOS creates exactly one alert,
* a repeated SOS sends only the ongoing-emergency warning and changes nothing,
* gateway redelivery cannot send the warning twice,
* an ordinary follow-up SMS still lands in the active SOS chat once,
* the official SOS map can be scoped to a unit, and
* a point accepted by radius/shape is stored as reported, not outside-area.
"""

from contextlib import contextmanager
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient, APITestCase

from apps.accounts.models import ResidentProfile
from apps.concerns.models import Department
from apps.concerns.test_helpers import active_test_community, grant_position
from apps.live_map import UNASSIGNED_UNIT_FILTER, _scope_live_map_emergencies
from apps.sms import templates
from apps.sms.models import InboundSmsMessage
from apps.sms.payload import InboundPayload
from apps.sms.router import handle_inbound

from .location_services import classify_location_confidence
from .models import (
    EmergencyAlert,
    EmergencyChatMessage,
    EmergencyResponderAssignment,
    EmergencyTypeRoleMap,
    MapDispatchPolicy,
)

TEST_CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels.layers.InMemoryChannelLayer",
    },
}


def inbound_payload(body, sender, message_id):
    return InboundPayload(
        body=body,
        sender=sender,
        gateway_timestamp=None,
        gateway_message_id=message_id,
        raw={},
        event="sms:received",
    )


@contextmanager
def sms_harness():
    """Patch the slow/side-effecting parts of SMS intake and return queue_sms."""
    with patch("apps.sms.router.queue_sms") as queue_sms, patch(
        "apps.emergencies.views.auto_route_alert"
    ), patch("apps.emergencies.views.create_witness_notifications"), patch(
        "apps.emergencies.location_services.resolve_alert_location"
    ):
        yield queue_sms


@override_settings(CHANNEL_LAYERS=TEST_CHANNEL_LAYERS, OSM_ROUTE_URL="")
class ResidentSmsDuplicateTests(TestCase):
    sender = "09610000101"
    e164 = "+639610000101"

    def setUp(self):
        cache.clear()
        self.community = active_test_community()
        User = get_user_model()
        self.resident = User.objects.create_user(
            email="dup-resident@example.com",
            phone_number=self.e164,
            password="pass",
            status=User.Status.VERIFIED,
        )
        ResidentProfile.objects.create(
            user=self.resident,
            first_name="Dupe",
            last_name="Resident",
            date_of_birth="1995-01-01",
            address="Blk 1 Lot 1",
            barangay=self.community.name,
            community=self.community,
        )

    def sos(self, message_id, loc="14.6515000,121.1207000"):
        return inbound_payload(
            f"I need immediate help. This is a Fire emergency.\nLOC:{loc}",
            self.sender,
            message_id,
        )

    def test_first_sos_creates_exactly_one_alert(self):
        with sms_harness():
            inbound = handle_inbound(self.sos("fw-1"))

        self.assertEqual(EmergencyAlert.objects.filter(reporter=self.resident).count(), 1)
        self.assertEqual(inbound.outcome, InboundSmsMessage.Outcome.EMERGENCY_CREATED)

    def test_duplicate_sos_warns_without_second_alert_or_location_change(self):
        with sms_harness():
            handle_inbound(self.sos("fw-1"))
            original = EmergencyAlert.objects.get(reporter=self.resident)
            original_lat, original_lng = original.latitude, original.longitude

        with sms_harness() as queue_sms:
            second = handle_inbound(self.sos("fw-2", loc="1.0000000,1.0000000"))

        self.assertEqual(EmergencyAlert.objects.filter(reporter=self.resident).count(), 1)
        refreshed = EmergencyAlert.objects.get(pk=original.pk)
        self.assertEqual(refreshed.latitude, original_lat)
        self.assertEqual(refreshed.longitude, original_lng)
        self.assertEqual(refreshed.chat_messages.count(), 0)
        self.assertEqual(second.outcome, InboundSmsMessage.Outcome.DUPLICATE)
        self.assertEqual(queue_sms.call_count, 1)
        self.assertEqual(queue_sms.call_args[0][1], templates.ongoing_emergency())

    def test_gateway_redelivery_does_not_send_a_second_warning(self):
        with sms_harness():
            handle_inbound(self.sos("fw-1"))

        with sms_harness() as queue_sms:
            handle_inbound(self.sos("fw-2"))
            self.assertEqual(queue_sms.call_count, 1)
            redelivered = handle_inbound(self.sos("fw-2"))
            self.assertEqual(queue_sms.call_count, 1)

        self.assertTrue(getattr(redelivered, "was_redelivered", False))
        self.assertEqual(redelivered.outcome, InboundSmsMessage.Outcome.DUPLICATE)

    def test_new_sms_inside_the_acceptance_zone_is_accepted_and_stored_as_reported(self):
        policy = MapDispatchPolicy.current(self.community)
        policy.acceptance_geometry = {
            "type": "Polygon",
            "coordinates": [
                [[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5], [0.5, 0.5]]
            ],
        }
        policy.save(update_fields=["acceptance_geometry", "updated_at"])

        with sms_harness():
            handle_inbound(self.sos("fw-accept", loc="1.0000000,1.0000000"))

        alert = EmergencyAlert.objects.get(reporter=self.resident)
        self.assertEqual(alert.status, EmergencyAlert.Status.SUBMITTED)
        self.assertEqual(
            alert.location_confidence, EmergencyAlert.LocationConfidence.REPORTED
        )

    def test_new_sms_outside_the_boundary_and_radius_is_not_routed(self):
        with sms_harness(), patch(
            "apps.emergencies.views.auto_route_alert"
        ) as route:
            handle_inbound(self.sos("fw-outside", loc="2.0000000,2.0000000"))

        alert = EmergencyAlert.objects.get(reporter=self.resident)
        self.assertEqual(alert.status, EmergencyAlert.Status.INVALID)
        route.assert_not_called()

    def test_ordinary_follow_up_is_appended_to_the_active_chat_once(self):
        with sms_harness():
            handle_inbound(self.sos("fw-1"))
            alert = EmergencyAlert.objects.get(reporter=self.resident)
            follow_up = handle_inbound(
                inbound_payload("We are on the second floor.", self.sender, "fw-2")
            )

        self.assertEqual(follow_up.outcome, InboundSmsMessage.Outcome.CHAT_APPENDED)
        messages = EmergencyChatMessage.objects.filter(alert=alert)
        self.assertEqual(messages.count(), 1)
        self.assertEqual(messages.get().body, "We are on the second floor.")
        self.assertEqual(EmergencyAlert.objects.filter(reporter=self.resident).count(), 1)


class LiveMapUnitScopeTests(TestCase):
    def setUp(self):
        cache.clear()
        self.community = active_test_community()
        User = get_user_model()
        self.reporter = User.objects.create_user(
            email="unit-reporter@example.com",
            phone_number="+639610000201",
            password="pass",
            status=User.Status.VERIFIED,
        )
        ResidentProfile.objects.create(
            user=self.reporter,
            first_name="Unit",
            last_name="Reporter",
            date_of_birth="1995-01-01",
            address="Blk 2 Lot 2",
            barangay=self.community.name,
            community=self.community,
        )
        self.bhw = Department.objects.get(code="bhw", community=self.community)
        self.tanod = Department.objects.get(code="bpso-tanod", community=self.community)

        # FIRE is configured to BHW, so an unassigned fire SOS belongs to BHW.
        self.fire_map = EmergencyTypeRoleMap.objects.create(
            community=self.community,
            emergency_type=EmergencyAlert.Type.FIRE,
            department=self.bhw,
            is_active=True,
        )
        # A distinct map used only to anchor an active assignment to TANOD.
        self.assignment_map = EmergencyTypeRoleMap.objects.create(
            community=self.community,
            emergency_type="manual_test",
            department=self.tanod,
            is_active=True,
        )

        self.unassigned_fire = self.alert(EmergencyAlert.Type.FIRE)
        self.assigned_medical = self.alert(EmergencyAlert.Type.MEDICAL)
        responder = User.objects.create_user(
            email="unit-responder@example.com",
            phone_number="+639610000202",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
        )
        EmergencyResponderAssignment.objects.create(
            alert=self.assigned_medical,
            responder=responder,
            role_map=self.assignment_map,
            responding_community=self.community,
            status=EmergencyResponderAssignment.Status.ASSIGNED,
        )
        self.base = EmergencyAlert.objects.filter(
            pk__in=[self.unassigned_fire.pk, self.assigned_medical.pk]
        )

    def alert(self, alert_type):
        return EmergencyAlert.objects.create(
            reporter=self.reporter,
            type=alert_type,
            community=self.community,
            status=EmergencyAlert.Status.SUBMITTED,
            barangay=self.community.name,
            latitude="14.6515000",
            longitude="121.1207000",
            address="Test address",
        )

    def scoped(self, unit_id):
        return set(
            _scope_live_map_emergencies(
                self.base, unit_id=unit_id, community=self.community
            ).values_list("pk", flat=True)
        )

    def test_unassigned_sos_matches_the_unit_configured_for_its_type(self):
        self.assertEqual(self.scoped(self.bhw.pk), {self.unassigned_fire.pk})

    def test_assigned_sos_matches_its_assignments_unit(self):
        self.assertEqual(self.scoped(self.tanod.pk), {self.assigned_medical.pk})

    def test_unassigned_filter_returns_only_alerts_without_active_assignments(self):
        self.assertEqual(self.scoped(UNASSIGNED_UNIT_FILTER), {self.unassigned_fire.pk})

    def test_unrelated_unit_does_not_match_an_assigned_sos(self):
        self.assertNotIn(self.assigned_medical.pk, self.scoped(self.bhw.pk))


@override_settings(CHANNEL_LAYERS=TEST_CHANNEL_LAYERS, OSM_ROUTE_URL="")
class OfficialLiveMapUnitFilterApiTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.community = active_test_community()
        User = get_user_model()
        self.official = User.objects.create_user(
            email="unit-official@example.com",
            phone_number="+639610000301",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        grant_position(self.official, department_code="bhw")
        self.client = APIClient()
        self.client.force_authenticate(self.official)

    def test_snapshot_exposes_community_units_for_the_filter(self):
        response = self.client.get("/api/dashboard/official/live-map/")
        self.assertEqual(response.status_code, 200)
        unit_ids = {unit["id"] for unit in response.data["units"]}
        self.assertIn(
            Department.objects.get(code="bhw", community=self.community).pk, unit_ids
        )

    def test_unknown_unit_is_forbidden(self):
        response = self.client.get("/api/dashboard/official/live-map/?unit_id=99999999")
        self.assertEqual(response.status_code, 403)

    def test_non_numeric_unit_is_a_bad_request(self):
        response = self.client.get("/api/dashboard/official/live-map/?unit_id=abc")
        self.assertEqual(response.status_code, 400)

    def test_all_units_is_accepted(self):
        response = self.client.get("/api/dashboard/official/live-map/?unit_id=all")
        self.assertEqual(response.status_code, 200)


class AcceptanceZoneConfidenceTests(TestCase):
    def setUp(self):
        cache.clear()
        self.community = active_test_community()
        User = get_user_model()
        self.reporter = User.objects.create_user(
            email="zone-reporter@example.com",
            phone_number="+639610000401",
            password="pass",
            status=User.Status.VERIFIED,
        )
        ResidentProfile.objects.create(
            user=self.reporter,
            first_name="Zone",
            last_name="Reporter",
            date_of_birth="1995-01-01",
            address="Blk 3 Lot 3",
            barangay=self.community.name,
            community=self.community,
        )
        policy = MapDispatchPolicy.current(self.community)
        # A square far outside the barangay polygon: a point inside it is
        # accepted by shape but is not boundary-confirmed.
        policy.acceptance_geometry = {
            "type": "Polygon",
            "coordinates": [
                [[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5], [0.5, 0.5]]
            ],
        }
        policy.save(update_fields=["acceptance_geometry", "updated_at"])

    def alert(self, latitude, longitude):
        return EmergencyAlert.objects.create(
            reporter=self.reporter,
            type=EmergencyAlert.Type.FIRE,
            community=self.community,
            status=EmergencyAlert.Status.SUBMITTED,
            barangay=self.community.name,
            latitude=latitude,
            longitude=longitude,
            address="Reported area",
        )

    def test_accepted_acceptance_zone_point_is_reported_not_boundary_confirmed(self):
        alert = self.alert("1.0000000", "1.0000000")
        self.assertEqual(
            classify_location_confidence(alert),
            EmergencyAlert.LocationConfidence.REPORTED,
        )

    def test_point_outside_boundary_and_shape_is_outside_area(self):
        alert = self.alert("2.0000000", "2.0000000")
        self.assertEqual(
            classify_location_confidence(alert),
            EmergencyAlert.LocationConfidence.OUTSIDE_AREA,
        )
