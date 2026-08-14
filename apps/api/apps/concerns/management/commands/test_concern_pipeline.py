import time

from django.core.management.base import BaseCommand

from apps.concerns.models import ConcernClassificationConfiguration


class Command(BaseCommand):
    """Check every stage of the concern pipeline without creating a report.

    Exercises the classifier configuration, the text classifier and the Gemma
    client, reporting which stage is unavailable rather than failing at the
    first problem.
    """

    help = "Smoke-test the concern classification pipeline end to end."

    def add_arguments(self, parser):
        parser.add_argument(
            "--text",
            default="There is a deep pothole on Champaca Street and a tricycle already lost a wheel.",
        )

    def probe(self, label, function):
        started = time.monotonic()
        try:
            detail = function()
        except Exception as exc:
            elapsed = (time.monotonic() - started) * 1000
            self.stdout.write(
                self.style.ERROR(f"  FAIL  {label:28} {elapsed:7.0f}ms  {type(exc).__name__}: {exc}")
            )
            return False
        elapsed = (time.monotonic() - started) * 1000
        self.stdout.write(self.style.SUCCESS(f"  OK    {label:28} {elapsed:7.0f}ms  {detail}"))
        return True

    def handle(self, *args, **options):
        text = options["text"]
        self.stdout.write(self.style.MIGRATE_HEADING("Concern pipeline"))

        results = []

        def configuration():
            config = ConcernClassificationConfiguration.current()
            return f"provider={config.nlp_provider} model={config.nlp_model}"

        def text_classifier():
            from apps.concerns.ai.classification import classification_payload

            result = classification_payload(
                title="Pothole on Champaca Street",
                description=text,
                selected_category="infrastructure",
            )
            return f"outcome={result.get('outcome')} category_match={result.get('category_match')}"

        def gemma():
            from apps.concerns.ai import gemma_analyzer

            return f"model={gemma_analyzer.OLLAMA_TEXT_MODEL}"

        results.append(self.probe("configuration", configuration))
        results.append(self.probe("gemma client import", gemma))
        results.append(self.probe("text classification", text_classifier))

        self.stdout.write("")
        if all(results):
            self.stdout.write(self.style.SUCCESS("  Pipeline is healthy."))
        else:
            self.stdout.write(
                self.style.WARNING("  One or more stages are unavailable (see above).")
            )
