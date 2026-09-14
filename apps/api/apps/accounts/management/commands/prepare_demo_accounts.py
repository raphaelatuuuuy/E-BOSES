"""Normalize the local demo account cast without touching production data.

This command is intentionally explicit: it only changes the database when
``--apply`` is supplied.  It is for a local capstone/demo database, not for a
staging or production deployment.
"""

from datetime import date

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone


DEMO_PASSWORD = "Boses123!"
DEMO_DOMAIN = "demo.test"

# These are unambiguous placeholder accounts from the local development
# database.  The command never deletes an account merely because it has no
# report: a verification, assignment, designation, or emergency relationship
# is enough to protect it.
DISPOSABLE_EMAILS = (
    "resident@example.com",
    "demo2@example.com",
    "demo4@example.com",
    "ipintel.test@example.com",
    "guest+1@eboses.invalid",
)

RESIDENT_NAMES = (
    ("Andres", "Bonifacio"),
    ("Rosario", "Katigbak"),
    ("Emilio", "Magsaysay"),
    ("Perlita", "Buenaventura"),
    ("Ernesto", "Villamor"),
    ("Milagros", "Dizon"),
    ("Feliciano", "Tolentino"),
    ("Nenita", "Cabral"),
    ("Ruben", "Escalona"),
    ("Amparo", "Robles"),
    ("Teodoro", "Manalo"),
    ("Herminia", "Sandoval"),
    ("Gregorio", "Panganiban"),
    ("Consuelo", "Rivera"),
    ("Alfredo", "Bernardo"),
    ("Remedios", "Fajardo"),
    ("Jose", "Reyes"),
    ("Andrea", "Cruz"),
    ("Lucila", "Enriquez"),
    ("Bienvenido", "Carreon"),
    ("Erlinda", "Soto"),
    ("Marcelo", "Agustin"),
    ("Purificacion", "Yumul"),
    ("Diosdado", "Lacson"),
    ("Maria", "Santos"),
    ("Miguel", "Bautista"),
    ("Sofia", "Del Rosario"),
    ("Rafael", "Mendoza"),
    ("Camille", "Villanueva"),
    ("Paolo", "Aquino"),
    ("Raphael", "Andrei Latoy"),
    ("Lorna", "Villareal"),
    ("Noel", "Manalo"),
    ("Carmen", "Salonga"),
    ("Victor", "Magtulis"),
    ("Elisa", "Navarro"),
    ("Benjamin", "Yulo"),
)

OFFICIAL_NAMES = (
    ("Ligaya", "Mercado"),
    ("Efren", "Bautista"),
    ("Rodel", "Villanueva"),
    ("Corazon", "Dimasalang"),
    ("Arnel", "Pascual"),
    ("Teresita", "Alcantara"),
    ("Danilo", "Ocampo"),
    ("Elena", "Marquez"),
)

RESPONDER_NAMES_AND_UNITS = (
    ("Ramon", "Dela Cruz", "tanod"),
    ("Maria", "Reyes", "bhw"),
    ("Jose", "Garcia", "bdrrmo"),
    ("Nestor", "Aquino", "tanod"),
    ("Divina", "Lumbera", "bhw"),
    ("Lourdes", "Sarmiento", "bhw"),
    ("Marlon", "Ibanez", "bdrrmo"),
)

STREETS = (
    "Champaca Street",
    "Ipil Street",
    "Narra Street",
    "Dao Street",
    "Apitong Street",
    "Jasmin Street",
    "Katipunan Street",
    "Bayan-Bayanan Avenue",
)


