"""Durable record of every SMS the gateway number handles.

Two privacy rules shape these tables:

* Destination numbers are stored as a hash plus the last four digits. A dump of
  this table must not become a directory of every resident's mobile number.
* Outbound bodies are stored for operational messages but **blanked for OTP
  purposes**, so a registration code can never be read back out of the database.

Inbound bodies are kept in full because an emergency message is evidence, and
the brief requires restricted audit access to the original SMS.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models

from .normalize import hash_number, last_four, mask_ph_mobile


class SmsPurpose(models.TextChoices):
    EMERGENCY = "emergency", "Emergency"
    EMERGENCY_ACK = "emergency_ack", "Emergency acknowledgement"
    DISPATCH = "dispatch", "Responder dispatch"
    COMMAND_REPLY = "command_reply", "Command reply"
    OTP = "otp", "Registration OTP"
    OFFICIAL_ALERT = "official_alert", "Official alert"
    SYSTEM = "system", "System"


class SmsOperatorPin(models.Model):
    """Second factor for official SMS commands that change an emergency.

    A phone number is not an authentication factor: SIMs are shared, swapped and
    spoofed. Read commands are open to a matched official; anything that alters
    an incident needs this PIN as well.
    """

    MAX_ATTEMPTS = 5

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="sms_operator_pin",
    )
    pin_hash = models.CharField(max_length=256)
    failed_attempts = models.PositiveSmallIntegerField(default=0)
    locked_at = models.DateTimeField(null=True, blank=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    @property
    def is_locked(self) -> bool:
        return self.locked_at is not None or self.failed_attempts >= self.MAX_ATTEMPTS

    @property
    def attempts_left(self) -> int:
        return max(0, self.MAX_ATTEMPTS - self.failed_attempts)

    def set_pin(self, raw_pin: str) -> None:
        from django.contrib.auth.hashers import make_password

        self.pin_hash = make_password(raw_pin)
        self.failed_attempts = 0
        self.locked_at = None

    def check_pin(self, raw_pin: str) -> bool:
        from django.contrib.auth.hashers import check_password
        from django.utils import timezone

        if self.is_locked:
            return False
        if check_password(raw_pin or "", self.pin_hash):
            self.failed_attempts = 0
            self.last_used_at = timezone.now()
            self.save(update_fields=["failed_attempts", "last_used_at", "updated_at"])
            return True
        self.failed_attempts += 1
        if self.failed_attempts >= self.MAX_ATTEMPTS:
            self.locked_at = timezone.now()
        self.save(update_fields=["failed_attempts", "locked_at", "updated_at"])
        return False

    def __str__(self):
        return f"SMS PIN for user {self.user_id}"


class InboundSmsMessage(models.Model):
    """A message received on the gateway number.

    `dedupe_key` is unique: SMS Forwarder retries on a flaky connection and the
    same message can arrive several times. The first write wins and every later
    delivery is recognised and answered from the stored outcome instead of
    creating a second emergency.
    """

    class Outcome(models.TextChoices):
        PENDING = "pending", "Pending"
        EMERGENCY_CREATED = "emergency_created", "Emergency created"
        COMMAND_HANDLED = "command_handled", "Command handled"
        UNRECOGNISED = "unrecognised", "Unrecognised"
        DUPLICATE = "duplicate", "Duplicate"
        DROPPED_OTP = "dropped_otp", "Dropped (OTP-shaped)"
        REJECTED = "rejected", "Rejected"
        ERROR = "error", "Error"

    sender_number = models.CharField(max_length=24, blank=True, db_index=True)
    sender_hash = models.CharField(max_length=64, blank=True, db_index=True)
    body = models.TextField(blank=True)
    dedupe_key = models.CharField(max_length=64, unique=True)
    gateway_message_id = models.CharField(max_length=120, blank=True)
    gateway_received_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Timestamp claimed by the gateway. Informational only unless validated.",
    )
    server_received_at = models.DateTimeField(
        auto_now_add=True,
        db_index=True,
        help_text="Official submission time for anything created from this message.",
    )
    matched_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="inbound_sms_messages",
    )
    sender_match_status = models.CharField(max_length=24, blank=True)
    outcome = models.CharField(max_length=32, choices=Outcome.choices, default=Outcome.PENDING)
    command_keyword = models.CharField(max_length=24, blank=True)
    alert = models.ForeignKey(
        "emergencies.EmergencyAlert",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="inbound_sms_messages",
    )
    detail = models.CharField(max_length=255, blank=True)
    raw_payload = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-server_received_at", "-id"]
        indexes = [
            models.Index(fields=["outcome", "server_received_at"], name="sms_inbound_outcome_time"),
            models.Index(fields=["sender_hash", "server_received_at"], name="sms_inbound_sender_time"),
        ]

    def __str__(self):
        return f"Inbound SMS #{self.pk} ({self.outcome})"

    @property
    def masked_sender(self) -> str:
        return mask_ph_mobile(self.sender_number)


class OutboundSmsMessage(models.Model):
    """A message E-Boses asked the gateway to send.

    `idempotency_key` is unique so a Celery retry, a duplicate inbound, or two
    workers racing on the same alert cannot text a resident twice.
    """

    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        SENDING = "sending", "Sending"
        SENT = "sent", "Sent"
        DELIVERED = "delivered", "Delivered"
        FAILED = "failed", "Failed"
        SKIPPED = "skipped", "Skipped (gateway disabled)"

    destination_hash = models.CharField(max_length=64, db_index=True)
    destination_last_four = models.CharField(max_length=4, blank=True)
    body = models.TextField(
        blank=True,
        help_text="Blank for OTP purposes — codes are never persisted.",
    )
    segments = models.PositiveSmallIntegerField(default=1)
    purpose = models.CharField(max_length=32, choices=SmsPurpose.choices, default=SmsPurpose.SYSTEM)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.QUEUED)
    # Wide enough for a readable prefix plus a 64-char SHA-256 digest
    # ("reply:<dedupe_key>", "otp:<hash>:<ts>"). `queue_sms` also hashes down
    # anything longer, so a future caller cannot overflow this.
    idempotency_key = models.CharField(max_length=128, unique=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    last_error = models.CharField(max_length=255, blank=True)
    driver = models.CharField(max_length=32, blank=True)
    provider_message_id = models.CharField(max_length=64, blank=True, db_index=True)
    provider_state = models.CharField(max_length=24, blank=True)
    alert = models.ForeignKey(
        "emergencies.EmergencyAlert",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="outbound_sms_messages",
    )
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="outbound_sms_messages",
    )
    in_reply_to = models.ForeignKey(
        InboundSmsMessage,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="replies",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["status", "created_at"], name="sms_outbound_status_time"),
            models.Index(fields=["purpose", "created_at"], name="sms_outbound_purpose_time"),
        ]

    def __str__(self):
        return f"Outbound SMS #{self.pk} -> ••••{self.destination_last_four} ({self.status})"

    def set_destination(self, number: str) -> None:
        self.destination_hash = hash_number(number)
        self.destination_last_four = last_four(number)
