from decimal import Decimal

from django.db import migrations


DEFAULT_NAME = "Marikina Heights"


def coordinate_pairs(value):
    if not isinstance(value, list):
        return
    if len(value) >= 2 and all(isinstance(item, (int, float)) for item in value[:2]):
        yield float(value[0]), float(value[1])
        return
    for item in value:
        yield from coordinate_pairs(item)


def forwards(apps, schema_editor):
    Community = apps.get_model("emergencies", "Community")
    MapGeometry = apps.get_model("emergencies", "MapGeometry")
    MapDispatchPolicy = apps.get_model("emergencies", "MapDispatchPolicy")
    MapServicePoi = apps.get_model("emergencies", "MapServicePoi")
    EmergencyAlert = apps.get_model("emergencies", "EmergencyAlert")
    EmergencyCategory = apps.get_model("emergencies", "EmergencyCategory")
    EmergencyTypeRoleMap = apps.get_model("emergencies", "EmergencyTypeRoleMap")
    EmergencyResponderAssignment = apps.get_model("emergencies", "EmergencyResponderAssignment")
    Issue = apps.get_model("emergencies", "CommunityMigrationIssue")

    Department = apps.get_model("concerns", "Department")
    ConcernCategory = apps.get_model("concerns", "ConcernCategory")
    Concern = apps.get_model("concerns", "Concern")
    Announcement = apps.get_model("concerns", "Announcement")
    BarangayEvent = apps.get_model("concerns", "BarangayEvent")

    ResidentProfile = apps.get_model("accounts", "ResidentProfile")
    OCRConfigurationVersion = apps.get_model("accounts", "OCRConfigurationVersion")
    ResidenceVerificationCase = apps.get_model("accounts", "ResidenceVerificationCase")
    Notification = apps.get_model("notifications", "Notification")

    policy = MapDispatchPolicy.objects.order_by("pk").first()
    boundary = (
        MapGeometry.objects.filter(kind="boundary", is_home=True, is_active=True).order_by("pk").first()
        or MapGeometry.objects.filter(kind="boundary", name__iexact=DEFAULT_NAME, is_active=True).order_by("pk").first()
        or MapGeometry.objects.filter(kind="boundary", is_active=True).order_by("pk").first()
    )
    center_lat = policy.acceptance_center_latitude if policy else Decimal("14.6507000")
    center_lng = policy.acceptance_center_longitude if policy else Decimal("121.1133000")
    bounds = {}
    if boundary:
        pairs = list(coordinate_pairs((boundary.geometry or {}).get("coordinates", [])))
        if pairs:
            lngs = [item[0] for item in pairs]
            lats = [item[1] for item in pairs]
            bounds = {
                "bbox_min_latitude": min(lats),
                "bbox_max_latitude": max(lats),
                "bbox_min_longitude": min(lngs),
                "bbox_max_longitude": max(lngs),
            }

    registration_ready = bool(
        boundary
        and bounds
        and OCRConfigurationVersion.objects.filter(scope="residence_proof", status="published").exists()
    )
    community, _ = Community.objects.update_or_create(
        code="marikina-heights",
        defaults={
            "name": DEFAULT_NAME,
            "status": "active" if registration_ready else "draft",
            "boundary": boundary,
            "center_latitude": center_lat,
            "center_longitude": center_lng,
            "boundary_revision": 1,
            **bounds,
        },
    )

    matching_policies = MapDispatchPolicy.objects.filter(barangay__iexact=DEFAULT_NAME).order_by("pk")
    canonical_policy = matching_policies.first()
    if canonical_policy:
        canonical_policy.community = community
        canonical_policy.save(update_fields=["community"])
    for duplicate in matching_policies.exclude(pk=getattr(canonical_policy, "pk", None)):
        Issue.objects.get_or_create(
            model_label="emergencies.MapDispatchPolicy",
            object_id=str(duplicate.pk),
            reason="duplicate_community_policy",
            defaults={"raw_value": duplicate.barangay[:255]},
        )
    if not registration_ready:
        Issue.objects.get_or_create(
            model_label="emergencies.Community",
            object_id=str(community.pk),
            reason="incomplete_registration_configuration",
            defaults={"raw_value": DEFAULT_NAME},
        )
    MapServicePoi.objects.filter(community__isnull=True).update(community=community)
    EmergencyCategory.objects.filter(community__isnull=True).update(community=community)
    EmergencyTypeRoleMap.objects.filter(community__isnull=True).update(community=community)
    EmergencyAlert.objects.filter(barangay__iexact=DEFAULT_NAME).update(community=community)
    EmergencyResponderAssignment.objects.filter(responding_community__isnull=True).update(
        responding_community=community
    )

    Department.objects.filter(community__isnull=True).update(community=community)
    ConcernCategory.objects.filter(community__isnull=True).update(community=community)
    Concern.objects.filter(barangay__iexact=DEFAULT_NAME).update(community=community)
    Announcement.objects.filter(barangay__iexact=DEFAULT_NAME).update(community=community)
    BarangayEvent.objects.filter(barangay__iexact=DEFAULT_NAME).update(community=community)

    ResidentProfile.objects.filter(barangay__iexact=DEFAULT_NAME).update(community=community)
    OCRConfigurationVersion.objects.filter(community__isnull=True).update(community=community)
    ResidenceVerificationCase.objects.filter(community__isnull=True).update(community=community)

    Notification.objects.filter(community__isnull=True, concern__community=community).update(community=community)
    Notification.objects.filter(community__isnull=True, emergency__community=community).update(community=community)

    legacy_models = [
        ("accounts.ResidentProfile", ResidentProfile, "barangay"),
        ("concerns.Concern", Concern, "barangay"),
        ("concerns.Announcement", Announcement, "barangay"),
        ("concerns.BarangayEvent", BarangayEvent, "barangay"),
        ("emergencies.EmergencyAlert", EmergencyAlert, "barangay"),
        ("emergencies.MapDispatchPolicy", MapDispatchPolicy, "barangay"),
    ]
    for label, model, field in legacy_models:
        for item in model.objects.filter(community__isnull=True).only("pk", field).iterator():
            Issue.objects.get_or_create(
                model_label=label,
                object_id=str(item.pk),
                reason="unknown_community",
                defaults={"raw_value": str(getattr(item, field, "") or "")[:255]},
            )


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0057_ocrconfigurationversion_community_and_more"),
        ("concerns", "0051_announcement_community_and_more"),
        ("emergencies", "0043_mapservicepoi_community_and_more"),
        ("notifications", "0020_notification_community_notification_department_and_more"),
    ]

    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
