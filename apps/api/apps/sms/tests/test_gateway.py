"""Outbound gateway: message sizing, payload shaping, idempotency, privacy."""

from django.test import SimpleTestCase, TestCase, override_settings

from apps.sms import templates
from apps.sms.gateway import (
    IDEMPOTENCY_KEY_MAX_LENGTH,
    HttpJsonSmsDriver,
    SmsForwarderDriver,
    count_segments,
    is_gsm7,
    non_gsm7_characters,
    queue_sms,
)
from apps.sms.models import OutboundSmsMessage, SmsPurpose


class SegmentTests(SimpleTestCase):
    def test_short_ascii_message_is_one_segment(self):
        self.assertEqual(count_segments("E-BOSES: help is on the way."), 1)

    def test_gsm7_rolls_over_at_160(self):
        self.assertEqual(count_segments("a" * 160), 1)
        self.assertEqual(count_segments("a" * 161), 2)
        self.assertEqual(count_segments("a" * 306), 2)

    def test_a_single_curly_quote_halves_the_budget(self):
        plain = "a" * 100
        curly = "a" * 99 + "’"
        self.assertEqual(count_segments(plain), 1)
        self.assertFalse(is_gsm7(curly))
        self.assertEqual(count_segments(curly), 2)

    def test_non_gsm7_characters_are_reported(self):
        self.assertEqual(non_gsm7_characters("plain text"), [])
        self.assertIn("•", non_gsm7_characters("mask ••• 4821"))


class TemplateSafetyTests(SimpleTestCase):
    """Every template must survive the GSM-7 budget.

    A template that slips a smart quote or a bullet in would silently double
    the cost of every message that uses it and could push a guide past the
    three-segment limit some handsets stop reassembling at.
    """

    def test_all_templates_are_gsm7(self):
        offenders = {
            name: non_gsm7_characters(body)
            for name, body in templates.all_static_templates().items()
            if not is_gsm7(body)
        }
        self.assertEqual(offenders, {}, f"Templates left the GSM-7 alphabet: {offenders}")

    def test_templates_stay_inside_their_segment_budget(self):
        # Operational replies go out constantly and must stay cheap. The guides
        # are sent only when someone asks for one, so they get a little more
        # room to actually list every command and category.
        budget = {"guide_resident": 4, "guide_responder": 4, "guide_official": 4}
        oversized = {
            name: count_segments(body)
            for name, body in templates.all_static_templates().items()
            if count_segments(body) > budget.get(name, 3)
        }
        self.assertEqual(oversized, {}, f"Templates over budget: {oversized}")

    def test_guide_lists_every_category_a_resident_can_send(self):
        guide = templates.guide_resident()
        for word, _hint in templates.CATEGORY_MENU:
            self.assertIn(word, guide)

    def test_unknown_command_reply_names_what_was_received_and_offers_the_guide(self):
        body = templates.unknown_command("HELPP FIER")
        self.assertNotIn("HELPP FIER", body)
        self.assertIn("GUIDE", body)
        self.assertIn("HELP FIRE", body)

    def test_otp_template_says_five_minutes_and_warns_against_sharing(self):
        body = templates.otp_message("482731")
        self.assertIn("482731", body)
        self.assertIn("5 minutes", body)
        self.assertIn("Do not share", body)


@override_settings(
    OUTBOUND_SMS_DRIVER="http_generic",
    OUTBOUND_SMS_URL="http://127.0.0.1:9/send",
    OUTBOUND_SMS_SIM_SLOT=2,
    OUTBOUND_SMS_PAYLOAD_TEMPLATE="",
)
class PayloadShapingTests(SimpleTestCase):
    def test_default_generic_payload(self):
        payload = HttpJsonSmsDriver().build_payload("+639171234821", "hello")
        self.assertEqual(payload, {"to": "+639171234821", "message": "hello"})

    def test_sms_forwarder_default_shape(self):
        payload = SmsForwarderDriver().build_payload("+639171234821", "hello")
        self.assertEqual(payload["data"]["phone_numbers"], "+639171234821")
        self.assertEqual(payload["data"]["msg_content"], "hello")
        self.assertEqual(payload["data"]["sim_slot"], 2)

    @override_settings(OUTBOUND_SMS_PAYLOAD_TEMPLATE='{"dest": "{to}", "txt": "{body}"}')
    def test_field_names_are_correctable_from_settings(self):
        payload = HttpJsonSmsDriver().build_payload("+639171234821", "hello")
        self.assertEqual(payload, {"dest": "+639171234821", "txt": "hello"})

    @override_settings(
        OUTBOUND_SMS_PAYLOAD_TEMPLATE='{"phoneNumbers":["{to}"],"textMessage":{"text":"{body}"},"simNumber":1}'
    )
    def test_smsgate_cloud_payload_shape(self):
        payload = HttpJsonSmsDriver().build_payload("+639171234821", "hello")
        self.assertEqual(
            payload,
            {
                "phoneNumbers": ["+639171234821"],
                "textMessage": {"text": "hello"},
                "simNumber": 1,
            },
        )

    def test_quotes_and_newlines_in_the_body_cannot_break_the_json(self):
        nasty = 'He said "help" \\ now\nLOC:14.6,121.1'
        payload = HttpJsonSmsDriver().build_payload("+639171234821", nasty)
        self.assertEqual(payload["message"], nasty)

    @override_settings(
        OUTBOUND_SMS_METHOD="GET",
        OUTBOUND_SMS_URL="http://phone:8080/send?phone={to}&text={body}",
    )
    def test_get_style_gateway_url_is_percent_encoded(self):
        url = HttpJsonSmsDriver().build_url("+639171234821", "help now")
        self.assertIn("phone=%2B639171234821", url)
        self.assertIn("text=help%20now", url)


