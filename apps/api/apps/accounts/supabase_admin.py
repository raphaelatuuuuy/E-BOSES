import uuid

import httpx
from django.conf import settings


class SupabaseProvisioningError(Exception):
    pass


def _admin_headers():
    key = settings.SUPABASE_SECRET_KEY
    return {"Authorization": f"Bearer {key}", "apikey": key, "Content-Type": "application/json"}


def _existing_password_session(email, password):
    response = httpx.post(
        f"{settings.SUPABASE_URL}/auth/v1/token?grant_type=password",
        json={"email": email, "password": password},
        headers={"apikey": settings.SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json"},
        timeout=20,
    )
    if response.status_code >= 400:
        return None
    return (response.json().get("user") or {}).get("id")


def provision_supabase_user(user, password):
    if not (settings.SUPABASE_URL and settings.SUPABASE_SECRET_KEY and settings.SUPABASE_PUBLISHABLE_KEY):
        raise SupabaseProvisioningError("Supabase Auth is not fully configured.")
    payload = {
        "email": user.email,
        "password": password,
        "email_confirm": bool(user.email_verified_at),
        "phone_confirm": bool(user.phone_verified_at),
        "app_metadata": {"app_role": user.role},
    }
    if user.phone_number:
        payload["phone"] = user.phone_number
    try:
        response = httpx.post(
            f"{settings.SUPABASE_URL}/auth/v1/admin/users",
            json=payload,
            headers=_admin_headers(),
            timeout=20,
        )
    except httpx.HTTPError as exc:
        raise SupabaseProvisioningError("Supabase Auth is unavailable.") from exc

    if response.status_code < 400:
        subject = response.json().get("id")
    elif response.status_code in {400, 422}:
        subject = _existing_password_session(user.email, password)
    else:
        subject = None
    try:
        user.supabase_user_id = uuid.UUID(subject)
    except (TypeError, ValueError) as exc:
        raise SupabaseProvisioningError("Supabase could not create the Auth user.") from exc
    user.save(update_fields=["supabase_user_id", "updated_at"])
    return user.supabase_user_id
