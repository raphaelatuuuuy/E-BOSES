from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("notifications", "0007_notification_in_progress")]

    operations = [
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
        ),
    ]
