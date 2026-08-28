"""Concern severity and priority.

Mirrors apps/web/src/features/dashboard/components/record/severity.ts. The two
must agree: an official ranking a queue in the browser and the feed ordering
served by the API should not disagree about what comes first.

The important property is that **severity and priority are different things**.

Severity is objective: it comes from the review model's severity judgement,
floored by category. It never reads vote or comment counts.

It used to come from the YOLOv8 damage score — the mean confidence of the
objects a detector found in the photo. That was never a measure of how bad
something was; a crisp photo of a bench scored higher than a blurry photo of a
collapsed wall. With YOLO gone, severity reads what Gemma actually assessed
(low / medium / high over the text *and* the image) plus its urgent-attention
flag, which is the only signal that should be able to reach the top band.

Priority orders records and does include community support, because civic
engagement here is defined as residents contributing to prioritisation. But
support can only reorder concerns *within* a severity band — never lift one past
a more severe concern.

That constraint is the point. Schiff (2023) found digital reporting platforms
respond faster to wealthier, better-connected neighbourhoods, and this project
positions AI severity as the correction: ranking on "objective data from
submitted photos and text rather than on the location or social standing of the
reporter". The previous scoring here was `votes * 3 + comments * 2`, which is
pure popularity and reproduced exactly the bias the system exists to remove.
"""

from __future__ import annotations

SEVERITY_ORDER = ("low", "moderate", "high", "critical")

# Starting severity a category holds until the AI has scored the report. It is
# a placeholder for an unassessed row, not a floor under the model: applying it
# with max() once a judgement exists made a videoke noise complaint "high"
# purely because it was filed under public safety, while the reason shown beside
# it still read "does not pose an immediate physical danger".
CATEGORY_BASELINE = {
    "public_safety": 2,
    "infrastructure": 1,
    "environment": 1,
    "others": 0,
}

AGE_SATURATION_HOURS = 72
SUPPORT_SATURATION_VOTES = 25

# Gemma reports three levels; the queue shows four. `critical` is reserved for
# urgent_attention, so the top band means "someone may be in danger right now"
# rather than "the model picked the highest of three options".
SEVERITY_ESTIMATE_LEVEL = {
    "low": 0,
    "medium": 1,
    "high": 2,
}

# Priority is stored as one integer so existing "sort by priority_score desc"
# callers keep working. The severity band is multiplied into the high digits, so
# ordering by the single number still compares band first and only breaks ties
# with the within-band score. A band is worth more than any achievable
# within-band total, which is what makes the guarantee hold arithmetically.
BAND_WEIGHT = 1000
WITHIN_BAND_MAX = 100


def severity_level(concern) -> tuple[int, bool]:
    """Return (0..3, assessed).

    `assessed` is False when no completed AI assessment exists, so callers can
    say "pending" rather than presenting a category floor as a measurement.
    """
    baseline = CATEGORY_BASELINE.get(concern.category, 0)
    assessment = getattr(concern, "ai_assessment", None)

    completed = bool(assessment) and getattr(assessment, "status", "") == "completed"
    estimate = str(getattr(assessment, "severity_estimate", "") or "").lower() if completed else ""

    if estimate not in SEVERITY_ESTIMATE_LEVEL:
        return baseline, False

    if getattr(assessment, "urgent_attention", False):
        return 3, True

    level = SEVERITY_ESTIMATE_LEVEL[estimate]

    relevance = getattr(assessment, "nlp_confidence", None)
    if relevance is not None:
        from .models import ConcernClassificationConfiguration

        threshold = ConcernClassificationConfiguration.current().relevance_threshold
        if float(relevance) < threshold:
            level -= 1

    return max(0, min(3, level)), True


def severity_label(concern) -> str:
    level, _assessed = severity_level(concern)
    return SEVERITY_ORDER[level]


def priority_score(concern, *, now=None) -> int:
    """Sortable priority. Higher is more urgent.

    Band-encoded, so `ORDER BY priority_score DESC` compares severity first.
    """
    from django.utils import timezone

    level, _assessed = severity_level(concern)

    reference = now or timezone.now()
    updated = getattr(concern, "updated_at", None)
    hours = ((reference - updated).total_seconds() / 3600) if updated else 0
    age_norm = min(max(hours, 0) / AGE_SATURATION_HOURS, 1)

    votes = getattr(concern, "vote_count", 0) or 0
    support_norm = min(max(votes, 0) / SUPPORT_SATURATION_VOTES, 1)

    # Age carries more weight than support: a concern nobody has touched is a
    # service-delivery failure, whereas a popular one is merely popular.
    within_band = round(WITHIN_BAND_MAX * (0.6 * age_norm + 0.4 * support_norm))

    return level * BAND_WEIGHT + within_band
