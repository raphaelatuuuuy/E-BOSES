"""Report street imagery check output for the 20 existing concerns.

Queries the dev database directly (no test framework).
Mocks external services for determinism.
"""

import os
import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from unittest.mock import patch
from apps.concerns.ai import process_concern_ai
from apps.concerns.ai.gemma_analyzer import ROAD_RELATED_CATEGORIES
from apps.concerns.ai_fixtures import gemma_result
from apps.concerns.models import Concern, ConcernAiAssessment


def main():
    concerns = (
        Concern.objects.filter(
            latitude__isnull=False,
            longitude__isnull=False,
            media__mime_type__startswith="image/",
        )
        .select_related("community")
        .distinct()[:20]
    )

    # Ensure each has a fresh AI assessment row.
    for concern in concerns:
        ConcernAiAssessment.objects.get_or_create(
            concern=concern,
            defaults={"status": ConcernAiAssessment.Status.PENDING},
        )

    report = []
    with patch("apps.concerns.ai.gemma_analyzer.verify_street_context") as mock_verify, \
         patch("apps.concerns.ai.street_imagery.fetch_latest_street_imagery") as mock_fetch, \
         patch("apps.concerns.ai.pipeline.GemmaAnalyzer") as mock_analyzer:

        mock_fetch.return_value = type(
            "StreetImagery",
            (),
            {
                "pano_id": "existing-pano-001",
                "captured_date": "2026-01-15",
                "latitude": 14.65,
                "longitude": 121.11,
                "distance_meters": 10.0,
                "image_b64": "existingfakebase64",
            },
        )()
        mock_verify.return_value = {
            "verdict": "area_matches",
            "explanation": "Surroundings match the reported road location.",
        }

        for concern in concerns:
            is_road = concern.category in ROAD_RELATED_CATEGORIES
            mock_analyzer.return_value.analyze.return_value = gemma_result(
                category=concern.category,
                evidence_relationship="supports_report",
                image_review_succeeded=True,
                street_imagery_applicable=is_road,
            )
            assessment = process_concern_ai(concern.pk)
            si = assessment.raw_result.get("street_imagery", {})
            report.append(
                {
                    "tracking_id": concern.tracking_id,
                    "category": concern.category,
                    "title": concern.title,
                    "si_status": si.get("status", "none"),
                    "si_verdict": si.get("verdict", ""),
                    "si_explanation": si.get("explanation", "")[:80],
                    "si_reason": si.get("reason", ""),
                    "validation_status": concern.validation_status,
                    "rejection_code": concern.rejection_code or "",
                    "road_related": is_road,
                }
            )

    _print_report(report)


def _print_report(report):
    lines = [
        "",
        "=" * 110,
        "STREET IMAGERY CHECK — EXISTING CONCERNS (20)",
        "=" * 110,
        f"{'Tracking':<16} {'Category':<16} {'Road?':<6} {'SI Status':<16} {'Verdict':<14} {'Validation':<12} {'Rejection Code'}",
        "-" * 110,
    ]
    for r in report:
        lines.append(
            f"{r['tracking_id']:<16} {r['category']:<16} {'YES' if r['road_related'] else 'NO':<6} {r['si_status']:<16} {r['si_verdict']:<14} {r['validation_status']:<12} {r['rejection_code']}"
        )
    lines.append("-" * 110)
    road_total = sum(1 for r in report if r["road_related"])
    road_ok = sum(1 for r in report if r["road_related"] and r["si_status"] == "checked")
    non_road_na = sum(
        1 for r in report if not r["road_related"] and r["si_status"] == "not_applicable"
    )
    lines.append(f"Road-related (LLM=yes): {road_ok}/{road_total} checked")
    lines.append(f"Non-road (LLM=no): {non_road_na}/{sum(1 for r in report if not r['road_related'])} not_applicable")
    lines.append("=" * 110)
    lines.append("")
    print("\n".join(lines))


if __name__ == "__main__":
    main()