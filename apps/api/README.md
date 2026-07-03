# E-Boses API

Django backend for the E-Boses barangay civic engagement platform.

## Prerequisites

- Python 3.11+
- PostgreSQL 16+ with PostGIS
- Redis 7+ (for WebSocket layer and caching)

## Local Setup

```bash
# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows

# Install dependencies
pip install -r requirements.txt

# Run migrations
python manage.py migrate

# Start the dev server
python manage.py runserver
```

The API starts at `http://localhost:8000`.

## App Structure

```
apps/api/
├── config/               # Django project configuration
│   ├── settings.py       # Base settings (env-driven)
│   ├── urls.py           # Top-level URL routing
│   ├── wsgi.py           # WSGI entry point
│   └── asgi.py           # ASGI entry point (WebSocket support)
├── apps/
│   ├── accounts/         # User registration, auth, profile
│   ├── concerns/         # Community concern reporting
│   ├── emergencies/      # Emergency alerting & response
│   └── notifications/    # Push & in-app notifications
├── templates/            # Email templates, etc.
├── scripts/              # Utility scripts
├── manage.py             # Django CLI entry point
└── requirements.txt      # Python dependencies
```

## Application Responsibilities

- `apps.accounts` owns identity, authentication, OTP/password reset flows, resident verification records, and audit logging.
- `apps.concerns` owns community concern intake, categorization, media evidence, geospatial filtering, and concern status history.
- `apps.emergencies` owns SOS/emergency alert intake, severity/status transitions, responder assignment, and response timelines.
- `apps.notifications` owns in-app notifications, device delivery, WebSocket fan-out, and read/unread state.

## Backend Architecture Conventions

- Keep Django views thin: validate request data, call a service, and serialize the response.
- Put business/domain logic in `services.py` modules; if an app grows, split that file into a `services/` package by workflow.
- Put reusable list/detail query logic in `selectors.py` so viewsets do not accumulate filtering rules.
- Put external integrations behind Protocol-style adapters in `adapters.py` before wiring concrete providers. Current adapter seams cover SMS, email, OCR, YOLO/object detection, NLP classification, private/media storage, maps/routing, push notifications, and WebSocket notifications.
- Avoid direct cross-app model imports from views. Use the owning app's services/selectors instead; `apps.accounts.tests_architecture` codifies the current import-boundary convention.
