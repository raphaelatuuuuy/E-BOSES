"""Responder and official SMS commands."""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import ResidentProfile
from apps.emergencies.models import (
    EmergencyAlert,
    EmergencyResponderAssignment,
    ResponderShift,
)
from apps.sms.models import InboundSmsMessage, OutboundSmsMessage, SmsOperatorPin

TOKEN = "test-inbound-token"
TEST_CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}

RESIDENT_NUMBER = "+639451111001"
RESPONDER_NUMBER = "+639451111002"
BACKUP_NUMBER = "+639451111003"
OFFICIAL_NUMBER = "+639451111004"


@override_settings(
    SMS_INBOUND_WEBHOOK_TOKEN=TOKEN,
    OUTBOUND_SMS_DRIVER="disabled",
    CELERY_TASK_ALWAYS_EAGER=True,
    CHANNEL_LAYERS=TEST_CHANNEL_LAYERS,
    OSM_ROUTE_URL="",
)
class StaffCommandTests(APITestCase):
    url = "/api/sms/inbound/"

    def setUp(self):
        User = get_user_model()
        self.resident = self._user("staffcmd-resident@example.com", RESIDENT_NUMBER, "Maria", "Dela Cruz")
        self.responder = self._responder("staffcmd-responder@example.com", RESPONDER_NUMBER, "Juan")
        self.backup = self._responder("staffcmd-backup@example.com", BACKUP_NUMBER, "Pedro")
        self.official = self._user(
            "staffcmd-official@example.com",
            OFFICIAL_NUMBER,
            "Ana",
            "Official",
            role=User.Role.BARANGAY_OFFICIAL,
        )

    def _user(self, email, phone, first, last, **extra):
        User = get_user_model()
        user = User.objects.create_user(
            email=email, phone_number=phone, password="pass", status=User.Status.VERIFIED, **extra
        )
        ResidentProfile.objects.create(
            user=user,
            first_name=first,
            last_name=last,
            date_of_birth="1990-01-01",
            address="Somewhere",
            barangay="Marikina Heights",
        )
        return user

    def _responder(self, email, phone, first):
        User = get_user_model()
        user = self._user(
            email,
            phone,
            first,
            "Responder",
            role=User.Role.FIRST_RESPONDER,
            responder_unit=User.ResponderUnit.BDRRMO,
            is_on_duty=True,
            current_latitude="14.6516000",
            current_longitude="121.1208000",
            location_updated_at=timezone.now(),
        )
        ResponderShift.objects.create(
            responder=user,
            responder_unit=User.ResponderUnit.BDRRMO,
            status=ResponderShift.Status.ACTIVE,
            started_at=timezone.now() - timedelta(minutes=5),
        )
        return user

    def post(self, body, sender, **extra):
        return self.client.post(
            self.url,
            {"from": sender, "msg": body, **extra},
            format="json",
            HTTP_X_SMS_WEBHOOK_TOKEN=TOKEN,
        )

    def reply_to(self, number):
        from apps.sms.normalize import last_four

        message = (
            OutboundSmsMessage.objects.filter(destination_last_four=last_four(number))
            .order_by("-id")
            .first()
        )
        return message.body if message else ""

    def make_alert(self, **kwargs):
        alert = EmergencyAlert.objects.create(
            reporter=self.resident,
            type="fire",
            note="Smoke from the second floor.",
            latitude="14.6507000",
            longitude="121.1133000",
            address="Champaca Street",
            reported_area="Champaca Street",
            reporter_contact_number=RESIDENT_NUMBER,
            barangay="Marikina Heights",
            status=EmergencyAlert.Status.ROUTED,
            **kwargs,
        )
        EmergencyResponderAssignment.objects.create(
            alert=alert,
            responder=self.responder,
            status=EmergencyResponderAssignment.Status.ASSIGNED,
            source=EmergencyResponderAssignment.Source.AUTO,
        )
        return alert

    # -- responder -------------------------------------------------------

    def test_guide_is_role_specific(self):
        self.post("GUIDE", RESPONDER_NUMBER, id="g1")
        self.assertIn("RESPONDER GUIDE", self.reply_to(RESPONDER_NUMBER))
        self.post("GUIDE", OFFICIAL_NUMBER, id="g2")
        self.assertIn("OFFICIAL GUIDE", self.reply_to(OFFICIAL_NUMBER))
        self.post("GUIDE", RESIDENT_NUMBER, id="g3")
        self.assertIn("WHAT TO SEND", self.reply_to(RESIDENT_NUMBER))

    def test_accept_marks_the_responder_en_route(self):
        alert = self.make_alert()
        self.post(f"ACCEPT E-{alert.pk}", RESPONDER_NUMBER, id="a1")
        alert.refresh_from_db()
        self.assertEqual(alert.status, EmergencyAlert.Status.EN_ROUTE)
        assignment = alert.assignments.get(responder=self.responder)
        self.assertEqual(assignment.status, EmergencyResponderAssignment.Status.EN_ROUTE)
        self.assertIsNotNone(assignment.acknowledged_at)
        self.assertIn("EN ROUTE", self.reply_to(RESPONDER_NUMBER))

    def test_accept_works_without_a_reference_using_the_current_assignment(self):
        alert = self.make_alert()
        self.post("ACCEPT", RESPONDER_NUMBER, id="a2")
        alert.refresh_from_db()
        self.assertEqual(alert.status, EmergencyAlert.Status.EN_ROUTE)

    def test_decline_requires_a_reason(self):
        alert = self.make_alert()
        self.post(f"DECLINE E-{alert.pk}", RESPONDER_NUMBER, id="d1")
        alert.refresh_from_db()
        self.assertEqual(
            alert.assignments.get(responder=self.responder).status,
            EmergencyResponderAssignment.Status.ASSIGNED,
        )
        self.assertIn("needs a short reason", self.reply_to(RESPONDER_NUMBER))

    def test_decline_with_a_reason_reassigns_the_next_responder(self):
        alert = self.make_alert()
        self.post(f"DECLINE E-{alert.pk} already on another call", RESPONDER_NUMBER, id="d2")
        alert.refresh_from_db()
        self.assertEqual(
            alert.assignments.get(responder=self.responder).status,
            EmergencyResponderAssignment.Status.DECLINED,
        )
        self.assertTrue(alert.assignments.filter(responder=self.backup).exists())
        self.assertIn("Another responder has been assigned", self.reply_to(RESPONDER_NUMBER))

    def test_decline_with_nobody_free_escalates_instead_of_dropping(self):
        self.backup.is_on_duty = False
        self.backup.save(update_fields=["is_on_duty"])
        alert = self.make_alert()
        self.post(f"DECLINE E-{alert.pk} vehicle broke down", RESPONDER_NUMBER, id="d3")
        alert.refresh_from_db()
        self.assertTrue(alert.escalations.exists())
        self.assertNotIn(alert.status, {EmergencyAlert.Status.RESOLVED, EmergencyAlert.Status.CANCELLED})
        self.assertIn("escalated to an official", self.reply_to(RESPONDER_NUMBER))

    def test_onscene_then_resolved_closes_the_incident_with_a_note(self):
        alert = self.make_alert()
        self.post(f"ACCEPT E-{alert.pk}", RESPONDER_NUMBER, id="r1")
        self.post(f"ONSCENE E-{alert.pk}", RESPONDER_NUMBER, id="r2")
        alert.refresh_from_db()
        self.assertEqual(alert.status, EmergencyAlert.Status.ARRIVED)

        self.post(f"RESOLVED E-{alert.pk} fire out, no injuries", RESPONDER_NUMBER, id="r3")
        alert.refresh_from_db()
        self.assertEqual(alert.status, EmergencyAlert.Status.RESOLVED)
        self.assertIn("fire out", alert.resolution_report)

    def test_resolved_requires_a_note(self):
        alert = self.make_alert()
        self.post(f"RESOLVED E-{alert.pk}", RESPONDER_NUMBER, id="r4")
        alert.refresh_from_db()
        self.assertNotEqual(alert.status, EmergencyAlert.Status.RESOLVED)
        self.assertIn("needs a short reason", self.reply_to(RESPONDER_NUMBER))

    def test_backup_assigns_and_notifies_a_support_responder(self):
        alert = self.make_alert()
        self.post(f"BACKUP E-{alert.pk} need medical assistance", RESPONDER_NUMBER, id="b1")
        alert.refresh_from_db()
        self.assertTrue(alert.assignments.filter(responder=self.backup).exists())
        self.assertTrue(alert.escalations.filter(triggered_by=self.responder).exists())
        self.assertIn("assigned to support you", self.reply_to(RESPONDER_NUMBER))

    def test_backup_does_not_replace_the_original_responder(self):
        alert = self.make_alert()
        self.post(f"BACKUP E-{alert.pk} need more hands", RESPONDER_NUMBER, id="b2")
        self.assertEqual(
            alert.assignments.get(responder=self.responder).status,
            EmergencyResponderAssignment.Status.ASSIGNED,
        )

    def test_duty_can_be_toggled_by_sms(self):
        self.post("OFFDUTY", RESPONDER_NUMBER, id="duty1")
        self.responder.refresh_from_db()
        self.assertFalse(self.responder.is_on_duty)
        self.assertIn("OFF DUTY", self.reply_to(RESPONDER_NUMBER))

        self.post("ONDUTY", RESPONDER_NUMBER, id="duty2")
        self.responder.refresh_from_db()
        self.assertTrue(self.responder.is_on_duty)
        self.assertIn("ON DUTY", self.reply_to(RESPONDER_NUMBER))

    def test_responder_with_no_assignment_is_told_so(self):
        self.post("ACCEPT", RESPONDER_NUMBER, id="none1")
        self.assertIn("no active assignment", self.reply_to(RESPONDER_NUMBER))

    def test_a_responder_cannot_use_an_official_command(self):
        self.post("CLOSE E-1 1234 done", RESPONDER_NUMBER, id="nope1")
        self.assertIn("not available for this number", self.reply_to(RESPONDER_NUMBER))

    # -- official --------------------------------------------------------

    def test_open_lists_active_emergencies(self):
        alert = self.make_alert()
        self.post("OPEN", OFFICIAL_NUMBER, id="o1")
        reply = self.reply_to(OFFICIAL_NUMBER)
        self.assertIn(f"E-{alert.pk}", reply)
        self.assertIn("Champaca Street", reply)

    def test_detail_shows_one_incident_with_a_masked_contact(self):
        alert = self.make_alert()
        self.post(f"DETAIL E-{alert.pk}", OFFICIAL_NUMBER, id="o2")
        reply = self.reply_to(OFFICIAL_NUMBER)
        self.assertIn("Fire", reply)
        self.assertIn("xxx 1001", reply)
        self.assertNotIn(RESIDENT_NUMBER.replace("+", ""), reply.replace(" ", ""))

    def test_onduty_lists_the_roster(self):
        self.post("ONDUTY", OFFICIAL_NUMBER, id="o3")
        self.assertIn("ON DUTY", self.reply_to(OFFICIAL_NUMBER))

    def test_a_write_command_without_a_pin_is_refused(self):
        alert = self.make_alert()
        self.post(f"CLOSE E-{alert.pk} 9999 done", OFFICIAL_NUMBER, id="w1")
        alert.refresh_from_db()
        self.assertNotEqual(alert.status, EmergencyAlert.Status.RESOLVED)
        self.assertIn("PIN", self.reply_to(OFFICIAL_NUMBER))

    def test_a_write_command_with_a_valid_pin_is_applied(self):
        pin = SmsOperatorPin(user=self.official)
        pin.set_pin("4821")
        pin.save()
        alert = self.make_alert()

        self.post(f"CLOSE E-{alert.pk} 4821 stood down after check", OFFICIAL_NUMBER, id="w2")
        alert.refresh_from_db()
        self.assertEqual(alert.status, EmergencyAlert.Status.RESOLVED)
        self.assertIn("stood down", alert.resolution_report)
        self.assertIn("is now closed", self.reply_to(OFFICIAL_NUMBER))

    def test_a_wrong_pin_counts_down_and_then_locks(self):
        pin = SmsOperatorPin(user=self.official)
        pin.set_pin("4821")
        pin.save()
        alert = self.make_alert()

        for index in range(SmsOperatorPin.MAX_ATTEMPTS):
            self.post(f"ESCALATE E-{alert.pk} 0000", OFFICIAL_NUMBER, id=f"bad{index}")
        pin.refresh_from_db()
        self.assertTrue(pin.is_locked)
        self.assertIn("locked", self.reply_to(OFFICIAL_NUMBER))

        self.post(f"ESCALATE E-{alert.pk} 4821", OFFICIAL_NUMBER, id="afterlock")
        alert.refresh_from_db()
        self.assertFalse(alert.escalations.exists())

    def test_escalate_with_a_valid_pin_records_an_escalation(self):
        pin = SmsOperatorPin(user=self.official)
        pin.set_pin("4821")
        pin.save()
        alert = self.make_alert()

        self.post(f"ESCALATE E-{alert.pk} 4821 needs city rescue", OFFICIAL_NUMBER, id="esc1")
        alert.refresh_from_db()
        self.assertTrue(alert.escalations.filter(triggered_by=self.official).exists())
        self.assertIn("escalated", self.reply_to(OFFICIAL_NUMBER))

    def test_assign_is_not_available_over_sms(self):
        alert = self.make_alert()
        self.post(f"ASSIGN E-{alert.pk} 5 4821", OFFICIAL_NUMBER, id="asg1")
        self.assertIn("not available", self.reply_to(OFFICIAL_NUMBER))

    # -- dispatch notifications ------------------------------------------

    def test_an_auto_assigned_responder_is_texted_the_dispatch(self):
        response = self.post(
            "I need immediate help. This is a Fire emergency near Champaca Street. "
            "Please send assistance.\nLOC:14.6507000,121.1133000",
            RESIDENT_NUMBER,
            id="dispatch1",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        dispatch = self.reply_to(RESPONDER_NUMBER)
        self.assertIn("DISPATCH", dispatch)
        self.assertIn("FIRE", dispatch)
        self.assertIn("Champaca Street", dispatch)
        self.assertIn("Reply ACCEPT", dispatch)

    def test_a_dispatch_text_masks_the_reporter_number(self):
        self.post(
            "I need immediate help. This is a Fire emergency near Champaca Street. "
            "Please send assistance.",
            RESIDENT_NUMBER,
            id="dispatch2",
        )
        dispatch = self.reply_to(RESPONDER_NUMBER)
        self.assertIn("xxx 1001", dispatch)
        self.assertNotIn(RESIDENT_NUMBER.replace("+", ""), dispatch.replace(" ", ""))

    def test_dispatch_is_not_sent_twice_for_the_same_responder(self):
        alert = self.make_alert()
        from apps.sms.notify import notify_responder_assigned

        notify_responder_assigned(alert, self.responder)
        notify_responder_assigned(alert, self.responder)
        self.assertEqual(
            OutboundSmsMessage.objects.filter(
                purpose="dispatch", alert=alert, recipient=self.responder
            ).count(),
            1,
        )

    def test_every_staff_reply_is_recorded_against_the_inbound_message(self):
        alert = self.make_alert()
        self.post(f"ACCEPT E-{alert.pk}", RESPONDER_NUMBER, id="audit1")
        inbound = InboundSmsMessage.objects.get(gateway_message_id="audit1")
        self.assertEqual(inbound.command_keyword, "ACCEPT")
        self.assertEqual(inbound.alert_id, alert.pk)
        self.assertEqual(inbound.outcome, InboundSmsMessage.Outcome.COMMAND_HANDLED)
        self.assertTrue(inbound.replies.exists())
