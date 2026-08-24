"""Create an emergency from a parsed SMS.

The ordering here is the whole point of the module:

1. Save the alert.
2. Route it.
3. Only then reverse-geocode, notify witnesses, and reply.

Nothing in steps 3+ may delay steps 1-2. A resident texting for help must not
wait on Nominatim, on a notification fan-out, or on the SMS gateway.
"""

from __future__ import annotations

import logging

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from apps.accounts.services import create_audit_log
from apps.sms.normalize import SenderMatch, normalize_ph_mobile

from .location_services import classify_location_confidence, schedule_location_resolution
from .location_resolution import resolve_incident_location
from .models import EmergencyAlert, EmergencyCategory, EmergencyEscalation

logger = logging.getLogger(__name__)

VERIFICATION_BY_MATCH = {
    SenderMatch.REGISTERED: EmergencyAlert.ReporterVerification.REGISTERED_NUMBER,
    SenderMatch.UNVERIFIED: EmergencyAlert.ReporterVerification.UNVERIFIED_NUMBER,
    SenderMatch.NEEDS_REVIEW: EmergencyAlert.ReporterVerification.NEEDS_REVIEW,
}


class SmsIntakeResult:
    def __init__(self, *, alert=None, duplicate=False, reason="", responder=None):
        self.alert = alert
        self.duplicate = duplicate
        self.reason = reason
        self.responder = responder

    @property
    def created(self) -> bool:
        return bool(self.alert) and not self.duplicate


def resolve_category_code(code: str) -> str:
    """Map a parsed code onto an active category, falling back to `other`.

    An unconfigured category must never lose an emergency. If the barangay has
    not set up "Dangerous Animal" yet, the alert still lands as "Other
    Emergency" and reaches the general review team.
    """
    if code and EmergencyCategory.objects.filter(code=code, is_active=True).exists():
        return code
    if EmergencyCategory.objects.filter(code="other", is_active=True).exists():
        return "other"
    fallback = EmergencyCategory.objects.filter(is_active=True).order_by("sort_order", "id").first()
    return fallback.code if fallback else (code or "other")


def find_intake_reporter(sender_number: str, match: SenderMatch):
    """The account an SMS alert is filed under.

    A registered sender owns their own alert. An unmatched number still needs a
    reporter row because `EmergencyAlert.reporter` is non-null, so it is filed
    against the barangay's anonymous-intake account and the real contact number
    is stored on the alert instead.
    """
    if match.is_registered and match.user:
        return match.user
    return get_anonymous_intake_user()


ANONYMOUS_INTAKE_EMAIL = "sms-intake@eboses.invalid"


def is_anonymous_intake(user) -> bool:
    return bool(user) and getattr(user, "email", "") == ANONYMOUS_INTAKE_EMAIL


def get_anonymous_intake_user():
    """A single system account that owns SMS alerts from unknown numbers.

    Created on demand and never usable for sign-in: `is_active=False` plus an
    unusable password, on a `.invalid` domain that can never receive a password
    reset. It exists only because `EmergencyAlert.reporter` is non-null and an
    emergency from an unrecognised number still has to be saved.
    """
    User = get_user_model()
    user = User.objects.filter(email=ANONYMOUS_INTAKE_EMAIL).first()
    if user:
        return user
    user = User.objects.create(
        email=ANONYMOUS_INTAKE_EMAIL,
        # `phone_number` is unique and non-null, so this needs a value that can
        # never collide with a resident's and can never be dialled. A blank
        # string would clash with any other account that has one.
        phone_number="sms-intake",
        status=User.Status.VERIFIED,
        role=User.Role.RESIDENT,
        is_active=False,
    )
    user.set_unusable_password()
    user.save(update_fields=["password"])
    return user


def active_alert_for(reporter, contact_number: str = ""):
    """The reporter's open emergency, if any.

    For anonymous intake the reporter row is shared by every unrecognised
    number, so the sender's number is what actually distinguishes one caller
    from another. Without this filter, the first anonymous emergency of the day
    would suppress everybody else's.
    """
    from .views import ACTIVE_STATUSES

    queryset = EmergencyAlert.objects.filter(reporter=reporter, status__in=ACTIVE_STATUSES)
    if is_anonymous_intake(reporter):
        normalized = normalize_ph_mobile(contact_number)
        queryset = queryset.filter(reporter_contact_number=normalized or contact_number)
    return queryset.order_by("-created_at", "-id").first()


