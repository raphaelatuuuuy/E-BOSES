from __future__ import annotations


def _name(responder):
    profile = getattr(responder, "resident_profile", None)
    if profile:
        return f"{profile.first_name} {profile.last_name}".strip()
    return responder.email.split("@")[0]


def preview_dispatch(alert):
    from apps.live_map import route_preview_for_responder

    from .views import find_auto_responders_by_unit, preferred_departments_for, role_map_for_responder

    preferred = preferred_departments_for(alert.type, alert.community) if alert.community else []
    department = preferred[0] if preferred else None
    responders = find_auto_responders_by_unit(alert) if alert.community else []
    responder = responders[0] if responders else None
    role_map = role_map_for_responder(alert, responder) if responder else None
    selected_department = role_map.department if role_map else department
    responding_community = role_map.community if role_map else None
    scope = (
        "cross_community"
        if responding_community and alert.community_id and responding_community.pk != alert.community_id
        else "local"
        if responding_community
        else "manual_dispatch"
    )
    route = {
        "status": "no_destination" if alert.latitude is None or alert.longitude is None else "unavailable",
        "profile": "car",
        "distance_meters": None,
        "eta_seconds": None,
        "geometry": None,
        "summary": "",
    }
    if responder and alert.latitude is not None and alert.longitude is not None:
        route.update(route_preview_for_responder(responder, latitude=alert.latitude, longitude=alert.longitude) or {})
    label = str(getattr(getattr(alert, "category_ref", None), "label", "") or alert.type or "emergency")
    label = label.replace("_", " ").strip().lower()
    if responder is None:
        message = "No responder is ready. The emergency stays active and goes to manual dispatch."
    elif route.get("status") == "ok":
        message = f"A {label} responder is ready."
    else:
        message = f"A {label} responder is ready, but live route data is not available yet."
    return {
        "scope": scope,
        "manual_dispatch": responder is None or alert.community is None,
        "department": (
            {"id": selected_department.pk, "name": selected_department.name, "short_name": selected_department.short_name}
            if selected_department
            else None
        ),
        "responding_community": (
            {"id": responding_community.pk, "name": responding_community.name} if responding_community else None
        ),
        "responder": (
            {
                "id": responder.pk,
                "full_name": _name(responder),
                "unit_name": selected_department.short_name or selected_department.name if selected_department else "Responder",
                "latitude": float(responder.current_latitude) if responder.current_latitude is not None else None,
                "longitude": float(responder.current_longitude) if responder.current_longitude is not None else None,
            }
            if responder
            else None
        ),
        "route": route,
        "message": message,
    }
