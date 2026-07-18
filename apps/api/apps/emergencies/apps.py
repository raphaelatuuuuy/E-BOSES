from django.apps import AppConfig


class EmergenciesConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.emergencies"
    label = "emergencies"

    def ready(self):
        # Register MapServicePoi cache bust on admin save/delete
        from . import signals  # noqa: F401
