from django.db import migrations


REMOVED_CAPABILITIES = {"review_verification", "handle_privacy"}


def harden_capabilities(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    Department = apps.get_model("concerns", "Department")
    Designation = apps.get_model("concerns", "Designation")
    Position = apps.get_model("concerns", "Position")

    for position in Position.objects.all():
        permissions = [
            code for code in (position.permissions or [])
            if code not in REMOVED_CAPABILITIES
        ]
        if permissions != position.permissions:
            position.permissions = permissions
            position.save(update_fields=["permissions"])

    Designation.objects.filter(user__role="resident", is_active=True).update(is_active=False)

    department = Department.objects.filter(code="sangguniang-barangay", is_active=True).first()
    captain = Position.objects.filter(code="barangay-captain", is_active=True).first()
    if not department or not captain:
        return

    officials = User.objects.filter(
        role="barangay_official",
        is_active=True,
        status="verified",
    ).exclude(
        designations__is_active=True,
        designations__department__is_active=True,
        designations__position__is_active=True,
    )
    for user in officials.distinct():
        Designation.objects.create(
            user=user,
            department=department,
            position=captain,
            title="Barangay Captain",
        )


class Migration(migrations.Migration):
    dependencies = [("concerns", "0044_position_department")]

    operations = [migrations.RunPython(harden_capabilities, migrations.RunPython.noop)]
