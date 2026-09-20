from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("notifications", "0022_nativepushdevice")]

    operations = [
        migrations.AlterField(
            model_name="nativepushdevice",
            name="token",
            field=models.CharField(max_length=512),
        ),
        migrations.AddConstraint(
            model_name="nativepushdevice",
            constraint=models.UniqueConstraint(
                fields=("user", "token"),
                name="notification_user_token_unique",
            ),
        ),
    ]
