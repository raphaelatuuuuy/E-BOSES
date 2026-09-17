from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.emergencies.models import (
    EmergencyAlert,
    EmergencyAssignmentRoute,
    EmergencyResponderAssignment,
)
from apps.live_map import _osrm_route


class Command(BaseCommand):
    help = "Rerun OSRM for a responder assignment from saved GPS and store the road route."

    def add_arguments(self, parser):
        parser.add_argument("--assignment", type=int, default=None)
        parser.add_argument("--alert", type=int, default=None)
        parser.add_argument("--responder", default=None)
        parser.add_argument("--origin", choices=["first", "last"], default="first")
        parser.add_argument("--origin-lat", type=float, default=None)
        parser.add_argument("--origin-lng", type=float, default=None)
        parser.add_argument("--profile", default=None)
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        assignment = self.resolve_assignment(options)
        alert = assignment.alert
        if alert.latitude is None or alert.longitude is None:
            raise CommandError(f"Alert {alert.pk} has no coordinates to route to.")
        origin = self.resolve_origin(
            assignment, options["origin"], options["origin_lat"], options["origin_lng"]
        )
        if origin is None:
            raise CommandError(
                f"Assignment {assignment.pk} has no saved GPS pings or responder position."
            )
        profile = options["profile"] or assignment.travel_profile or "car"
        route = _osrm_route(
            origin_lat=float(origin[0]),
            origin_lng=float(origin[1]),
            dest_lat=float(alert.latitude),
            dest_lng=float(alert.longitude),
            profile=profile,
            cache_key="rerun-assignment-route:%s:%.6f:%.6f:%s"
            % (assignment.pk, float(origin[0]), float(origin[1]), options["origin"]),
            refresh=True,
        )
        if route["status"] != "ok" or not route.get("geometry"):
            raise CommandError(
                "OSRM returned status=%s for assignment %s." % (route["status"], assignment.pk)
            )
        if options["dry_run"]:
            self.stdout.write(
                "Dry run: %s m, %s s, %s."
                % (route.get("distance_meters"), route.get("eta_seconds"), route.get("summary"))
            )
            return
        stored, created = EmergencyAssignmentRoute.objects.get_or_create(
            assignment=assignment
        )
        stored.status = route["status"]
        stored.profile = profile
        stored.distance_meters = route.get("distance_meters")
        stored.eta_seconds = route.get("eta_seconds")
        stored.geometry = route.get("geometry")
        stored.summary = route.get("summary") or ""
        stored.origin_snap = route.get("origin_snap")
        stored.destination_snap = route.get("destination_snap")
        stored.approach = route.get("approach")
        stored.steps = route.get("steps") or []
        stored.error_code = ""
        stored.generated_at = timezone.now()
        if not created:
            stored.route_revision += 1
        stored.save()
        self.stdout.write(
            self.style.SUCCESS(
                "Stored route for assignment %s (%s m, %s s, revision %s)."
                % (
                    assignment.pk,
                    stored.distance_meters,
                    stored.eta_seconds,
                    stored.route_revision,
                )
            )
        )

    def resolve_assignment(self, options):
        if options["assignment"]:
            try:
                return EmergencyResponderAssignment.objects.select_related(
                    "alert", "responder"
                ).get(pk=options["assignment"])
            except EmergencyResponderAssignment.DoesNotExist:
                raise CommandError(
                    "Assignment %s not found." % options["assignment"]
                )
        if not options["alert"]:
            raise CommandError("Pass --assignment or --alert.")
        try:
            alert = EmergencyAlert.objects.get(pk=options["alert"])
        except EmergencyAlert.DoesNotExist:
            raise CommandError("Alert %s not found." % options["alert"])
        candidates = list(
            alert.assignments.select_related("responder").order_by("assigned_at", "id")
        )
        if options["responder"]:
            needle = options["responder"].strip().lower()
            matched = [
                item
                for item in candidates
                if needle
                in " ".join(
                    part
                    for part in [
                        getattr(item.responder, "full_name", "") or "",
                        getattr(item.responder, "first_name", "") or "",
                        getattr(item.responder, "last_name", "") or "",
                    ]
                ).lower()
            ]
            if not matched:
                raise CommandError(
                    "No assignment on alert %s matches responder %r."
                    % (alert.pk, options["responder"])
                )
            candidates = matched
        with_pings = [
            item for item in candidates if item.location_pings.exists()
        ]
        picked = (with_pings or candidates)[:1]
        if not picked:
            raise CommandError("Alert %s has no assignments." % alert.pk)
        return picked[0]

    def resolve_origin(self, assignment, which, lat=None, lng=None):
        if lat is not None and lng is not None:
            return (float(lat), float(lng))
        pings = list(
            assignment.location_pings.order_by("created_at", "id").values_list(
                "latitude", "longitude"
            )
        )
        if pings:
            point = pings[0] if which == "first" else pings[-1]
            return (float(point[0]), float(point[1]))
        responder = assignment.responder
        if (
            responder.current_latitude is not None
            and responder.current_longitude is not None
        ):
            return (
                float(responder.current_latitude),
                float(responder.current_longitude),
            )
        return None
