"""Domain services for creating, moderating, and routing concerns."""

from django.db import transaction
from django.utils import timezone

from apps.ai_validation.tasks import enqueue_concern_validation

from .models import Concern


@transaction.atomic
def create_concern(*, reporter, validated_data, enqueue_ai_validation=True):
    """Create a concern and optionally enqueue advisory AI validation."""
    concern = Concern.objects.create(reporter=reporter, **validated_data)
    if enqueue_ai_validation:
        enqueue_concern_validation(concern.id)
    return concern


@transaction.atomic
def record_reviewer_override(
    concern,
    *,
    reviewer,
    severity_score=None,
    category=None,
    relevance_score=None,
    fake_report_score=None,
    reason="",
):
    """Record an official override of advisory AI fields without auto-approving a concern."""
    concern.reviewer = reviewer
    concern.reviewer_severity_score = severity_score
    concern.reviewer_category = category
    concern.reviewer_relevance_score = relevance_score
    concern.reviewer_fake_report_score = fake_report_score
    concern.reviewer_override_reason = reason
    concern.reviewed_at = timezone.now()
    concern.save(
        update_fields=[
            "reviewer",
            "reviewer_severity_score",
            "reviewer_category",
            "reviewer_relevance_score",
            "reviewer_fake_report_score",
            "reviewer_override_reason",
            "reviewed_at",
            "updated_at",
        ]
    )
    return concern
