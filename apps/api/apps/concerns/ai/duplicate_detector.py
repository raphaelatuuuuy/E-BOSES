import re
from dataclasses import dataclass
from datetime import timedelta
from difflib import SequenceMatcher

from django.utils import timezone

from apps.geo_services import haversine_meters

from apps.concerns.models import Concern


MAX_NEARBY_DISTANCE_METERS = 1_000
LOOKBACK_DAYS = 180
MINIMUM_MEANINGFUL_TOKENS = 4

_STOP_WORDS = {
    "a", "ang", "at", "ay", "beside", "for", "in", "is", "ito", "mga", "na",
    "ng", "on", "sa", "the", "this", "to", "with", "yung",
}


@dataclass(frozen=True)
class DuplicateMatch:
    possible_duplicate: bool
    similarity: float | None = None
    distance_meters: int | None = None
    matched_concern_id: int | None = None
    matched_tracking_id: str | None = None

    def as_payload(self, *, enabled: bool, threshold: float) -> dict:
        return {
            "enabled": enabled,
            "threshold": threshold,
            "possible_duplicate": self.possible_duplicate,
            "similarity": self.similarity,
            "distance_meters": self.distance_meters,
            "matched_concern_id": self.matched_concern_id,
            "matched_tracking_id": self.matched_tracking_id,
        }


def find_duplicate_concern(concern: Concern, *, enabled: bool, threshold: float) -> DuplicateMatch:
    if not enabled or concern.latitude is None or concern.longitude is None:
        return DuplicateMatch(possible_duplicate=False)

    source_tokens = _tokens(f"{concern.title} {concern.description}")
    if len(source_tokens) < MINIMUM_MEANINGFUL_TOKENS:
        return DuplicateMatch(possible_duplicate=False)

    safe_threshold = min(1.0, max(0.0, float(threshold)))
    candidates = (
        Concern.objects.filter(
            barangay=concern.barangay,
            category=concern.category,
            created_at__gte=timezone.now() - timedelta(days=LOOKBACK_DAYS),
        )
        .exclude(pk=concern.pk)
        .exclude(status=Concern.Status.REJECTED)
        .exclude(latitude__isnull=True)
        .exclude(longitude__isnull=True)
        .order_by("-created_at")[:200]
    )

    best: tuple[float, float, Concern] | None = None
    for candidate in candidates:
        distance = haversine_meters(
            float(concern.latitude),
            float(concern.longitude),
            float(candidate.latitude),
            float(candidate.longitude),
        )
        if distance > MAX_NEARBY_DISTANCE_METERS:
            continue
        similarity = _similarity(source_tokens, _tokens(f"{candidate.title} {candidate.description}"))
        if similarity < safe_threshold:
            continue
        if best is None or similarity > best[0] or (similarity == best[0] and distance < best[1]):
            best = (similarity, distance, candidate)

    if best is None:
        return DuplicateMatch(possible_duplicate=False)
    similarity, distance, candidate = best
    return DuplicateMatch(
        possible_duplicate=True,
        similarity=round(similarity, 4),
        distance_meters=round(distance),
        matched_concern_id=candidate.pk,
        matched_tracking_id=candidate.tracking_id,
    )


def _tokens(value: str) -> list[str]:
    return [
        token
        for token in re.findall(r"[a-z0-9]+", (value or "").casefold())
        if len(token) > 1 and token not in _STOP_WORDS
    ]


def _similarity(left: list[str], right: list[str]) -> float:
    if len(right) < MINIMUM_MEANINGFUL_TOKENS:
        return 0.0
    left_set, right_set = set(left), set(right)
    union = left_set | right_set
    jaccard = len(left_set & right_set) / len(union) if union else 0.0
    sequence = SequenceMatcher(None, " ".join(left), " ".join(right)).ratio()
    return max(jaccard, sequence)
