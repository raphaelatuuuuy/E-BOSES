from django.conf import settings


GREETING = (
    "Hello. I am the E-Boses Assistant. You may ask a question about the app "
    "or choose a topic below."
)

CREATE_ACCOUNT = "create-account"
REPORT_CONCERN = "report-concern"
HOW_IT_WORKS = "how-it-works"
LOGIN_PROBLEM = "login-problem"
CONTACT_SUPPORT = "contact-support"
EMERGENCY_HELP = "emergency-help"
TRACK_REPORT = "track-report"
VERIFICATION_STATUS = "verification-status"
PRIVACY_DATA = "privacy-data"

CHIPS = {
    CREATE_ACCOUNT: {
        "id": CREATE_ACCOUNT,
        "label": "How do I create an account?",
        "icon": "user-plus",
    },
    REPORT_CONCERN: {
        "id": REPORT_CONCERN,
        "label": "How do I report a concern?",
        "icon": "megaphone",
    },
    HOW_IT_WORKS: {
        "id": HOW_IT_WORKS,
        "label": "How does the app work?",
        "icon": "info",
    },
    LOGIN_PROBLEM: {
        "id": LOGIN_PROBLEM,
        "label": "I have login problems",
        "icon": "lock",
    },
    CONTACT_SUPPORT: {
        "id": CONTACT_SUPPORT,
        "label": "Contact Support",
        "icon": "headset",
    },
    EMERGENCY_HELP: {
        "id": EMERGENCY_HELP,
        "label": "How do I send an emergency alert?",
        "icon": "siren",
    },
    TRACK_REPORT: {
        "id": TRACK_REPORT,
        "label": "How do I track my report?",
        "icon": "list-checks",
    },
    VERIFICATION_STATUS: {
        "id": VERIFICATION_STATUS,
        "label": "Why is my account still being verified?",
        "icon": "badge-check",
    },
    PRIVACY_DATA: {
        "id": PRIVACY_DATA,
        "label": "What happens to my data?",
        "icon": "shield",
    },
}

OPENING_TOPICS = [
    CREATE_ACCOUNT,
    REPORT_CONCERN,
    HOW_IT_WORKS,
    LOGIN_PROBLEM,
    CONTACT_SUPPORT,
]


def support_email():
    return getattr(settings, "SUPPORT_EMAIL", "") or "the barangay office"


