"""End-to-end: a text arrives on the gateway number and something happens.

These are the tests that would have caught the old behaviour, where a message
without the literal ``EBOSES-SOS`` marker was answered with 400 and thrown away.
"""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import ResidentProfile
from apps.concerns.test_helpers import active_test_community
from apps.concerns.units import sync_responder_designation
from apps.emergencies.models import EmergencyAlert, ResponderShift
from apps.sms.models import InboundSmsMessage, OutboundSmsMessage, SmsPurpose
from apps.sms.payload import InboundPayload
from apps.sms.router import recover_stuck_inbound_messages

TOKEN = "test-inbound-token"
TEST_CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}

WIZARD_MESSAGE = (
    "I need immediate help. This is a Fire emergency near Champaca Street, "
    "Marikina Heights. Please send assistance.\nLOC:14.6507000,121.1133000"
)


@override_settings(
    SMS_INBOUND_WEBHOOK_TOKEN=TOKEN,
    OUTBOUND_SMS_DRIVER="disabled",
    CELERY_TASK_ALWAYS_EAGER=True,
    CHANNEL_LAYERS=TEST_CHANNEL_LAYERS,
    OSM_ROUTE_URL="",
)
class SmsInboundTests(APITestCase):
    url = "/api/sms/inbound/"

    def setUp(self):
        User = get_user_model()
        self.resident = User.objects.create_user(
            email="sms-resident@example.com",
            phone_number="+639451234821",
            password="pass",
            status=User.Status.VERIFIED,
        )
        ResidentProfile.objects.create(
            user=self.resident,
            first_name="Maria",
            last_name="Dela Cruz",
            date_of_birth="1995-01-01",
            address="Blk 5 Lot 2",
            barangay="Marikina Heights",
        )
        self.responder = User.objects.create_user(
            email="sms-responder@example.com",
            phone_number="+639450000002",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            responder_unit=User.ResponderUnit.BDRRMO,
            status=User.Status.VERIFIED,
            is_on_duty=True,
            current_latitude="14.6516000",
            current_longitude="121.1208000",
            location_updated_at=timezone.now(),
        )
        ResidentProfile.objects.create(
            user=self.responder,
            first_name="Juan",
            last_name="Responder",
            date_of_birth="1990-01-01",
            address="Base",
            barangay="Marikina Heights",
        )
        community = active_test_community()
        ResidentProfile.objects.filter(user__in=[self.resident, self.responder]).update(
            community=community,
            barangay=community.name,
        )
        sync_responder_designation(self.responder)
        ResponderShift.objects.create(
            responder=self.responder,
            responder_unit=User.ResponderUnit.BDRRMO,
            status=ResponderShift.Status.ACTIVE,
            started_at=timezone.now() - timedelta(minutes=10),
        )

    # -- helpers ---------------------------------------------------------

    def post(self, body, sender="+639451234821", token=TOKEN, **extra):
        return self.client.post(
            self.url,
            {"from": sender, "msg": body, **extra},
            format="json",
            HTTP_X_SMS_WEBHOOK_TOKEN=token,
        )

    def last_reply(self):
        message = OutboundSmsMessage.objects.order_by("-id").first()
        return message.body if message else ""

    # -- authentication --------------------------------------------------

    def test_a_bad_token_is_rejected_and_nothing_is_stored(self):
        response = self.post(WIZARD_MESSAGE, token="wrong")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(InboundSmsMessage.objects.count(), 0)

    @override_settings(SMS_INBOUND_WEBHOOK_TOKEN="")
    def test_an_unconfigured_token_refuses_everything(self):
        # Fail closed: an open emergency-intake endpoint would let anyone
        # fabricate alerts against any resident's number.
        self.assertEqual(self.post(WIZARD_MESSAGE, token="").status_code, status.HTTP_403_FORBIDDEN)

    # -- emergency creation ----------------------------------------------

    def test_wizard_message_creates_a_routed_emergency(self):
        response = self.post(WIZARD_MESSAGE)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        alert = EmergencyAlert.objects.get()
        self.assertEqual(alert.type, "fire")
        self.assertEqual(alert.reporter, self.resident)
        self.assertEqual(alert.reported_area, "Champaca Street, Marikina Heights")
        self.assertIsNotNone(alert.latitude)
        self.assertEqual(alert.location_source, "sms_gps")
        self.assertEqual(alert.reporter_verification, EmergencyAlert.ReporterVerification.REGISTERED_NUMBER)
        # Routed without any official touching it.
        self.assertTrue(alert.assignments.exists())
        self.assertEqual(alert.status, EmergencyAlert.Status.ROUTED)

    def test_no_prefix_is_required_anymore(self):
        response = self.post("tulong may sunog dito sa Champaca Street")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(EmergencyAlert.objects.get().type, "fire")

    def test_area_only_message_is_saved_without_coordinates(self):
        response = self.post(
            "I need immediate help. This is a Medical Emergency near the covered court "
            "in Marikina Heights. Please send assistance."
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        alert = EmergencyAlert.objects.get()
        self.assertIsNone(alert.latitude)
        self.assertIsNone(alert.longitude)
        self.assertIn("covered court", alert.reported_area)
        self.assertEqual(alert.location_confidence, EmergencyAlert.LocationConfidence.REPORTED)

    def test_invalid_coordinates_are_flagged_and_never_replaced_with_a_default(self):
        self.post(
            "I need immediate help. This is a Fire emergency near Champaca Street. "
            "Please send assistance.\nLOC:999,999"
        )
        alert = EmergencyAlert.objects.get()
        self.assertIsNone(alert.latitude)
        self.assertIsNone(alert.longitude)
        self.assertIn("coordinates", alert.unresolved_fields)

    def test_coordinates_outside_the_service_area_escalate_but_stay_active(self):
        # Quezon City, well outside the barangay.
        self.post(
            "I need immediate help. This is a Fire emergency. Please send assistance.\n"
            "LOC:14.6760000,121.0437000"
        )
        alert = EmergencyAlert.objects.get()
        self.assertEqual(alert.location_confidence, EmergencyAlert.LocationConfidence.UNKNOWN)
        self.assertNotIn(alert.status, {EmergencyAlert.Status.INVALID, EmergencyAlert.Status.CANCELLED})
        self.assertTrue(alert.escalations.exists())

    def test_an_unregistered_sender_still_gets_an_emergency(self):
        response = self.post(WIZARD_MESSAGE, sender="+639998887777")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        alert = EmergencyAlert.objects.get()
        self.assertEqual(alert.reporter_verification, EmergencyAlert.ReporterVerification.UNVERIFIED_NUMBER)
        self.assertEqual(alert.reporter_contact_number, "+639998887777")
        self.assertIn("not yet registered", self.last_reply())

    def test_local_number_format_matches_the_registered_account(self):
        # Registered as +639171234821, texting from a handset reporting 0917...
        self.post(WIZARD_MESSAGE, sender="09451234821")
        self.assertEqual(EmergencyAlert.objects.get().reporter, self.resident)

    def test_triage_answers_survive_the_round_trip(self):
        self.post(
            "I need immediate help. This is a Fire emergency near Champaca Street, "
            "Marikina Heights. 2-5 people affected, someone is injured, fire is still "
            "spreading. Please send assistance.\nLOC:14.6507000,121.1133000"
        )
        alert = EmergencyAlert.objects.get()
        self.assertEqual(alert.triage.get("people_affected"), "few")
        self.assertEqual(alert.triage.get("injuries"), "yes")

    # -- duplicates ------------------------------------------------------

    def test_a_gateway_retry_does_not_create_a_second_emergency(self):
        payload = {"from": "+639451234821", "msg": WIZARD_MESSAGE, "id": "gw-1"}
        first = self.client.post(self.url, payload, format="json", HTTP_X_SMS_WEBHOOK_TOKEN=TOKEN)
        second = self.client.post(self.url, payload, format="json", HTTP_X_SMS_WEBHOOK_TOKEN=TOKEN)
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(EmergencyAlert.objects.count(), 1)
        self.assertEqual(InboundSmsMessage.objects.count(), 1)

    @override_settings(SMS_INBOUND_PENDING_RECOVERY_SECONDS=15)
    def test_stale_pending_gateway_retry_is_recovered(self):
        payload = InboundPayload(
            body="GUIDE",
            sender="+639451234821",
            gateway_timestamp=None,
            gateway_message_id="stale-pending-1",
            raw={"from": "+639451234821", "msg": "GUIDE", "id": "stale-pending-1"},
        )
        row = InboundSmsMessage.objects.create(
            sender_number=payload.sender,
            body=payload.body,
            dedupe_key=payload.dedupe_key(),
            gateway_message_id=payload.gateway_message_id,
            raw_payload=payload.raw,
        )
        InboundSmsMessage.objects.filter(pk=row.pk).update(
            server_received_at=timezone.now() - timedelta(minutes=2)
        )

        response = self.post("GUIDE", id="stale-pending-1")

        row.refresh_from_db()
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(row.outcome, InboundSmsMessage.Outcome.COMMAND_HANDLED)
        self.assertEqual(InboundSmsMessage.objects.count(), 1)

    @override_settings(SMS_INBOUND_PENDING_MAX_AGE_HOURS=1)
    def test_ancient_pending_message_expires_without_delayed_reply(self):
        row = InboundSmsMessage.objects.create(
            sender_number="+639451234821",
            body="GUIDE",
            dedupe_key="a" * 64,
            gateway_message_id="ancient-1",
            raw_payload={"from": "+639451234821", "msg": "GUIDE", "id": "ancient-1"},
        )
        InboundSmsMessage.objects.filter(pk=row.pk).update(
            server_received_at=timezone.now() - timedelta(hours=2)
        )

        result = recover_stuck_inbound_messages()

        row.refresh_from_db()
        self.assertEqual(result["expired"], 1)
        self.assertEqual(row.outcome, InboundSmsMessage.Outcome.ERROR)
        self.assertFalse(row.replies.exists())

    def test_dedupe_without_gateway_id_is_stable(self):
        first = InboundPayload(
            body="GUIDE", sender="+639451234821", gateway_timestamp=None,
            gateway_message_id="", raw={"from": "+639451234821", "msg": "GUIDE"},
        )
        retry = InboundPayload(
            body="GUIDE", sender="+639451234821", gateway_timestamp=None,
            gateway_message_id="", raw={"msg": "GUIDE", "from": "+639451234821"},
        )
        self.assertEqual(first.dedupe_key(), retry.dedupe_key())

    def test_a_second_emergency_while_one_is_open_returns_status_instead(self):
        self.post(WIZARD_MESSAGE, id="gw-1")
        response = self.post("HELP MEDICAL", id="gw-2")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(EmergencyAlert.objects.count(), 1)
        self.assertIn("STATUS", self.last_reply())

    # -- commands --------------------------------------------------------

    def test_every_status_event_says_what_happened(self):
        """The timeline used to read "Emergency received" for every entry."""
        self.post(WIZARD_MESSAGE, id="v-1")
        self.post("SAFE", id="v-2")
        self.post("CANCEL", id="v-3")

        alert = EmergencyAlert.objects.get()
        labels = list(alert.status_events.values_list("label", flat=True))
        self.assertIn("Emergency received", labels)
        self.assertIn("Resident reported safe", labels)
        self.assertIn("Cancellation requested", labels)
        # Every event carries its own heading rather than repeating one.
        self.assertEqual(len([l for l in labels if l]), len(labels))

    def test_guide_lists_the_commands_and_categories(self):
        self.post("GUIDE")
        reply = self.last_reply()
        self.assertIn("HELP <TYPE>", reply)
        self.assertIn("FIRE", reply)
        self.assertIn("CANCEL", reply)
        # Every branch must record what it did, or the operations log shows
        # "pending" forever for messages that were in fact answered.
        self.assertEqual(
            InboundSmsMessage.objects.get().outcome,
            InboundSmsMessage.Outcome.COMMAND_HANDLED,
        )

    def test_no_handled_message_is_left_pending(self):
        for index, message in enumerate(["GUIDE", "STATUS", "HELP", "HELPP FIER", WIZARD_MESSAGE]):
            self.post(message, id=f"pending-{index}")
        stuck = list(
            InboundSmsMessage.objects.filter(
                outcome=InboundSmsMessage.Outcome.PENDING
            ).values_list("body", flat=True)
        )
        self.assertEqual(stuck, [], f"messages left pending: {stuck}")

    def test_help_with_a_category_and_place_creates_an_emergency(self):
        response = self.post("HELP FIRE Champaca Street")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        alert = EmergencyAlert.objects.get()
        self.assertEqual(alert.type, "fire")
        self.assertEqual(alert.reported_area, "Champaca Street")

    def test_help_without_a_category_asks_for_one(self):
        response = self.post("HELP")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(EmergencyAlert.objects.count(), 0)
        self.assertIn("HELP FIRE", self.last_reply())

    def test_an_unknown_command_gets_a_helpful_reply_never_silence(self):
        response = self.post("HELPP FIER")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        reply = self.last_reply()
        self.assertIn("did not understand", reply)
        self.assertIn("GUIDE", reply)
        self.assertEqual(
            InboundSmsMessage.objects.get().outcome,
            InboundSmsMessage.Outcome.UNRECOGNISED,
        )

    def test_status_reports_the_open_emergency_in_plain_language(self):
        self.post(WIZARD_MESSAGE, id="gw-1")
        self.post("STATUS", id="gw-2")
        reply = self.last_reply()
        self.assertIn("Fire", reply)
        self.assertIn("Champaca Street", reply)
        self.assertNotIn("routed", reply)  # no raw enum values

    def test_status_with_no_report_says_so(self):
        self.post("STATUS")
        self.assertIn("no active emergency", self.last_reply().lower())

    def test_safe_is_visible_but_does_not_close_the_incident(self):
        from apps.emergencies.views import ACTIVE_STATUSES

        self.post(WIZARD_MESSAGE, id="gw-1")
        self.post("SAFE", id="gw-2")
        alert = EmergencyAlert.objects.get()

        # Visible: the incident used to look completely untouched afterwards.
        self.assertEqual(alert.status, EmergencyAlert.Status.RESIDENT_SAFE)
        # But still open - a responder confirms before anyone stands down.
        self.assertIn(alert.status, ACTIVE_STATUSES)
        self.assertTrue(alert.status_events.filter(event_key="resident_safe").exists())
        self.assertIn("Salamat", self.last_reply())

    def test_safe_does_not_rewrite_the_residents_own_note(self):
        self.post(WIZARD_MESSAGE, id="gw-1")
        before = EmergencyAlert.objects.get().note
        self.post("SAFE", id="gw-2")
        self.assertEqual(EmergencyAlert.objects.get().note, before)

    def test_cancel_is_a_request_not_an_action(self):
        self.post(WIZARD_MESSAGE, id="gw-1")
        self.post("CANCEL", id="gw-2")
        alert = EmergencyAlert.objects.get()
        self.assertNotEqual(alert.status, EmergencyAlert.Status.CANCELLED)
        self.assertTrue(alert.status_events.filter(event_key="resident_cancel_requested").exists())
        self.assertIn("official will confirm", self.last_reply())

    # -- privacy ---------------------------------------------------------

    def test_an_otp_shaped_message_is_dropped_and_never_forwarded(self):
        response = self.post("Your OTP code is 482731. Do not share it.")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        inbound = InboundSmsMessage.objects.get()
        self.assertEqual(inbound.outcome, InboundSmsMessage.Outcome.DROPPED_OTP)
        self.assertNotIn("482731", inbound.body)
        self.assertEqual(OutboundSmsMessage.objects.count(), 0)

    def test_the_stored_reply_never_contains_a_full_phone_number(self):
        self.post(WIZARD_MESSAGE)
        for body in OutboundSmsMessage.objects.values_list("body", flat=True):
            self.assertNotIn("639451234821", body.replace(" ", ""))

    def test_the_webhook_token_is_not_persisted_in_the_raw_payload(self):
        self.client.post(
            f"{self.url}?token={TOKEN}",
            {"from": "+639451234821", "msg": "GUIDE"},
            format="json",
        )
        inbound = InboundSmsMessage.objects.get()
        self.assertNotIn(TOKEN, str(inbound.raw_payload))

    # -- transport shapes ------------------------------------------------

    def test_get_with_query_parameters_works(self):
        response = self.client.get(
            self.url,
            {"from": "+639451234821", "msg": "GUIDE", "time": "1700000000"},
            HTTP_X_SMS_WEBHOOK_TOKEN=TOKEN,
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("GUIDE", self.last_reply())

    def test_form_encoded_post_works(self):
        response = self.client.post(
            self.url,
            {"sender": "+639451234821", "text": "GUIDE"},
            HTTP_X_SMS_WEBHOOK_TOKEN=TOKEN,
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_smsgate_cloud_webhook_shape_works(self):
        response = self.client.post(
            self.url,
            {
                "id": "smsgate-1",
                "sender": "+639451234821",
                "contentPreview": WIZARD_MESSAGE,
                "type": "SMS",
                "createdAt": "2026-08-02T00:00:00Z",
            },
            format="json",
            HTTP_X_SMS_WEBHOOK_TOKEN=TOKEN,
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        alert = EmergencyAlert.objects.get()
        self.assertEqual(alert.type, "fire")
        self.assertEqual(alert.reporter, self.resident)

    def test_the_legacy_emergency_url_still_works(self):
        response = self.client.post(
            reverse("emergency-sms-inbound"),
            {"from": "+639451234821", "msg": WIZARD_MESSAGE},
            format="json",
            HTTP_X_SMS_WEBHOOK_TOKEN=TOKEN,
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(EmergencyAlert.objects.count(), 1)

    def test_the_url_works_without_a_trailing_slash(self):
        # APPEND_SLASH cannot redirect a POST without dropping the body, so a
        # gateway configured without the slash used to 500 on every emergency.
        response = self.client.post(
            "/api/sms/inbound",
            {"from": "+639451234821", "msg": "GUIDE"},
            format="json",
            HTTP_X_SMS_WEBHOOK_TOKEN=TOKEN,
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("GUIDE", self.last_reply())

    def test_the_legacy_url_also_works_without_a_trailing_slash(self):
        response = self.client.post(
            "/api/emergencies/sms-inbound",
            {"from": "+639451234821", "msg": "GUIDE"},
            format="json",
            HTTP_X_SMS_WEBHOOK_TOKEN=TOKEN,
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_a_message_with_no_body_is_rejected_cleanly(self):
        response = self.client.post(
            self.url, {"from": "+639451234821"}, format="json", HTTP_X_SMS_WEBHOOK_TOKEN=TOKEN
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_server_receive_time_is_the_official_submission_time(self):
        # A gateway clock claiming 2001 must not backdate the incident.
        self.post(WIZARD_MESSAGE, time="1000000000")
        inbound = InboundSmsMessage.objects.get()
        alert = EmergencyAlert.objects.get()
        self.assertEqual(inbound.gateway_received_at.year, 2001)
        self.assertGreater(alert.created_at.year, 2020)
