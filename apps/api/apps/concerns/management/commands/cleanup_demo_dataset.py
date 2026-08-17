import re

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction


class Command(BaseCommand):
    help = "Preview or delete one namespaced fictional demo dataset."

    def add_arguments(self, parser):
        parser.add_argument("--dataset-id", required=True)
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args, **options):
        dataset_id = options["dataset_id"].strip()
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{2,40}", dataset_id):
            raise CommandError("dataset-id must be 3-41 safe characters")

        prefix = f"e2e-{dataset_id.lower()}-"
        users = get_user_model().objects.filter(
            email__startswith=prefix,
            email__endswith="@example.invalid",
        )
        count = users.count()
        self.stdout.write(f"Dataset {dataset_id}: users={count}")
        if not options["apply"]:
            self.stdout.write("Dry run only. Add --apply to delete this exact dataset.")
            return

        with transaction.atomic():
            removed, by_model = users.delete()
        self.stdout.write(self.style.SUCCESS(f"Removed rows={removed}, users={count}"))
        for model, model_count in sorted(by_model.items()):
            self.stdout.write(f"  {model}: {model_count}")
