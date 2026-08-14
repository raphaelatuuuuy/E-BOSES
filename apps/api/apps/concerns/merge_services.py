from datetime import timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .models import Concern, ConcernMergeEvent, ConcernMergeSuggestion


SUGGESTION_LOOKBACK_DAYS = 14
MIN_SUGGESTION_CONFIDENCE = 0.6

METHOD_FINGERPRINT = "fingerprint"
METHOD_TEXT_LOCATION = "text_location"
METHOD_LOCATION = "location"


class MergeConflict(Exception):
    pass


def _open_concerns(since):
    return (
        Concern.objects.filter(created_at__gte=since, archived_at__isnull=True)
        .exclude(status=Concern.Status.REJECTED)
        .select_related("reporter")
        .order_by("created_at", "id")
    )


def _score(left, right):
    if left.report_fingerprint and left.report_fingerprint == right.report_fingerprint:
        return 0.95, METHOD_FINGERPRINT, "Identical report fingerprint."
    same_text = (
        left.report_text_fingerprint
        and left.report_text_fingerprint == right.report_text_fingerprint
    )
    same_place = (
        left.report_location_bucket
        and left.report_location_bucket == right.report_location_bucket
    )
    if same_text and same_place:
        return 0.9, METHOD_TEXT_LOCATION, "Same wording reported at the same place."
    if same_text:
        return 0.75, METHOD_TEXT_LOCATION, "Same wording reported nearby."
    if same_place and left.category == right.category:
        return 0.65, METHOD_LOCATION, "Same category at the same place."
    return 0.0, "", ""


def resolve_primary(concern):
    seen = set()
    current = concern
    while current.duplicate_of_id and current.duplicate_of_id not in seen:
        seen.add(current.id)
        current = current.duplicate_of
    return current


def build_merge_suggestions(lookback_days=SUGGESTION_LOOKBACK_DAYS):
    since = timezone.now() - timedelta(days=lookback_days)
    concerns = list(_open_concerns(since))
    created = 0

    for index, candidate in enumerate(concerns):
        if candidate.duplicate_of_id:
            continue
        for primary in concerns[:index]:
            if primary.duplicate_of_id or primary.id == candidate.id:
                continue
            confidence, method, rationale = _score(candidate, primary)
            if confidence < MIN_SUGGESTION_CONFIDENCE:
                continue
            _, was_created = ConcernMergeSuggestion.objects.get_or_create(
                concern=candidate,
                primary=primary,
                defaults={
                    "confidence": confidence,
                    "method": method,
                    "rationale": rationale,
                    "status": ConcernMergeSuggestion.Status.PENDING,
                },
            )
            if was_created:
                created += 1
            break
    return created


@transaction.atomic
def merge_concern(concern, primary, *, actor=None, reason="", confidence=None, method=""):
    if concern.pk == primary.pk:
        raise MergeConflict("A report cannot be merged into itself.")

    primary = resolve_primary(primary)
    if primary.pk == concern.pk:
        raise MergeConflict("That would create a merge loop.")
    if concern.duplicates.exists():
        raise MergeConflict(
            "This report is the primary of a group. Move its duplicates first."
        )

    concern.duplicate_of = primary
    concern.save(update_fields=["duplicate_of", "updated_at"])

    ConcernMergeEvent.objects.create(
        concern=concern,
        primary=primary,
        action=ConcernMergeEvent.Action.MERGED,
        confidence=confidence,
        method=method,
        reason=reason,
        actor=actor,
    )
    ConcernMergeSuggestion.objects.filter(
        concern=concern, status=ConcernMergeSuggestion.Status.PENDING
    ).update(
        status=ConcernMergeSuggestion.Status.ACCEPTED,
        decided_at=timezone.now(),
        decided_by=actor,
    )
    return concern


@transaction.atomic
def unmerge_concern(concern, *, actor=None, reason=""):
    if not concern.duplicate_of_id:
        raise MergeConflict("This report is not merged into another.")

    previous = concern.duplicate_of
    concern.duplicate_of = None
    concern.save(update_fields=["duplicate_of", "updated_at"])

    ConcernMergeEvent.objects.create(
        concern=concern,
        primary=previous,
        action=ConcernMergeEvent.Action.UNMERGED,
        reason=reason,
        actor=actor,
    )
    return concern


@transaction.atomic
def set_primary(concern, *, actor=None):
    """Promote `concern` to primary and re-point its former group at it."""
    if not concern.duplicate_of_id:
        raise MergeConflict("This report is already a primary.")

    old_primary = resolve_primary(concern)
    siblings = list(
        Concern.objects.filter(duplicate_of=old_primary).exclude(pk=concern.pk)
    )

    concern.duplicate_of = None
    concern.save(update_fields=["duplicate_of", "updated_at"])

    old_primary.duplicate_of = concern
    old_primary.save(update_fields=["duplicate_of", "updated_at"])

    for sibling in siblings:
        sibling.duplicate_of = concern
        sibling.save(update_fields=["duplicate_of", "updated_at"])

    ConcernMergeEvent.objects.create(
        concern=concern,
        primary=None,
        action=ConcernMergeEvent.Action.PRIMARY_CHANGED,
        reason=f"Promoted over {old_primary.tracking_id}.",
        actor=actor,
    )
    return concern


@transaction.atomic
def decide_suggestion(suggestion, decision, *, actor=None, note=""):
    if suggestion.status != ConcernMergeSuggestion.Status.PENDING:
        raise MergeConflict("This suggestion has already been decided.")

    if decision == "approve":
        merge_concern(
            suggestion.concern,
            suggestion.primary,
            actor=actor,
            reason=note or suggestion.rationale,
            confidence=suggestion.confidence,
            method=suggestion.method,
        )
        suggestion.refresh_from_db()
        suggestion.status = ConcernMergeSuggestion.Status.ACCEPTED
    else:
        suggestion.status = ConcernMergeSuggestion.Status.REJECTED
        ConcernMergeEvent.objects.create(
            concern=suggestion.concern,
            primary=suggestion.primary,
            action=ConcernMergeEvent.Action.SUGGESTION_REJECTED,
            confidence=suggestion.confidence,
            method=suggestion.method,
            reason=note,
            actor=actor,
        )

    suggestion.decided_by = actor
    suggestion.decided_at = timezone.now()
    suggestion.decision_note = note
    suggestion.save(
        update_fields=["status", "decided_by", "decided_at", "decision_note"]
    )
    return suggestion


def pending_suggestions():
    return (
        ConcernMergeSuggestion.objects.filter(
            status=ConcernMergeSuggestion.Status.PENDING
        )
        .select_related("concern", "concern__reporter", "primary", "primary__reporter")
        .filter(Q(concern__archived_at__isnull=True) & Q(primary__archived_at__isnull=True))
    )