# ALWAYS_EAGER runs the delivery task inline so these tests exercise the real
# task body and do not depend on whether a Redis broker happens to be running
# on the machine. Without it, a reachable broker with no worker attached leaves
# every message sitting at "queued" and the assertions become meaningless.
@override_settings(OUTBOUND_SMS_DRIVER="disabled", CELERY_TASK_ALWAYS_EAGER=True)
class QueueTests(TestCase):
    def test_same_idempotency_key_never_sends_twice(self):
        first = queue_sms("+639171234821", "one", idempotency_key="dup-key")
        second = queue_sms("+639171234821", "two", idempotency_key="dup-key")
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(OutboundSmsMessage.objects.count(), 1)

    def test_destination_is_stored_hashed_with_only_the_last_four_visible(self):
        message = queue_sms("+639171234821", "hello", idempotency_key="hash-key")
        self.assertEqual(message.destination_last_four, "4821")
        self.assertNotIn("639171234821", message.destination_hash)
        self.assertEqual(len(message.destination_hash), 64)
        for field in OutboundSmsMessage.objects.filter(pk=message.pk).values()[0].values():
            self.assertNotIn("+639171234821", str(field))

    def test_otp_bodies_are_never_persisted(self):
        message = queue_sms(
            "+639171234821",
            templates.otp_message("482731"),
            purpose=SmsPurpose.OTP,
            idempotency_key="otp-key",
        )
        self.assertEqual(message.body, "")
        message.refresh_from_db()
        self.assertNotIn("482731", message.body)

    def test_operational_bodies_are_kept_for_the_audit_trail(self):
        message = queue_sms(
            "+639171234821",
            "E-BOSES: help is on the way.",
            purpose=SmsPurpose.EMERGENCY_ACK,
            idempotency_key="ack-key",
        )
        self.assertIn("help is on the way", message.body)

    def test_a_non_ph_destination_is_refused_rather_than_sent(self):
        self.assertIsNone(queue_sms("161", "hello", idempotency_key="short-code"))
        self.assertIsNone(queue_sms("", "hello", idempotency_key="empty"))

    def test_every_key_fits_the_column_on_a_strict_database(self):
        """SQLite silently accepts an over-long varchar; Postgres raises.

        Without this, a key like "reply:<64-char sha256>" passes every test and
        then 500s in production. Assert the width directly instead of trusting
        the test database.
        """
        field = OutboundSmsMessage._meta.get_field("idempotency_key")
        self.assertEqual(field.max_length, IDEMPOTENCY_KEY_MAX_LENGTH)

        digest = "a" * 64  # the shape of every sha256 hex we build keys from
        for key in (
            f"reply:{digest}",
            f"otp:{digest}:1735689600",
            "dispatch:999999:999999",
            f"noresponder:{digest}:42",
        ):
            with self.subTest(key=key):
                message = queue_sms("+639171234821", "hello", idempotency_key=key)
                self.assertLessEqual(len(message.idempotency_key), field.max_length)

    def test_an_over_long_key_is_hashed_not_truncated(self):
        # Truncation would make two different long keys collide and silently
        # swallow the second message.
        first = queue_sms("+639171234821", "a", idempotency_key="x" * 200 + "-one")
        second = queue_sms("+639171234821", "b", idempotency_key="x" * 200 + "-two")
        self.assertNotEqual(first.pk, second.pk)
        self.assertEqual(len(first.idempotency_key), 64)

    def test_a_disabled_gateway_marks_the_message_skipped_not_sent(self):
        # Delivery runs on transaction commit so a rolled-back alert never
        # texts anyone, which means the test has to let the commit hooks fire.
        with self.captureOnCommitCallbacks(execute=True):
            message = queue_sms("+639171234821", "hello", idempotency_key="disabled-key")
        message.refresh_from_db()
        self.assertEqual(message.status, OutboundSmsMessage.Status.SKIPPED)
        self.assertIn("No outbound SMS gateway is configured", message.last_error)