class Command(BaseCommand):
    help = "Normalize local demo accounts to compact aliases and one shared password."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Apply the account changes. Without this flag, print a preview only.",
        )
        parser.add_argument(
            "--delete-unused",
            action="store_true",
            help="Delete only the five explicit disposable placeholder accounts.",
        )
        parser.add_argument(
            "--password",
            default=DEMO_PASSWORD,
            help="Shared local demo password (default: Boses123!).",
        )

    def _disposable_users(self, User):
        return User.objects.filter(email__in=DISPOSABLE_EMAILS).order_by("id")

    def _current_users(self, User, delete_unused):
        queryset = User.objects.order_by("id")
        if delete_unused:
            disposable_ids = set(self._disposable_users(User).values_list("id", flat=True))
            queryset = queryset.exclude(id__in=disposable_ids)
        return list(queryset)

    def _account_rows(self, users):
        residents = [u for u in users if u.role == u.Role.RESIDENT]
        responders = [u for u in users if u.role == u.Role.FIRST_RESPONDER]
        officials = [u for u in users if u.role == u.Role.BARANGAY_OFFICIAL]
        if len(residents) > len(RESIDENT_NAMES):
            raise CommandError("There are more resident accounts than demo names available.")
        if len(responders) > len(RESPONDER_NAMES_AND_UNITS):
            raise CommandError("There are more responder accounts than demo names available.")
        if len(officials) > len(OFFICIAL_NAMES):
            raise CommandError("There are more official accounts than demo names available.")

        rows = []
        for index, user in enumerate(residents, start=1):
            first, last = RESIDENT_NAMES[index - 1]
            rows.append((user, f"r{index}@{DEMO_DOMAIN}", first, last, "", "resident", index))
        for index, user in enumerate(responders, start=1):
            first, last, unit = RESPONDER_NAMES_AND_UNITS[index - 1]
            rows.append((user, f"resp{index}@{DEMO_DOMAIN}", first, last, unit, "responder", index))
        for index, user in enumerate(officials, start=1):
            first, last = OFFICIAL_NAMES[index - 1]
            rows.append((user, f"o{index}@{DEMO_DOMAIN}", first, last, "", "official", index))
        return rows

    def _preview(self, users, rows, delete_unused):
        self.stdout.write(f"Accounts in scope: {len(users)}")
        if delete_unused:
            disposable = list(self._disposable_users(get_user_model()).values_list("email", flat=True))
            self.stdout.write(f"Disposable accounts to remove: {len(disposable)}")
            for email in disposable:
                self.stdout.write(f"  remove {email}")
        self.stdout.write("Planned demo roster:")
        for user, email, first, last, unit, role, index in rows:
            unit_label = f" / {unit}" if unit else ""
            self.stdout.write(f"  {first} {last} | {email} | {role}{unit_label} | source id {user.pk}")

    def _temporary_email(self, user):
        return f"__demo_prepare__{user.pk}@invalid.local"

    @transaction.atomic
    def _apply(self, User, users, rows, delete_unused, password):
        from apps.accounts.models import ResidentProfile, ResidentSettings

        now = timezone.now()
        community = None
        try:
            from apps.emergencies.models import Community

            community = Community.objects.filter(
                name__icontains="Marikina Heights",
                status=Community.Status.ACTIVE,
            ).first()
        except Exception:
            community = None

        if delete_unused:
            disposable = list(self._disposable_users(User))
            deleted = len(disposable)
            self._disposable_users(User).delete()
            self.stdout.write(self.style.WARNING(f"Removed {deleted} disposable placeholder account(s)."))

        # Free every old unique email before assigning the compact aliases.
        for user, *_ in rows:
            user.email = self._temporary_email(user)
            user.save(update_fields=["email"])

        for user, email, first, last, unit, role, index in rows:
            user.email = email
            user.first_name = first
            user.last_name = last
            user.middle_name = ""
            user.set_password(password)
            user.status = User.Status.VERIFIED
            user.is_onboarded = True
            user.email_verified_at = user.email_verified_at or now
            user.phone_verified_at = user.phone_verified_at or now
            user.phone_number = f"+63917{index:08d}" if role == "resident" else f"+63918{index:08d}" if role == "responder" else f"+63919{index:08d}"
            user.responder_unit = unit
            user.is_on_duty = role == "responder"
            user.is_staff = role == "official"
            user.is_superuser = role == "official" and index == 1
            user.gender = ""
            user.save()

            profile, _ = ResidentProfile.objects.get_or_create(
                user=user,
                defaults={
                    "first_name": first,
                    "last_name": last,
                    "date_of_birth": date(1990, 1, 1),
                    "address": f"{index} {STREETS[(index - 1) % len(STREETS)]}, Marikina Heights",
                    "barangay": "Marikina Heights",
                    "community": community,
                    "profile_completed_at": now,
                },
            )
            profile.first_name = first
            profile.last_name = last
            profile.barangay = "Marikina Heights"
            profile.profile_completed_at = profile.profile_completed_at or now
            profile.save(update_fields=["first_name", "last_name", "barangay", "profile_completed_at", "updated_at"])
            ResidentSettings.objects.get_or_create(user=user)

        self.stdout.write(self.style.SUCCESS(f"Normalized {len(rows)} demo account(s)."))
        self.stdout.write(f"Shared password: {password}")

    def handle(self, *args, **options):
        password = options["password"]
        if not password:
            raise CommandError("The demo password cannot be empty.")

        User = get_user_model()
        users = self._current_users(User, options["delete_unused"])
        rows = self._account_rows(users)
        self._preview(users, rows, options["delete_unused"])
        if not options["apply"]:
            self.stdout.write("Preview only. Add --apply to make these changes.")
            return
        self._apply(User, users, rows, options["delete_unused"], password)

