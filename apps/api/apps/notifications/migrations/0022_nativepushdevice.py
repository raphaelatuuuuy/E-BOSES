from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion

class Migration(migrations.Migration):
    dependencies = [("notifications", "0021_alter_notification_type"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [migrations.CreateModel(name="NativePushDevice", fields=[
        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
        ("token", models.CharField(max_length=512, unique=True)),
        ("platform", models.CharField(default="android", max_length=16)),
        ("is_active", models.BooleanField(default=True)),
        ("created_at", models.DateTimeField(auto_now_add=True)),
        ("updated_at", models.DateTimeField(auto_now=True)),
        ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="native_push_devices", to=settings.AUTH_USER_MODEL)),
    ], options={"indexes": [models.Index(fields=["user", "is_active"], name="notificatio_user_id_native_idx")]})]
