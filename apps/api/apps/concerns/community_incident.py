"""The Community Incident payload.

One problem reported by several neighbours is one incident, not N reports. This
collapses a primary report and everything merged into it into the single object
the officials' Details tab renders.

A concern that has never been merged is still an incident of one — returning
null for those is what left the Details tab blank for every unmerged report.
"""

from .models import Concern, ConcernMedia


def reporter_name(user):
    profile = getattr(user, "resident_profile", None)
    if profile:
        name = f"{profile.first_name} {profile.last_name}".strip()
        if name:
            return name
    return user.email.split("@")[0] if user else "Resident"


def group_members(concern):
    """The primary plus every report merged into it, oldest first."""
    primary = concern
    seen = set()
    while primary.duplicate_of_id and primary.duplicate_of_id not in seen:
        seen.add(primary.pk)
        primary = primary.duplicate_of

    duplicates = list(
        Concern.objects.filter(duplicate_of=primary)
        .select_related("reporter", "reporter__resident_profile")
        .order_by("created_at", "id")
    )
    return primary, duplicates


def viewable_media(concern):
    """Only the photos this report can actually show publicly."""
    return [
        media
        for media in concern.media.all()
        if media.public_visible
        and media.privacy_state
        in {
            ConcernMedia.PrivacyState.NOT_REQUIRED,
            ConcernMedia.PrivacyState.PROTECTED,
        }
    ]


def serialize_report(concern, *, is_primary):
    viewable = viewable_media(concern)
    return {
        "id": concern.pk,
        "public_id": str(concern.public_id),
        "tracking_id": concern.tracking_id,
        "reporter_name": reporter_name(concern.reporter),
        "is_primary": is_primary,
        "description": concern.description or "",
        "category": concern.category,
        "latitude": str(concern.latitude) if concern.latitude is not None else None,
        "longitude": str(concern.longitude) if concern.longitude is not None else None,
        # Only what the viewer can open. Counting withheld photos here put a
        # "Show 1 photo" button on a report whose photo is not published, and
        # clicking it did nothing.
        "photo_count": len(viewable),
        "withheld_photo_count": concern.media.count() - len(viewable),
        "submitted_at": concern.created_at,
    }


def build(concern, *, media_serializer, context=None):
    """The CommunityIncident object for this concern's group."""
    primary, duplicates = group_members(concern)
    members = [(primary, True)] + [(item, False) for item in duplicates]

    reports = [serialize_report(item, is_primary=flag) for item, flag in members]

    photos = []
    withheld = 0
    for item, _ in members:
        viewable = viewable_media(item)
        withheld += item.media.count() - len(viewable)
        for media in viewable:
            payload = media_serializer(media, context=context or {}).data
            payload.update(
                {
                    "report_id": item.pk,
                    "report_tracking_id": item.tracking_id,
                    "reporter_name": reporter_name(item.reporter),
                }
            )
            photos.append(payload)

    timestamps = [item.created_at for item, _ in members if item.created_at]
    unit = primary.assigned_department

    return {
        "primary_id": primary.pk,
        "primary_public_id": str(primary.public_id),
        "title": primary.official_title or primary.title,
        "status": primary.status,
        "category": primary.category,
        "assigned_unit": (
            {"id": unit.pk, "name": unit.name, "code": unit.code} if unit else None
        ),
        "visibility": primary.visibility,
        "publication_block_reason": primary.publication_block_reason or "",
        "summary": primary.community_summary or primary.summary or "",
        "observed": [
            entry.get("tracking_id", "")
            for entry in (primary.community_observed or [])
            if isinstance(entry, dict)
        ],
        "address": primary.address or "",
        "report_count": len(members),
        "resident_count": len({item.reporter_id for item, _ in members}),
        "withheld_report_count": withheld,
        "photo_count": len(photos),
        "first_reported_at": min(timestamps) if timestamps else None,
        "latest_reported_at": max(timestamps) if timestamps else None,
        "reports": reports,
        "photos": photos,
    }
