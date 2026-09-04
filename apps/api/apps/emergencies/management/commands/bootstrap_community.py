import os
from datetime import date
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.core.cache import cache
from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from apps.accounts.models import (
    ResidentProfile,
    User,
)
from apps.concerns.models import (
    ConcernCategory,
    ConcernClassificationConfiguration,
    ConcernFormField,
    Department,
    Designation,
    Position,
    RoutingRule,
)
from apps.emergencies.models import (
    Community,
    EmergencyCategory,
    EmergencyTypeRoleMap,
    MapDispatchPolicy,
    MapGeometry,
    MapServicePoi,
)
from apps.geo_services import point_in_geojson, point_in_geojson_inclusive


COMMUNITY_CODE = "concepcion-dos"
PSGC_CODE = "1380700012"
SOURCE_CODE = "marikina-heights"


def model_values(instance, excluded=()):
    blocked = {"id", "pk", "created_at", "updated_at", *excluded}
    return {
        field.name: getattr(instance, field.name)
        for field in instance._meta.concrete_fields
        if field.name not in blocked and not field.primary_key
    }


def geometry_points(geometry):
    points = []
    stack = [(geometry or {}).get("coordinates") or []]
    while stack:
        item = stack.pop()
        if (
            isinstance(item, (list, tuple))
            and len(item) >= 2
            and all(isinstance(value, (int, float)) for value in item[:2])
        ):
            points.append((float(item[0]), float(item[1])))
        elif isinstance(item, (list, tuple)):
            stack.extend(item)
    return points


def geometries_overlap(left, right):
    try:
        from shapely.geometry import shape

        intersection = shape(left).intersection(shape(right))
        return not intersection.is_empty and intersection.area > 1e-12
    except (ImportError, ValueError):
        pass
    left_points = geometry_points(left)
    right_points = geometry_points(right)
    return any(point_in_geojson(lng, lat, right) is True for lng, lat in left_points) or any(
        point_in_geojson(lng, lat, left) is True for lng, lat in right_points
    )