ANSWERS = {
    CREATE_ACCOUNT: {
        "reply": (
            "Creating an E-Boses account takes about five minutes. Prepare a valid ID "
            "or another accepted proof that you live in the barangay.\n"
            "\n"
            "1. Open the sign-up page and enter your name, email address and mobile number.\n"
            "2. Enter the six-digit code sent to your email, then the code sent to your phone.\n"
            "3. Upload a clear photo of your barangay ID or proof of residence.\n"
            "4. Wait for the automatic check to read your document. It usually finishes in under a minute.\n"
            "\n"
            "Your account is ready once the check passes. If the photo is unclear, a barangay "
            "officer reviews it instead and you will be notified of the result."
        ),
        "suggestions": [VERIFICATION_STATUS, REPORT_CONCERN, PRIVACY_DATA],
    },
    REPORT_CONCERN: {
        "reply": (
            "You can file a concern once your account is verified.\n"
            "\n"
            "1. Open Reports and choose to create a new report.\n"
            "2. Pick the category that fits best, such as infrastructure, environment or public safety.\n"
            "3. Describe what happened and pin the location on the map.\n"
            "4. Attach photos if you have them. Faces and plate numbers are blurred automatically "
            "before anything is shown publicly.\n"
            "5. Submit the report and keep the tracking number you receive.\n"
            "\n"
            "For anything happening right now that puts someone in danger, send an emergency "
            "alert instead of a concern."
        ),
        "suggestions": [TRACK_REPORT, EMERGENCY_HELP, PRIVACY_DATA],
    },
    HOW_IT_WORKS: {
        "reply": (
            "E-Boses puts residents and barangay officials in one place.\n"
            "\n"
            "- Report non-urgent concerns and follow them until they are resolved.\n"
            "- Send an emergency alert that reaches on-duty responders straight away.\n"
            "- Read announcements and barangay events.\n"
            "- See community reports from your neighbours.\n"
            "\n"
            "Officials route each report to the right department. Responders receive emergency "
            "dispatches with the location and the route to it."
        ),
        "suggestions": [REPORT_CONCERN, EMERGENCY_HELP, CREATE_ACCOUNT],
    },
    LOGIN_PROBLEM: {
        "reply": (
            "Let us get you back in.\n"
            "\n"
            "1. Check that you are using the email address or mobile number you registered with.\n"
            "2. If you forgot your password, choose the reset option on the sign-in page and "
            "follow the link sent to your email.\n"
            "3. If your account is still being verified, you can still sign in, but some parts "
            "stay locked until the check finishes.\n"
            "4. If you deactivated your account before, signing in reactivates it.\n"
            "\n"
            "If none of these work, contact the barangay office so staff can check your record."
        ),
        "suggestions": [VERIFICATION_STATUS, CONTACT_SUPPORT],
    },
    CONTACT_SUPPORT: {
        "reply": (
            "You can reach the barangay in several ways.\n"
            "\n"
            "- Visit the barangay office during office hours for anything needing a signature "
            "or an original document.\n"
            f"- Email {support_email()} for account and app questions.\n"
            "- Call 161 for local rescue services, or 911.\n"
            "\n"
            "If an emergency is happening right now, do not wait for a reply here. Use the "
            "emergency button in the app or call 161."
        ),
        "suggestions": [EMERGENCY_HELP, LOGIN_PROBLEM],
    },
    EMERGENCY_HELP: {
        "reply": (
            "Use the emergency button for anything that needs help right now.\n"
            "\n"
            "1. Press and hold the emergency button on your home screen.\n"
            "2. Choose the type of emergency, such as medical, fire or crime.\n"
            "3. Confirm your location. The app uses your GPS, and you can correct the pin.\n"
            "4. Send. On-duty responders are alerted immediately.\n"
            "\n"
            "You can also text the barangay emergency number if you have no mobile data. "
            "Send HELP followed by the type and the place, for example: HELP FIRE Main Street."
        ),
        "suggestions": [TRACK_REPORT, CONTACT_SUPPORT],
    },
    TRACK_REPORT: {
        "reply": (
            "Every concern you file gets a tracking number that looks like RPT-2026-000123.\n"
            "\n"
            "1. Open Reports and select the report you want to check.\n"
            "2. The timeline shows each step, from submitted through assigned to resolved.\n"
            "3. If an official needs more information, a clarification request appears there "
            "and you can reply in the same place.\n"
            "\n"
            "If you disagree with how a report was closed, you can file an appeal from the "
            "same screen."
        ),
        "suggestions": [REPORT_CONCERN, CONTACT_SUPPORT],
    },
    VERIFICATION_STATUS: {
        "reply": (
            "Most accounts are checked automatically within a minute of sign-up.\n"
            "\n"
            "A check takes longer when the photo is blurred or cropped, when the details on "
            "the document do not match what you typed, or when the document type cannot be "
            "recognised. In those cases a barangay officer reviews it by hand.\n"
            "\n"
            "You can sign in while this is happening. Reporting and emergency features unlock "
            "once your account is verified."
        ),
        "suggestions": [CREATE_ACCOUNT, CONTACT_SUPPORT],
    },
    PRIVACY_DATA: {
        "reply": (
            "Your information stays with the barangay and is not sold or shared with "
            "advertisers.\n"
            "\n"
            "- Photos you attach to a public report are scanned and faces and plate numbers "
            "are blurred before anyone else sees them.\n"
            "- Your ID photo is private. Only authorised barangay staff can open it, and every "
            "time one does, it is recorded.\n"
            "- You can ask for a copy of your data or ask for your account to be removed from "
            "the privacy section of your settings.\n"
            "\n"
            "Ask the barangay office if you want the full details of what is kept and for how long."
        ),
        "suggestions": [CONTACT_SUPPORT, CREATE_ACCOUNT],
    },
}

KEYWORDS = (
    (EMERGENCY_HELP, ("emergency", "sos", "fire", "sunog", "accident", "ambulance", "rescue", "tulong")),
    (CREATE_ACCOUNT, ("sign up", "signup", "register", "create account", "new account", "magparehistro")),
    (LOGIN_PROBLEM, ("login", "log in", "sign in", "password", "forgot", "locked out", "cannot enter")),
    (VERIFICATION_STATUS, ("verify", "verification", "verified", "pending", "still checking", "approval")),
    (TRACK_REPORT, ("track", "status of my report", "tracking number", "follow up", "reference")),
    (REPORT_CONCERN, ("report", "complaint", "concern", "reklamo", "pothole", "garbage", "basura")),
    (PRIVACY_DATA, ("privacy", "data", "delete my account", "personal information", "export")),
    (CONTACT_SUPPORT, ("contact", "support", "hotline", "office hours", "talk to someone")),
    (HOW_IT_WORKS, ("how does", "what is e-boses", "what is eboses", "what can", "features")),
)


def chips_for(topic_ids):
    return [CHIPS[topic_id] for topic_id in topic_ids if topic_id in CHIPS]


def opening_topics():
    return chips_for(OPENING_TOPICS)


def answer_for_topic(topic_id):
    entry = ANSWERS.get(topic_id)
    if entry is None:
        return None
    return entry["reply"], chips_for(entry["suggestions"])


def match_keywords(message):
    lowered = (message or "").strip().lower()
    if not lowered:
        return None
    for topic_id, needles in KEYWORDS:
        for needle in needles:
            if needle in lowered:
                return topic_id
    return None


def knowledge_digest():
    return "\n\n".join(
        f"[{topic_id}]\n{entry['reply']}" for topic_id, entry in ANSWERS.items()
    )