def create_alert_from_sms(parsed, *, sender_number: str, match: SenderMatch, inbound=None) -> SmsIntakeResult:
    """Save, route, then enrich. See the module docstring for why that order."""
    from .views import auto_route_alert, create_status_event, create_witness_notifications
    from apps.notifications.services import notify_emergency_status

    normalized_sender = normalize_ph_mobile(sender_number)
    reporter = find_intake_reporter(sender_number, match)

    existing = active_alert_for(reporter, normalized_sender)
    if existing:
        return SmsIntakeResult(alert=existing, duplicate=True, reason="active_alert_exists")

    category_code = resolve_category_code(parsed.category_code)
    resolution = resolve_incident_location(
        latitude=parsed.latitude,
        longitude=parsed.longitude,
        message_area=parsed.reported_area,
        match=match,
    )
    evidence = resolution.payload()

    alert = EmergencyAlert(
        reporter=reporter,
        type=category_code,
        note=parsed.note or "",
        community=resolution.community,
        latitude=resolution.latitude,
        longitude=resolution.longitude,
        location_source=resolution.source,
        location_freshness=resolution.freshness,
        location_age_seconds=resolution.age_seconds,
        canonical_street=resolution.canonical_street,
        location_evidence=evidence,
        address=resolution.canonical_street,
        reported_area=parsed.reported_area,
        reverse_geocoding_status=(
            EmergencyAlert.ReverseGeocodingStatus.PENDING
            if resolution.has_destination
            else EmergencyAlert.ReverseGeocodingStatus.SKIPPED
        ),
        reporter_verification=VERIFICATION_BY_MATCH.get(
            match.status, EmergencyAlert.ReporterVerification.UNVERIFIED_NUMBER
        ),
        reporter_contact_number=normalized_sender,
        triage=parsed.triage or {},
        category_needs_confirmation=parsed.category_needs_confirmation,
        unresolved_fields=list(parsed.unresolved_fields or []),
        barangay=resolution.community.name if resolution.community else "Community pending confirmation",
    )
    alert.location_confidence = classify_location_confidence(alert)
    alert.save()

    create_status_event(alert, EmergencyAlert.Status.SUBMITTED, None, event_key="received_sms")

    # Step 2: route before anything slow. `auto_route_alert` takes a request
    # only to build audit metadata, and tolerates None.
    responder = None
    if resolution.community:
        try:
            responder = auto_route_alert(alert, None)
        except Exception:
            logger.exception("Auto-routing failed for SMS alert %s; alert remains active.", alert.pk)
    else:
        reason = "Manual dispatch required: emergency community is unknown or ambiguous."
        EmergencyEscalation.objects.get_or_create(alert=alert, reason=reason)
        alert.status = EmergencyAlert.Status.ESCALATION_REQUIRED
        alert.save(update_fields=["status", "updated_at"])
        create_status_event(alert, alert.status, None, note=reason, event_key="no_responder")

    # Step 3 onwards: everything that may fail or block, none of it load-bearing.
    if alert.location_confidence == EmergencyAlert.LocationConfidence.OUTSIDE_AREA:
        EmergencyEscalation.objects.get_or_create(
            alert=alert,
            reason="Reported location is outside the configured service area.",
        )

    try:
        notify_emergency_status(
            alert,
            type=EmergencyAlert.Status.SUBMITTED,
            body="Your emergency was received by SMS.",
        )
    except Exception:
        logger.warning("Status notification failed for SMS alert %s.", alert.pk, exc_info=True)

    try:
        create_witness_notifications(alert)
    except Exception:
        logger.warning("Witness notification failed for SMS alert %s.", alert.pk, exc_info=True)

    if resolution.has_destination:
        schedule_location_resolution(alert)

    create_audit_log(
        "emergency.sms_created",
        actor=None,
        target_user=reporter,
        metadata={
            "alert_id": alert.pk,
            "category": category_code,
            "sender_match": match.status,
            "coordinate_status": parsed.coordinate_status,
            "location_source": resolution.source,
            "location_freshness": resolution.freshness,
            "location_state": resolution.state,
            "community_id": getattr(resolution.community, "pk", None),
            "candidate_community_ids": [item.pk for item in resolution.candidates],
            "location_age_seconds": resolution.age_seconds,
            "unresolved_fields": alert.unresolved_fields,
            "inbound_sms_id": getattr(inbound, "pk", None),
            # The sender's number is deliberately absent: audit rows are widely
            # readable and the number lives on the alert behind the reveal
            # endpoint instead.
        },
        request_meta={},
    )

    _broadcast_created(alert)
    _enqueue_ai_assist(alert)
    return SmsIntakeResult(alert=alert, responder=responder)


def _enqueue_ai_assist(alert) -> None:
    """Schedule the AI cleanup pass for messages the parser could not read.

    Runs only after save + route + ack so a slow model call can never delay
    dispatch. Off by default; a missing broker degrades to nothing at all.
    """
    try:
        from apps.sms.ai_assist import should_run
        from apps.sms.tasks import sms_ai_assist_task

        if should_run(alert):
            transaction.on_commit(lambda: sms_ai_assist_task.delay(alert.pk))
    except Exception:
        logger.debug("SMS AI assist not scheduled for alert %s.", alert.pk, exc_info=True)


def _broadcast_created(alert) -> None:
    try:
        from apps.live_map import emergency_payload, route_for_assignment
        from apps.notifications.services import broadcast_live_map_event

        payload = {"emergency": emergency_payload(alert), "route": route_for_assignment(alert)}
        transaction.on_commit(lambda: broadcast_live_map_event("emergency.created", payload))
    except Exception:
        logger.debug("Live-map broadcast failed for SMS alert %s.", alert.pk, exc_info=True)


def mark_resident_safe(alert, *, note: str = "", source: str = "sms") -> None:
    """Record a resident's SAFE reply.

    The status changes so everyone can see it - the incident used to look
    completely untouched afterwards - but it does not close. Responders still
    confirm on scene, because "safe" sent under duress is a known pattern in
    domestic-violence cases.

    The resident's own note is left alone; appending to it rewrote what they
    originally reported.
    """
    from .views import ACTIVE_STATUSES, create_status_event

    if alert.status in ACTIVE_STATUSES:
        alert.status = EmergencyAlert.Status.RESIDENT_SAFE
        alert.status_version += 1
        alert.save(update_fields=["status", "status_version", "updated_at"])

    create_status_event(
        alert,
        alert.status,
        None,
        note=note,
        event_key="resident_safe",
    )


def request_resident_cancellation(alert, *, reason: str = "") -> None:
    """Record a CANCEL request. An official still confirms before closing."""
    from .views import create_status_event

    create_status_event(
        alert,
        alert.status,
        None,
        note=reason,
        event_key="resident_cancel_requested",
    )
