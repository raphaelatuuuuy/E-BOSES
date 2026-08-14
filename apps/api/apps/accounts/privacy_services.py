from datetime import date

from django.db import transaction
from django.utils import timezone

from apps.concerns.models import Concern, ConcernComment, ConcernVote
from apps.emergencies.models import EmergencyAlert
from apps.notifications.models import BrowserPushSubscription, Notification

from .models import (
    AccountRequest,
    AuditLog,
    ConsentRecord,
    OTPChallenge,
    ResidenceProof,
)


class PrivacyRequestConflict(Exception):
    pass


def _values(queryset, *fields):
    return list(queryset.values(*fields))


def build_account_data_export(user):
    """Build an explicit, password/token-free copy of the resident's stored data."""
    profile = getattr(user, "resident_profile", None)
    settings_obj = getattr(user, "resident_settings", None)
    concerns = Concern.objects.filter(reporter=user).order_by("created_at", "id")
    emergencies = EmergencyAlert.objects.filter(reporter=user).order_by("created_at", "id")
    audit_queryset = AuditLog.objects.filter(target_user=user).order_by("created_at", "id")

    return {
        "generated_at": timezone.now(),
        "account": {
            "id": user.pk,
            "email": user.email,
            "phone_number": user.phone_number,
            "role": user.role,
            "status": user.status,
            "is_active": user.is_active,
            "email_verified_at": user.email_verified_at,
            "phone_verified_at": user.phone_verified_at,
            "last_seen_at": user.last_seen_at,
            "date_joined": user.date_joined,
            "updated_at": user.updated_at,
        },
        "profile": None if profile is None else {
            "first_name": profile.first_name,
            "middle_name": profile.middle_name,
            "last_name": profile.last_name,
            "date_of_birth": profile.date_of_birth,
            "address": profile.address,
            "barangay": profile.barangay,
            "gender": profile.gender,
            "avatar": profile.avatar,
            "created_at": profile.created_at,
            "updated_at": profile.updated_at,
        },
        "settings": None if settings_obj is None else {
            "push_alerts": settings_obj.push_alerts,
            "report_updates": settings_obj.report_updates,
            "community_sharing": settings_obj.community_sharing,
            "location_confirmation": settings_obj.location_confirmation,
            "sos_placement": settings_obj.sos_placement,
            "updated_at": settings_obj.updated_at,
        },
        "consents": _values(
            ConsentRecord.objects.filter(user=user).order_by("consented_at", "id"),
            "id", "terms_version", "privacy_version", "ip_address", "user_agent", "consented_at",
        ),
        "identity_proofs": _values(
            ResidenceProof.objects.filter(user=user).order_by("uploaded_at", "id"),
            "id", "side", "original_filename", "mime_type", "file_size", "access_level", "uploaded_at",
        ),
        "concerns": _values(
            concerns,
            "id", "public_id", "tracking_number", "title", "description", "category", "status",
            "address", "latitude", "longitude", "location_source", "location_accuracy", "barangay",
            "update_text", "visibility", "validation_status", "validation_summary", "rejection_code",
            "created_at", "updated_at",
        ),
        "concern_comments": _values(
            ConcernComment.objects.filter(author=user).order_by("created_at", "id"),
            "id", "concern_id", "parent_id", "body", "original_body", "is_edited", "created_at", "updated_at",
        ),
        "concern_votes": _values(
            ConcernVote.objects.filter(user=user).order_by("created_at", "id"),
            "id", "concern_id", "value", "created_at",
        ),
        "emergencies": _values(
            emergencies,
            "id", "public_id", "type", "note", "status", "barangay", "latitude", "longitude",
            "location_source", "location_accuracy", "address", "media_warnings", "created_at", "updated_at",
            "routed_at", "resolved_at",
        ),
        "notifications": _values(
            Notification.objects.filter(recipient=user).order_by("created_at", "id"),
            "id", "type", "title", "body", "is_read", "concern_id", "emergency_id", "created_at",
        ),
        "account_requests": _values(
            AccountRequest.objects.filter(user=user).order_by("created_at", "id"),
            "id", "type", "status", "note", "staff_note", "created_at", "updated_at",
        ),
        "audit_events": _values(audit_queryset, "id", "action", "metadata", "created_at"),
    }


