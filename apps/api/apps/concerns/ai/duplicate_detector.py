import hashlib
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
    match_type: str = ""

    def as_payload(self, *, enabled: bool, threshold: float) -> dict:
        return {
            "enabled": enabled,
            "threshold": threshold,
            "possible_duplicate": self.possible_duplicate,
            "similarity": self.similarity,
            "distance_meters": self.distance_meters,
            "matched_concern_id": self.matched_concern_id,
            "matched_tracking_id": self.matched_tracking_id,
            "match_type": self.match_type,
        }


def report_location_bucket(latitude, longitude, *, precision: int = 4) -> str:
    if latitude is None or longitude is None:
        return ""
    return f"{round(float(latitude), precision):.{precision}f},{round(float(longitude), precision):.{precision}f}"


def normalized_report_text(*, title: str, description: str) -> str:
    tokens = _tokens(f"{title} {description}")
    return " ".join(sorted(set(tokens)))


def report_fingerprints(*, barangay: str, category: str, title: str, description: str, latitude=None, longitude=None, precision: int = 4) -> dict:
    text = normalized_report_text(title=title, description=description)
    text_source = f"{category}|{text}"
    bucket = report_location_bucket(latitude, longitude, precision=precision)
    full_source = f"{barangay}|{text_source}|{bucket}"
    return {
        "report_text_fingerprint": hashlib.sha256(text_source.encode("utf-8")).hexdigest() if text else "",
        "report_location_bucket": bucket,
        "report_fingerprint": hashlib.sha256(full_source.encode("utf-8")).hexdigest() if text and bucket else "",
    }


def find_duplicate_concern(concern: Concern, *, enabled: bool, threshold: float, lookback_days: int = LOOKBACK_DAYS, distance_meters: int = MAX_NEARBY_DISTANCE_METERS) -> DuplicateMatch:
    if not enabled or concern.latitude is None or concern.longitude is None:
        return DuplicateMatch(possible_duplicate=False)

    source_tokens = _tokens(f"{concern.title} {concern.description}")
    if len(source_tokens) < MINIMUM_MEANINGFUL_TOKENS:
        return DuplicateMatch(possible_duplicate=False)

    safe_threshold = min(1.0, max(0.0, float(threshold)))
    if concern.report_fingerprint:
        exact = Concern.objects.filter(report_fingerprint=concern.report_fingerprint).exclude(pk=concern.pk).exclude(status=Concern.Status.REJECTED).order_by("-created_at").first()
        if exact:
            return DuplicateMatch(True, 1.0, 0, exact.pk, exact.tracking_id, "exact_fingerprint")
    if concern.report_text_fingerprint and concern.report_location_bucket:
        same_text = Concern.objects.filter(
            barangay=concern.barangay,
            category=concern.category,
            report_text_fingerprint=concern.report_text_fingerprint,
            report_location_bucket=concern.report_location_bucket,
        ).exclude(pk=concern.pk).exclude(status=Concern.Status.REJECTED).order_by("-created_at").first()
        if same_text:
            return DuplicateMatch(True, 1.0, None, same_text.pk, same_text.tracking_id, "same_text_nearby")
    candidates = (
        Concern.objects.filter(
            barangay=concern.barangay,
            category=concern.category,
            created_at__gte=timezone.now() - timedelta(days=max(1, int(lookback_days))),
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
        if distance > max(1, int(distance_meters)):
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
        match_type="similar_text_nearby",
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