class Command(BaseCommand):
    help = "Create or refresh an independently managed active community."

    def add_arguments(self, parser):
        parser.add_argument("--code", default=COMMUNITY_CODE)

    @transaction.atomic
    def handle(self, *args, **options):
        if options["code"] != COMMUNITY_CODE:
            raise CommandError("Only the Concepcion Dos bootstrap bundle is available.")
        password = os.environ.get("EBOSES_CONCEPCION_DOS_DEMO_PASSWORD", "")
        if not password:
            raise CommandError("Set EBOSES_CONCEPCION_DOS_DEMO_PASSWORD before seeding demo accounts.")
        source = Community.objects.filter(code=SOURCE_CODE, status=Community.Status.ACTIVE).first()
        if not source:
            raise CommandError("Marikina Heights must be active before cloning its structure.")
        boundary = self.boundary()
        bounds = self.validate_boundary(boundary)
        community, _ = Community.objects.get_or_create(
            code=COMMUNITY_CODE,
            defaults={
                "name": "Concepcion Dos",
                "psgc_code": PSGC_CODE,
                "status": Community.Status.DRAFT,
                "boundary": boundary,
                **bounds,
            },
        )
        for field, value in {
            "name": "Concepcion Dos",
            "psgc_code": PSGC_CODE,
            "status": Community.Status.DRAFT,
            "boundary": boundary,
            **bounds,
        }.items():
            setattr(community, field, value)
        community.save()
        departments = self.clone_departments(source, community)
        positions = self.clone_positions(source, departments)
        categories = self.clone_concern_categories(source, community, departments)
        self.clone_emergency_categories(source, community)
        self.clone_role_maps(source, community, departments)
        self.clone_dispatch_policy(source, community, boundary)
        self.clone_classification(source, community)
        # Residence-proof templates are configured independently per
        # community. Never copy/publish Marikina Heights' ID catalog here;
        # an unconfigured community must expose no proof options until an
        # official creates and publishes its own policy.
        self.clone_pois(community, boundary)
        accounts = self.seed_accounts(community, departments, positions, password)
        self.activate_if_ready(community)
        cache.delete("public:communities:v1")
        self.stdout.write(self.style.SUCCESS(f"{community.name} is {community.status}."))
        self.stdout.write("Account | Role / unit")
        for email, label in accounts:
            self.stdout.write(f"{email} | {label}")
        self.stdout.write(
            f"Boundary {boundary.osm_type}{boundary.osm_id}; {len(departments)} departments; {len(categories)} concern categories."
        )

    def boundary(self):
        preferred = MapGeometry.objects.filter(
            kind=MapGeometry.Kind.BOUNDARY,
            osm_type="p",
            osm_id=int(PSGC_CODE),
            is_active=True,
        ).first()
        fallback = MapGeometry.objects.filter(
            kind=MapGeometry.Kind.BOUNDARY,
            osm_type="R",
            osm_id=371346,
            is_active=True,
        ).first()
        for boundary in (preferred, fallback):
            if not boundary:
                continue
            if not any(
                other.boundary
                and geometries_overlap(boundary.geometry, other.boundary.geometry)
                for other in Community.objects.filter(status=Community.Status.ACTIVE)
                .exclude(code=COMMUNITY_CODE)
                .select_related("boundary")
            ):
                return boundary
        raise CommandError("Import PSGC/NAMRIA boundary 1380700012 before bootstrapping.")

    def validate_boundary(self, boundary):
        if (boundary.geometry or {}).get("type") not in {"Polygon", "MultiPolygon"}:
            raise CommandError("Concepcion Dos boundary must be a Polygon or MultiPolygon.")
        points = geometry_points(boundary.geometry)
        if len(points) < 4:
            raise CommandError("Concepcion Dos boundary is incomplete.")
        for other in Community.objects.filter(status=Community.Status.ACTIVE).exclude(code=COMMUNITY_CODE).select_related("boundary"):
            if other.boundary and geometries_overlap(boundary.geometry, other.boundary.geometry):
                raise CommandError(f"Concepcion Dos overlaps active community {other.name}.")
        lngs = [point[0] for point in points]
        lats = [point[1] for point in points]
        return {
            "center_latitude": Decimal(str((min(lats) + max(lats)) / 2)),
            "center_longitude": Decimal(str((min(lngs) + max(lngs)) / 2)),
            "bbox_min_latitude": Decimal(str(min(lats))),
            "bbox_max_latitude": Decimal(str(max(lats))),
            "bbox_min_longitude": Decimal(str(min(lngs))),
            "bbox_max_longitude": Decimal(str(max(lngs))),
        }

    def clone_departments(self, source, community):
        result = {}
        for row in Department.objects.filter(community=source).order_by("id"):
            values = model_values(row, {"community", "contact_number"})
            values["contact_number"] = ""
            target, _ = Department.objects.update_or_create(
                community=community, code=row.code, defaults=values
            )
            result[row.pk] = target
        return result

    def clone_positions(self, source, departments):
        result = {}
        captain = Position.objects.filter(code="barangay-captain", department__isnull=True).first()
        if not captain:
            raise CommandError("The global Barangay Captain position is missing.")
        result[captain.pk] = captain
        for row in Position.objects.filter(department__community=source).order_by("id"):
            department = departments[row.department_id]
            values = model_values(row, {"department", "code"})
            target, _ = Position.objects.update_or_create(
                department=department,
                code=f"{department.community.code}-{row.code}",
                defaults=values,
            )
            result[row.pk] = target
        return result

    def clone_concern_categories(self, source, community, departments):
        result = {}
        for row in ConcernCategory.objects.filter(community=source).order_by("id"):
            values = model_values(row, {"community", "department"})
            values["department"] = departments.get(row.department_id)
            target, _ = ConcernCategory.objects.update_or_create(
                community=community, code=row.code, defaults=values
            )
            result[row.pk] = target
            for field in row.form_fields.all():
                ConcernFormField.objects.update_or_create(
                    category=target,
                    field_key=field.field_key,
                    defaults=model_values(field, {"category", "field_key"}),
                )
            for rule in row.routing_rules.all():
                RoutingRule.objects.update_or_create(
                    category=target,
                    department=departments[rule.department_id],
                    defaults=model_values(rule, {"category", "department"}),
                )
        return result

    def clone_emergency_categories(self, source, community):
        for row in EmergencyCategory.objects.filter(community=source).order_by("id"):
            EmergencyCategory.objects.update_or_create(
                community=community,
                code=row.code,
                defaults=model_values(row, {"community", "code"}),
            )

    def clone_role_maps(self, source, community, departments):
        for row in EmergencyTypeRoleMap.objects.filter(community=source).order_by("id"):
            values = model_values(
                row,
                {"community", "department", "supporting_department", "escalation_department"},
            )
            values.update(
                department=departments.get(row.department_id),
                supporting_department=departments.get(row.supporting_department_id),
                escalation_department=departments.get(row.escalation_department_id),
            )
            EmergencyTypeRoleMap.objects.update_or_create(
                community=community,
                emergency_type=row.emergency_type,
                priority=row.priority,
                defaults=values,
            )

    def clone_dispatch_policy(self, source, community, boundary):
        source_policy = MapDispatchPolicy.objects.filter(community=source).first()
        values = model_values(
            source_policy,
            {"community", "barangay", "emergency_sms_number", "hotlines", "updated_by"},
        ) if source_policy else {}
        values.update(
            barangay=community.name,
            acceptance_center_latitude=community.center_latitude,
            acceptance_center_longitude=community.center_longitude,
            acceptance_geometry=boundary.geometry,
            emergency_sms_number="",
            hotlines=[],
            updated_by=None,
        )
        policy = MapDispatchPolicy.objects.filter(community=community).first()
        if policy:
            for field, value in values.items():
                setattr(policy, field, value)
            policy.save()
        else:
            policy = MapDispatchPolicy(
                id=(MapDispatchPolicy.objects.aggregate(value=Max("id"))["value"] or 0) + 1,
                community=community,
                **values,
            )
            policy.save(force_insert=True)
        policy.covered.set([boundary])

    def clone_classification(self, source, community):
        source_config = ConcernClassificationConfiguration.current_fresh(source)
        values = model_values(source_config, {"community", "updated_by"})
        values["updated_by"] = None
        target = ConcernClassificationConfiguration.objects.filter(community=community).first()
        if target:
            for field, value in values.items():
                setattr(target, field, value)
            target.save()
        else:
            target = ConcernClassificationConfiguration(
                id=(ConcernClassificationConfiguration.objects.aggregate(value=Max("id"))["value"] or 0) + 1,
                community=community,
                **values,
            )
            target.save(force_insert=True)

    def clone_pois(self, community, boundary):
        candidates = MapServicePoi.objects.exclude(community=community)
        for row in candidates:
            if point_in_geojson_inclusive(float(row.longitude), float(row.latitude), boundary.geometry):
                values = model_values(row, {"community"})
                MapServicePoi.objects.update_or_create(
                    community=community,
                    source=row.source,
                    osm_type=row.osm_type,
                    osm_id=row.osm_id,
                    defaults=values,
                )

    def seed_accounts(self, community, departments, positions, password):
        captain = Position.objects.get(code="barangay-captain", department__isnull=True)
        rows = [
            (
                "captain.sb@eboses.cd.test",
                ("concepcion-dos.captain@example.invalid",),
                User.Role.BARANGAY_OFFICIAL,
                "sangguniang-barangay",
                captain,
                "Community captain",
            ),
            (
                "official1.sb@eboses.cd.test",
                ("concepcion-dos.official@example.invalid",),
                User.Role.BARANGAY_OFFICIAL,
                "sangguniang-barangay",
                None,
                "Barangay official",
            ),
            (
                "responder1.tanod@eboses.cd.test",
                ("tanod1@eboses.cd.test", "concepcion-dos.tanod@example.invalid"),
                User.Role.FIRST_RESPONDER,
                "bpso-tanod",
                None,
                "Tanod responder",
            ),
            (
                "responder1.bhw@eboses.cd.test",
                ("bhw1@eboses.cd.test", "concepcion-dos.bhw@example.invalid"),
                User.Role.FIRST_RESPONDER,
                "bhw",
                None,
                "BHW responder",
            ),
            (
                "responder1.bdrrmo@eboses.cd.test",
                ("bdrrmo1@eboses.cd.test", "concepcion-dos.bdrrmo@example.invalid"),
                User.Role.FIRST_RESPONDER,
                "bdrrmo",
                None,
                "BDRRMO responder",
            ),
            *[
                (
                    f"resident{i}@eboses.cd.test",
                    (f"concepcion-dos.resident{i}@example.invalid",),
                    User.Role.RESIDENT,
                    None,
                    None,
                    "Resident",
                )
                for i in range(1, 5)
            ],
        ]
        output = []
        source_positions = {
            position.department.code: position
            for position in Position.objects.filter(department__community=community).order_by("id")
        }
        for index, (email, aliases, role, department_code, position, label) in enumerate(rows, start=1):
            demo_phone = f"demo-cd-{index:04d}"
            user = User.objects.filter(email__in=[email, *aliases]).order_by("id").first()
            if user is None:
                user = User.objects.create(email=email, phone_number=demo_phone)
            user.email = email
            user.phone_number = demo_phone
            user.role = role
            user.status = User.Status.VERIFIED
            user.is_staff = False
            user.is_superuser = False
            user.is_active = True
            user.is_onboarded = True
            user.email_verified_at = user.email_verified_at or timezone.now()
            user.responder_unit = department_code if role == User.Role.FIRST_RESPONDER else ""
            user.set_password(password)
            user.save()
            ResidentProfile.objects.update_or_create(
                user=user,
                defaults={
                    "community": community,
                    "first_name": "Concepcion Dos",
                    "last_name": label,
                    "date_of_birth": date(1990, 1, min(index, 28)),
                    "address": community.name,
                    "barangay": community.name,
                    "home_latitude": community.center_latitude,
                    "home_longitude": community.center_longitude,
                    "home_location_source": "bootstrap",
                    "profile_completed_at": timezone.now(),
                },
            )
            if department_code:
                department = next(value for value in departments.values() if value.code == department_code)
                selected_position = position or source_positions[department_code]
                Designation.objects.filter(user=user).exclude(
                    department=department, position=selected_position
                ).update(is_active=False)
                Designation.objects.update_or_create(
                    user=user,
                    department=department,
                    position=selected_position,
                    defaults={"title": label, "is_active": True},
                )
            output.append((email, label))
        return output

    def activate_if_ready(self, community):
        ready = all(
            [
                community.boundary_id,
                ConcernCategory.objects.filter(community=community, is_active=True).exists(),
                EmergencyCategory.objects.filter(community=community, is_active=True).exists(),
                EmergencyTypeRoleMap.objects.filter(community=community, is_active=True).exists(),
                Designation.objects.filter(
                    department__community=community,
                    position__code="barangay-captain",
                    is_active=True,
                ).exists(),
            ]
        )
        if not ready:
            raise CommandError("Readiness checks failed; Concepcion Dos remains draft.")
        community.status = Community.Status.ACTIVE
        community.save(update_fields=["status", "updated_at"])
