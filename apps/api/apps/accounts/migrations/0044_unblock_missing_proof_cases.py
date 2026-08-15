from django.db import migrations


def unblock(apps, schema_editor):
    """Let residents retry when their proof image no longer exists.

    Cases whose file went missing were parked in manual review with
    retry_eligible=False. That is a dead end: no official screen can clear them
    (the verification queue was removed) and the resident cannot upload again.
    Only the resident can supply a photo that is gone, so they get the retry.
    """
    Case = apps.get_model("accounts", "ResidenceVerificationCase")
    Case.objects.filter(status="manual_review", retry_eligible=False).update(
        retry_eligible=True,
        review_reason="resubmission_required",
        decision_reason="The uploaded photo is no longer available. Please upload it again.",
    )


class Migration(migrations.Migration):
    dependencies = [("accounts", "0043_complete_self_service_exports")]

    operations = [migrations.RunPython(unblock, migrations.RunPython.noop)]
