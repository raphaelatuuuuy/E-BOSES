from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("accounts", "0051_user_middle_name_gender")]

    operations = [
        migrations.RemoveField(
            model_name="user",
            name="supabase_user_id",
        ),
    ]