def _delete_private_proof_files(user):
    for proof in ResidenceProof.objects.filter(user=user):
        if proof.file:
            proof.file.delete(save=False)
        if proof.blurred_preview_file:
            proof.blurred_preview_file.delete(save=False)
        proof.delete()


@transaction.atomic
def anonymize_resident_account(user):
    """Remove account PII while retaining anonymized civic records required for case history."""
    active_concerns = Concern.objects.filter(reporter=user).exclude(
        status__in=[Concern.Status.RESOLVED, Concern.Status.REJECTED]
    ).count()
    active_emergencies = EmergencyAlert.objects.filter(reporter=user).exclude(
        status__in=[EmergencyAlert.Status.RESOLVED, EmergencyAlert.Status.CANCELLED]
    ).count()
    if active_concerns or active_emergencies:
        raise PrivacyRequestConflict(
            "Deletion is deferred until all active concerns and emergency incidents are closed."
        )

    user = type(user).objects.select_for_update().get(pk=user.pk)
    profile = getattr(user, "resident_profile", None)
    _delete_private_proof_files(user)
    BrowserPushSubscription.objects.filter(user=user).delete()
    Notification.objects.filter(recipient=user).delete()
    ConsentRecord.objects.filter(user=user).delete()
    OTPChallenge.objects.filter(user=user).delete()
    AuditLog.objects.filter(target_user=user).update(metadata={})
    AuditLog.objects.filter(actor=user).update(metadata={})

    if profile is not None:
        profile.first_name = "Deleted"
        profile.middle_name = ""
        profile.last_name = "Resident"
        profile.date_of_birth = date(1900, 1, 1)
        profile.address = ""
        profile.barangay = "Marikina Heights"
        profile.gender = ""
        profile.avatar = ""
        profile.save(update_fields=[
            "first_name", "middle_name", "last_name", "date_of_birth", "address",
            "barangay", "gender", "avatar", "updated_at",
        ])

    user.email = f"deleted+{user.pk}@privacy.invalid"
    user.phone_number = f"+638{user.pk:09d}"
    user.status = user.Status.SUSPENDED
    user.is_active = False
    user.is_staff = False
    user.is_superuser = False
    user.is_on_duty = False
    user.current_latitude = None
    user.current_longitude = None
    user.location_updated_at = None
    user.email_verified_at = None
    user.phone_verified_at = None
    user.last_seen_at = None
    user.set_unusable_password()
    user.save(update_fields=[
        "email", "phone_number", "status", "is_active", "is_staff", "is_superuser",
        "is_on_duty", "current_latitude", "current_longitude", "location_updated_at",
        "email_verified_at", "phone_verified_at", "last_seen_at", "password", "updated_at",
    ])
    return user


def deletion_blockers(user):
    """What is stopping this account from being deleted right now.

    The officials' console got a 409 and the resident got nothing, so someone
    who asked to be deleted was never told why it had not happened.
    """
    active_concerns = list(
        Concern.objects.filter(reporter=user)
        .exclude(status__in=[Concern.Status.RESOLVED, Concern.Status.REJECTED])
        .values_list("tracking_number", flat=True)[:10]
    )
    active_emergencies = EmergencyAlert.objects.filter(reporter=user).exclude(
        status__in=[EmergencyAlert.Status.RESOLVED, EmergencyAlert.Status.CANCELLED]
    ).count()

    if not active_concerns and not active_emergencies:
        return {"blocked": False, "reasons": [], "concerns": [], "emergencies": 0}

    reasons = []
    if active_concerns:
        reasons.append(
            f"{len(active_concerns)} report(s) are still open. They close first, then the account is removed."
        )
    if active_emergencies:
        reasons.append(
            f"{active_emergencies} emergency record(s) are still active."
        )
    return {
        "blocked": True,
        "reasons": reasons,
        "concerns": [tracking for tracking in active_concerns if tracking],
        "emergencies": active_emergencies,
    }
