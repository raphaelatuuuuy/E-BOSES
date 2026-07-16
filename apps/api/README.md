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

# Start the dev server (localhost only)
python manage.py runserver

# LAN access (phones / other devices on the same Wi‑Fi)
python manage.py runserver 0.0.0.0:8000

# In a production deployment, run a separate OCR worker and scheduler.
celery -A config worker -l INFO -Q eboses --concurrency=2
celery -A config beat -l INFO
```

The API starts at `http://localhost:8000`. For phones, use `0.0.0.0:8000` and set root `.env` `VITE_API_BASE_URL` / `FRONTEND_URL` to your PC’s LAN IP (see root README).

## Residence-proof OCR operations

The migration creates a published default policy and an editable draft. Run
`python manage.py migrate` before starting the API or worker. Officials edit
the draft at `/api/auth/ocr/config/draft/` and activate it explicitly through
the publish endpoint. Signup only validates the selected document type and
queues OCR after both OTP channels are complete; it never waits for PaddleOCR.

OCR worker requirements:

- Set `PADDLEOCR_TOKEN` and an HTTPS `PADDLEOCR_JOB_URL`.
- Run the worker on the dedicated `eboses` queue with bounded concurrency;
  PaddleOCR calls are CPU/network heavy and must not share the web process.
- Run Celery Beat so the five-minute health canary and outage-only recovery
  sweep execute. Recovery is capped at 20 cases per sweep and cannot overwrite
  an official decision.
- Use `python manage.py check_production_readiness --strict` before release.
  Missing Paddle credentials, Redis/Celery settings, secure cookies, or a
  public/private media-root overlap are blockers.

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
