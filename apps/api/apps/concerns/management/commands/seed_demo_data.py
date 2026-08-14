import random
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.concerns import merge_services
from apps.concerns.models import (
    Concern,
    ConcernAiAssessment,
    ConcernAssignment,
    ConcernCategory,
    ConcernChatMessage,
    ConcernComment,
    ConcernMedia,
    ConcernStatusEvent,
    ConcernTimelineEntry,
    ConcernVote,
    Department,
)
from apps.demo_scenarios import CONCERNS, PHOTOS
from apps.demo_seed import (
    streets,
    streets_by_zone,
    NoPhotoAvailable,
    backdate,
    ensure_tracking_number,
    image_hashes,
    jitter_point,
    photo_by_title,
)

RESIDENTS = [
    ("Maria", "Santos", "female"),
    ("Jose", "Reyes", "male"),
    ("Andrea", "Cruz", "female"),
    ("Miguel", "Bautista", "male"),
    ("Sofia", "Del Rosario", "female"),
    ("Rafael", "Mendoza", "male"),
    ("Camille", "Villanueva", "female"),
    ("Paolo", "Aquino", "male"),
]

# Units the barangay actually has configured, matched to the responder role.
RESPONDERS = [
    ("Ramon", "Dela Cruz", "tanod"),
    ("Liza", "Gutierrez", "bhw"),
    ("Ferdinand", "Ocampo", "bdrrmo"),
]

OFFICIALS = [("Elena", "Marquez"), ("Teodoro", "Lim")]

COMMENTS = [
    "Ganito rin po sa amin sa kabilang kanto.",
    "Salamat po sa pag-report, matagal na po ito.",
    "Lumala po talaga pagkatapos ng ulan kagabi.",
    "May update na po ba dito?",
    "Nakita ko po kanina, may pumunta na pong barangay.",
]


