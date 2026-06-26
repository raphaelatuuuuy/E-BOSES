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
