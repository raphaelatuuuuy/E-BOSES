from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("accounts", "0045_disable_seeded_dev_accounts")]

    operations = [
        migrations.AddField(
            model_name="user",
            name="supabase_user_id",
            field=models.UUIDField(blank=True, null=True, unique=True),
        ),
    ]