class Command(BaseCommand):
    help = "Seed a demo dataset grounded in real barangay concerns and the configured categories."

    def add_arguments(self, parser):
        parser.add_argument("--keep-existing", action="store_true", help="Add without clearing.")
        parser.add_argument("--no-images", action="store_true", help="Skip photo downloads.")
        parser.add_argument("--password", default="Demo!Pass123")
        parser.add_argument(
            "--skip-ai",
            action="store_true",
            help="Do not run the real classification pipeline over the seeded reports.",
        )

    def make_user(self, email, phone, role, first, last, gender="", password="Demo!Pass123", unit=""):
        from apps.accounts.models import ResidentProfile

        User = get_user_model()
        user = User.objects.filter(email=email).first() or User.objects.filter(phone_number=phone).first()
        if user is None:
            user = User.objects.create_user(
                email=email, phone_number=phone, password=password,
                role=role, status=User.Status.VERIFIED,
            )
        else:
            user.email = email
            user.phone_number = phone
            user.set_password(password)
        user.role = role
        user.status = User.Status.VERIFIED
        user.is_onboarded = True
        user.email_verified_at = user.email_verified_at or timezone.now()
        user.phone_verified_at = user.phone_verified_at or timezone.now()
        if role == User.Role.FIRST_RESPONDER:
            user.responder_unit = unit
            user.is_on_duty = True
            user.last_seen_at = timezone.now()
        if role == User.Role.BARANGAY_OFFICIAL:
            user.is_staff = True
        user.save()

        ResidentProfile.objects.update_or_create(
            user=user,
            defaults={
                "first_name": first, "last_name": last,
                "date_of_birth": date(1985, 1, 1),
                "address": f"{random.randint(1, 200)} {random.choice(streets())}",
                "gender": gender, "profile_completed_at": timezone.now(),
            },
        )
        return user

    def resolve_category(self, name):
        """Match a configured category by name; skip the scenario if absent."""
        return ConcernCategory.objects.filter(name__iexact=name, is_active=True).first()

    def attach_photo(self, concern, key, options):
        if not key or options["no_images"]:
            return False
        spec = PHOTOS.get(key)
        if not spec:
            return False
        try:
            image = photo_by_title(spec["title"])
        except (NoPhotoAvailable, Exception) as exc:
            self.stdout.write(self.style.WARNING(f"    no photo for {key}: {type(exc).__name__}"))
            return False
        sha, phash, blocks = image_hashes(image)
        media = ConcernMedia.objects.create(
            concern=concern, original_filename=image.name, mime_type="image/jpeg",
            file_size=image.size, sha256_hash=sha, phash=phash, phash_blocks=blocks,
            privacy_state=(
                ConcernMedia.PrivacyState.QUEUED
                if spec.get("blur")
                else ConcernMedia.PrivacyState.NOT_REQUIRED
            ),
            privacy_requested_classes=["face", "license plate"] if spec.get("blur") else [],
            public_visible=not spec.get("blur"),
        )
        media.file.save(f"report-{concern.pk}.jpg", image, save=True)
        return True

    def seed_chat(self, concern, script, reporter, official, when):
        for index, (who, body) in enumerate(script):
            sender = reporter if who == "reporter" else official
            message = ConcernChatMessage.objects.create(
                concern=concern, sender=sender, body=body
            )
            backdate(message, "created_at", when + timedelta(hours=index * 5 + 2))

    def run_privacy_pipeline(self):
        """Blur any image the pipeline flagged, so nothing stays hidden as QUEUED.

        Without a Celery worker the scan is enqueued and never runs, which leaves
        the photo invisible on the feed — the same symptom as a broken image.
        """
        from apps.concerns.models import ConcernMedia
        from apps.concerns.tasks import process_concern_media_privacy_task

        pending = list(
            ConcernMedia.objects.filter(
                privacy_state__in=[
                    ConcernMedia.PrivacyState.QUEUED,
                    ConcernMedia.PrivacyState.PROCESSING,
                ]
            ).values_list("pk", flat=True)
        )
        if not pending:
            return

        self.stdout.write(f"  running the privacy blur over {len(pending)} photo(s)...")
        done = failed = 0
        for media_id in pending:
            try:
                process_concern_media_privacy_task.run(media_id)
                done += 1
            except Exception as exc:
                failed += 1
                self.stdout.write(self.style.WARNING(f"    media {media_id}: {type(exc).__name__}"))

        results = ConcernMedia.objects.filter(pk__in=pending)
        protected = results.filter(privacy_state=ConcernMedia.PrivacyState.PROTECTED).count()
        self.stdout.write(
            self.style.SUCCESS(f"  privacy pass done: {protected} protected, {failed} failed")
        )
        for media in results:
            self.stdout.write(
                f"    {media.concern.tracking_id} state={media.privacy_state} "
                f"visible={media.public_visible} detected={media.privacy_detected_classes}"
            )

    def run_real_ai(self, concern_ids):
        from apps.concerns.tasks import process_concern_ai_task

        self.stdout.write(f"  running the real AI review over {len(concern_ids)} report(s)...")
        done = failed = 0
        for concern_id in concern_ids:
            try:
                process_concern_ai_task.run(concern_id)
                done += 1
            except Exception as exc:
                failed += 1
                self.stdout.write(self.style.WARNING(f"    concern {concern_id}: {type(exc).__name__}"))
        self.stdout.write(self.style.SUCCESS(f"  AI review completed for {done} report(s)"))
        if failed:
            self.stdout.write(self.style.WARNING(f"  {failed} could not be reviewed"))

    def handle(self, *args, **options):
        rng = random.Random("demo-data")
        street_names = streets()
        zones = streets_by_zone()
        User = get_user_model()
        self.stdout.write(
            f"  acceptance zone: {zones['zone']['radius_m']}m, "
            f"out-of-zone action '{zones['zone']['out_of_zone_action']}' "
            f"({len(zones['inside'])} streets inside, {len(zones['outside'])} outside)"
        )
        password = options["password"]

        residents = [
            self.make_user(f"resident{i + 1}@eboses.demo", f"+63917000{i + 1:04d}",
                           User.Role.RESIDENT, first, last, gender, password)
            for i, (first, last, gender) in enumerate(RESIDENTS)
        ]
        responders = [
            self.make_user(f"responder{i + 1}@eboses.demo", f"+63918000{i + 1:04d}",
                           User.Role.FIRST_RESPONDER, first, last, "", password, unit)
            for i, (first, last, unit) in enumerate(RESPONDERS)
        ]
        officials = [
            self.make_user(f"official{i + 1}@eboses.demo", f"+63919000{i + 1:04d}",
                           User.Role.BARANGAY_OFFICIAL, first, last, "", password)
            for i, (first, last) in enumerate(OFFICIALS)
        ]
        self.stdout.write(
            f"  {len(residents)} residents, {len(responders)} responders, {len(officials)} officials"
        )

        if not options["keep_existing"]:
            removed = Concern.objects.all().delete()[0]
            self.stdout.write(f"  cleared {removed} rows across the concern graph")

        official = officials[0]
        seeded_ids = []
        photographed = 0
        skipped = []
        groups = {}

        for index, spec in enumerate(CONCERNS):
            category = self.resolve_category(spec["category"])
            if category is None:
                skipped.append(spec["title"])
                continue

            when = timezone.now() - timedelta(days=spec["days_ago"], hours=rng.randint(0, 10))
            pool = zones["outside"] if spec.get("outside_zone") else zones["inside"]
            if not pool:
                pool = zones["inside"] or zones["outside"]
            # The street the report itself names, so the title, the address and
            # the pin all agree. Falls back to the zone pool when unnamed.
            street = None
            if spec.get("street"):
                street = next((s for s in pool if s["name"] == spec["street"]), None)
                if street is None:
                    street = next(
                        (s for s in zones["inside"] + zones["outside"] if s["name"] == spec["street"]),
                        None,
                    )
            if street is None:
                street = pool[index % len(pool)]
            # Group members sit a few metres apart on the same stretch, which is
            # exactly what the duplicate scan is built to notice.
            spread = 0.0002 if spec.get("group") else 0.0
            latitude = round(street["latitude"] + rng.uniform(-spread, spread), 7)
            longitude = round(street["longitude"] + rng.uniform(-spread, spread), 7)
            street_label = street["name"]
            reporter = residents[index % len(residents)]

            concern = Concern.objects.create(
                reporter=reporter,
                title=spec["title"],
                description=spec["description"],
                category=category.code,
                category_ref=category,
                assigned_department=category.department,
                status=spec["status"],
                validation_status=Concern.ValidationStatus.ACCEPTED,
                visibility=Concern.Visibility.COMMUNITY,
                address=f"{rng.randint(1, 200)} {street_label}",
                latitude=latitude,
                longitude=longitude,
                location_source="map",
                summary=spec["description"][:280],
                report_location_bucket=spec.get("group") or "",
                report_text_fingerprint=spec.get("group") or "",
            )
            backdate(concern, "created_at", when)
            ensure_tracking_number(concern)

            ConcernAiAssessment.objects.create(
                concern=concern, status=ConcernAiAssessment.Status.PENDING
            )
            ConcernTimelineEntry.objects.create(
                concern=concern,
                event_type=ConcernTimelineEntry.EventType.SUBMITTED,
                status=Concern.Status.SUBMITTED,
                actor=reporter,
                message="Report submitted.",
            )
            ConcernStatusEvent.objects.create(concern=concern, status=spec["status"])

            if category.department and spec["status"] in {"assigned", "in_progress", "resolved"}:
                ConcernAssignment.objects.create(
                    concern=concern,
                    department=category.department,
                    assigned_by=official,
                    office=category.department.name,
                    status=ConcernAssignment.Status.ACTIVE,
                )

            if self.attach_photo(concern, spec.get("photo"), options):
                photographed += 1

            if spec.get("chat"):
                self.seed_chat(concern, spec["chat"], reporter, official, when)

            for voter in rng.sample(residents, rng.randint(1, 5)):
                ConcernVote.objects.get_or_create(concern=concern, user=voter, defaults={"value": 1})

            for body in rng.sample(COMMENTS, rng.randint(0, 3)):
                comment = ConcernComment.objects.create(
                    concern=concern, author=rng.choice(residents), body=body
                )
                backdate(comment, "created_at", when + timedelta(hours=rng.randint(1, 20)))

            if spec.get("group"):
                groups.setdefault(spec["group"], []).append((concern, bool(spec.get("primary"))))

            seeded_ids.append(concern.pk)

        self.stdout.write(
            self.style.SUCCESS(f"  {len(seeded_ids)} concerns seeded, {photographed} with real photos")
        )
        if skipped:
            self.stdout.write(
                self.style.WARNING(f"  {len(skipped)} skipped (category not configured)")
            )

        self.demonstrate_merge(groups, official)

        if options["skip_ai"]:
            self.stdout.write("  AI review skipped (--skip-ai)")
        else:
            self.run_real_ai(seeded_ids)
            self.run_privacy_pipeline()

        call_command("seed_announcements", no_images=options["no_images"])
        call_command("seed_emergency_lifecycle")

        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING("Demo accounts (all share one password)"))
        self.stdout.write(f"  resident1@eboses.demo   / {password}")
        self.stdout.write(f"  responder1@eboses.demo  / {password}")
        self.stdout.write(f"  official1@eboses.demo   / {password}")

    def demonstrate_merge(self, groups, official):
        """Three neighbours, one blocked canal: suggest, merge, resolve."""
        for name, members in groups.items():
            if len(members) < 2:
                continue
            primary = next((c for c, is_primary in members if is_primary), members[0][0])
            duplicates = [c for c, _ in members if c.pk != primary.pk]

            merge_services.build_merge_suggestions()

            merged = 0
            for duplicate in duplicates:
                try:
                    merge_services.merge_concern(
                        duplicate, primary, actor=official,
                        reason="Parehong barado sa Champaca Street, magkalapit na address.",
                        confidence=0.93, method="official",
                    )
                    merged += 1
                except merge_services.MergeConflict:
                    continue

            call_command("rebuild_community_incidents", verbosity=0)
            self.stdout.write(
                self.style.SUCCESS(
                    f"  merge demo '{name}': {merged} duplicate(s) merged into {primary.tracking_id}"
                )
            )
