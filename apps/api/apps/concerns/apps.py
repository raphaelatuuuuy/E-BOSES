from django.apps import AppConfig


class ConcernsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.concerns"
    label = "concerns"

    def ready(self):
        import apps.concerns.signals  # noqa: F401
