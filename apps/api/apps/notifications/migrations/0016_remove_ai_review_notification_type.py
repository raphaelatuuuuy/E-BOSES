from django.db import migrations, models


def archive_ai_review_notifications(apps, schema_editor):
    Notification = apps.get_model("notifications", "Notification")
    Notification.objects.filter(type="concern_ai_flagged").update(
        type="submitted",
        title="Archived automated validation notice",
        is_archived=True,
    )


class Migration(migrations.Migration):
    dependencies = [("notifications", "0015_add_concern_ai_flagged_type")]

    operations = [
        migrations.RunPython(archive_ai_review_notifications, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="notification",
            name="type",
            field=models.CharField(
                choices=[
                    ("submitted", "Submitted"),
                    ("under_review", "Under Review"),
                    ("assigned", "Assigned"),
                    ("in_progress", "In Progress"),
                    ("resolved", "Resolved"),
                    ("rejected", "Rejected"),
                    ("announcement", "Announcement"),
                    ("clarification_requested", "Clarification Requested"),
                    ("clarification_replied", "Clarification Replied"),
                    ("appeal_submitted", "Appeal Submitted"),
                    ("appeal_approved", "Appeal Approved"),
                    ("appeal_denied", "Appeal Denied"),
                    ("concern_comment", "Concern Comment"),
                    ("concern_mention", "Concern Mention"),
                    ("chat_message", "Chat Message"),
                    ("emergency_submitted", "Emergency Submitted"),
                    ("emergency_routed", "Emergency Routed"),
                    ("emergency_acknowledged", "Emergency Acknowledged"),
                    ("emergency_en_route", "Emergency En Route"),
                    ("emergency_nearby", "Emergency Nearby"),
                    ("emergency_arrived", "Emergency Arrived"),
                    ("emergency_resolved", "Emergency Resolved"),
                    ("emergency_cancelled", "Emergency Cancelled"),
                    ("emergency_escalated", "Emergency Escalated"),
                    ("emergency_appeal_submitted", "Emergency Appeal Submitted"),
                    ("emergency_appeal_approved", "Emergency Appeal Approved"),
                    ("emergency_appeal_denied", "Emergency Appeal Denied"),
                    ("witness_alert", "Witness Alert"),
                ],
                max_length=32,
            ),
        )
    ]
