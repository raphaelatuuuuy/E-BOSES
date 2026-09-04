"""Disabled reporter accounts used to satisfy Concern's reporter FK."""

from django.contrib.auth import get_user_model


def get_anonymous_intake_user(community):
    User = get_user_model()
    email = f"guest+{community.pk}@eboses.invalid"
    user, created = User.objects.get_or_create(
        email=email,
        defaults={
            "phone_number": f"g-{community.pk}",
            "role": User.Role.RESIDENT,
            "status": User.Status.VERIFIED,
            "is_active": False,
            "is_onboarded": True,
        },
    )
    updates = []
    if user.is_active:
        user.is_active = False
        updates.append("is_active")
    if user.status != User.Status.VERIFIED:
        user.status = User.Status.VERIFIED
        updates.append("status")
    if user.role != User.Role.RESIDENT:
        user.role = User.Role.RESIDENT
        updates.append("role")
    if user.has_usable_password():
        user.set_unusable_password()
        updates.append("password")
    if created:
        if "updated_at" not in updates:
            updates.append("updated_at")
        user.save(update_fields=updates)
        return user
    if updates:
        updates.append("updated_at")
        user.save(update_fields=updates)
    return user


def is_anonymous_intake(user):
    email = str(getattr(user, "email", "") or "").casefold()
    return email.startswith("guest+") and email.endswith("@eboses.invalid")
