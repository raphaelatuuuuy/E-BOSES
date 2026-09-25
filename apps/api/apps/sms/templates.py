from apps.emergencies.description import description_for_display


def reference(alert):
    return f"E-{getattr(alert, 'pk', alert)}"


def resident_greeting(alert):
    profile = getattr(getattr(alert, "reporter", None), "resident_profile", None)
    name = getattr(profile, "first_name", "") or ""
    return f"Good day, {name}!" if name else "Good day!"


def unit_label(alert):
    if not getattr(alert, "pk", None):
        return "the response unit"
    assignment = alert.assignments.select_related("role_map__department").order_by("-assigned_at", "-id").first()
    department = getattr(getattr(assignment, "role_map", None), "department", None)
    return getattr(department, "name", "") or "the response unit"


def category_name(alert):
    return (getattr(alert, "type", "") or "other").replace("_", " ").lower()


def emergency_ack(alert, *, unit_name=""):
    return f"{resident_greeting(alert)} Your {category_name(alert)} emergency was received. Responders have been notified."


def pending_response(alert):
    return f"{resident_greeting(alert)} Your emergency was received. We are still arranging a response unit."


def ongoing_emergency():
    """Tell a resident that a second SOS will not create or move an alert."""
    return "You already have an ongoing SOS emergency."


def resident_progress(alert, status, *, unit_name=""):
    bodies = {
        "en_route": "Responders are on the way. Stay safe and keep your phone open.",
        "nearby": "Responders are almost there. Watch for them if safe.",
        "arrived": "Responders have arrived at your location.",
        "resolved": "Your emergency is marked resolved. Thank you, stay safe.",
    }
    body = bodies.get(status)
    return f"{resident_greeting(alert)} {body}" if body else ""


def responder_dispatch(alert, *, recipient_name="", unit_name="", reporter_name="", contact=""):
    greeting = f"Good day, {recipient_name}!" if recipient_name else "Good day!"
    unit = unit_name or unit_label(alert)
    location = next((str(value).strip() for value in (
        getattr(alert, "resolved_location", ""),
        getattr(alert, "reported_area", ""),
        getattr(alert, "address", ""),
    ) if value and "pinned" not in str(value).lower() and "pending" not in str(value).lower()), "")
    if not location:
        lat, lng = getattr(alert, "latitude", None), getattr(alert, "longitude", None)
        location = f"Address unavailable ({lat}, {lng})" if lat is not None and lng is not None else "Location awaiting confirmation"
    return "\n".join([
        f"{greeting} A {category_name(alert)} emergency has been assigned to your unit, {unit}.",
        "",
        f"Resident: {reporter_name or 'Resident'}",
        f"Contact: {contact or 'Unavailable'}",
        f"Location: {location}",
        "",
        description_for_display(alert),
    ])


def otp_message(code, recipient_name=""):
    greeting = f"Good day, {recipient_name.strip()}! " if recipient_name and recipient_name.strip() else "Good day! "
    return f"{greeting}E-Boses registration code: {code}. This code expires in 5 minutes. Do not share it with anyone."


CHAT_REPLY_HINT = "Reply to this number to answer."


def chat_update(alert, body, *, reply_hint=False, include_reference=False):
    """The text a resident gets when a responder answers in the app.

    Plain sentences by default. A resident reading "E-BOSES SOS-2026-000482:"
    before every line of a conversation they are already having is being handed a
    form, not an answer. `include_reference` restores the tracking id for the one
    case where it earns its length - several alerts running at once - and
    `reply_hint` adds the line that tells the resident the thread is two-way.

    Everything here stays ASCII: the bullet character and the en dash are not in
    the GSM-7 alphabet and would flip a short reply into a UCS-2 message billed
    at 67 characters per segment instead of 153.
    """
    text = (body or "").strip() or "New emergency chat attachment"
    if include_reference:
        label = getattr(alert, "tracking_id", "") or reference(alert)
        text = f"E-BOSES {label}: {text}"
    if reply_hint:
        text = f"{text}\n{CHAT_REPLY_HINT}"
    return text
