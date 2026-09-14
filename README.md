<div align="center">

# E-BOSES

<p>
  <em>Capstone Project · Polytechnic University of the Philippines · A.Y. 2025–2027</em>
</p>

<p>
  <a href="https://github.com/rplatoy/E-Boses">
    <img src="https://img.shields.io/badge/Status-In%20Development-7C3AED?style=for-the-badge" alt="Project Status" />
  </a>
  <img src="https://img.shields.io/badge/Platform-Web%20%26%20Mobile%20Responsive-2563EB?style=for-the-badge" alt="Platform" />
  <img src="https://img.shields.io/badge/Project-Capstone-F59E0B?style=for-the-badge" alt="Capstone Project" />
  <img src="https://img.shields.io/badge/Monorepo-Turborepo-EF4444?style=for-the-badge" alt="Monorepo" />
</p>

<p>
  <img src="https://img.shields.io/badge/React-19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-6-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Tailwind%20CSS-4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/shadcn%2Fui-000000?style=for-the-badge&logo=shadcnui&logoColor=white" alt="shadcn/ui" />
</p>

<p>
  <img src="https://img.shields.io/badge/Status-In%20Development-7C3AED?style=for-the-badge" alt="Project Status" />
  <img src="https://img.shields.io/badge/Platform-Web%20%26%20Mobile%20Responsive-2563EB?style=for-the-badge" alt="Platform" />
  <img src="https://img.shields.io/badge/Project-Capstone-F59E0B?style=for-the-badge" alt="Capstone Project" />
  <img src="https://img.shields.io/badge/Monorepo-Turborepo-EF4444?style=for-the-badge" alt="Monorepo" />
</p>

<p>
  <img src="https://img.shields.io/badge/React-19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-6-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Tailwind%20CSS-4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/shadcn%2Fui-000000?style=for-the-badge&logo=shadcnui&logoColor=white" alt="shadcn/ui" />
</p>

<p>
  <img src="https://img.shields.io/badge/Django-5-092E20?style=for-the-badge&logo=django&logoColor=white" alt="Django" />
  <img src="https://img.shields.io/badge/DRF-A30000?style=for-the-badge&logo=django&logoColor=white" alt="DRF" />
  <img src="https://img.shields.io/badge/PostgreSQL%2BPostGIS-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostGIS" />
  <img src="https://img.shields.io/badge/Celery-378B29?style=for-the-badge&logo=celery&logoColor=white" alt="Celery" />
  <img src="https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white" alt="Redis" />
</p>

</div>

## Overview

**E-Boses** is a web-based, mobile-responsive barangay civic engagement and emergency coordination platform designed for **Barangay Marikina Heights, Marikina City**.

For the capstone presentation, see the [demo account roster](docs/demo/DEMO-ACCOUNTS.md) and [FEAT1–FEAT8 demonstration guide](docs/demo/FEAT1-FEAT8-DEMO-GUIDE.md).

The system helps digitize and structure how residents report community concerns, monitor report status, and send emergency alerts to barangay responders.

## Current Status

This repository is in **active development**. React and Vite provide the frontend. Django provides the API and business rules. PostgreSQL, Redis, Celery, and Channels support data, queued work, caching, and live updates.

The main workflows are verified. See [PROJECT-DOCUMENTATION.md](PROJECT-DOCUMENTATION.md) for current architecture and complete feature coverage. See [FINDINGS.md](FINDINGS.md) for confirmed failures and test results.

## Architecture

```
e-boses/
├── apps/
│   ├── api/              # Django 5 backend API
│   └── web/              # React 19 frontend application
├── packages/
│   └── ui/               # Shared UI component library (shadcn/ui)
├── .claude/              # Claude Code configuration & memory
├── .turbo/               # Turborepo build cache
├── .vscode/              # Editor settings
├── .env                  # Environment variables (gitignored)
└── .env.example          # Environment variable template
```

### `apps/web` — Frontend Application

The main web app built with React 19, Vite 8, and Tailwind CSS 4. Features include:

- **TypeScript 6** with strict mode and bundler module resolution
- **shadcn/ui** `radix-nova` style components (Button shipped, more to come)
- **Path alias** `@/` mapped to `src/` for clean imports
- **Code quality** — ESLint 10, Prettier with Tailwind plugin, full type checking
- **Real-time** — WebSocket connections for live maps and notifications
- **Offline support** — Service worker, GPS ping queue for responders
- **Maps** — Leaflet-based resident and official alert maps
- **3D scenes** — Three.js for landing page animations
- **GSAP** — Scroll-triggered animations on landing and onboarding

### `apps/api` — Backend API

A Django 5 + DRF backend with implemented routes for:

| Module | Purpose |
|--------|---------|
| `config/` | Django project settings, URLs, WSGI/ASGI entry points |
| `apps/accounts/` | User registration, JWT auth, OTP verification, profiles, OCR verification |
| `apps/concerns/` | Community concern reporting with geolocation, AI assessment, privacy pipeline |
| `apps/emergencies/` | Emergency alerting, responder coordination, dispatch, live map |
| `apps/sms/` | SMS gateway integration, inbound/outbound, AI assist for parsing |
| `apps/notifications/` | Push/in-app notifications & WebSocket channels |
| `apps/assistant/` | AI chatbot (Poolside inference) |
| `apps/audit_log/` | Audit trail for sensitive actions |
| `templates/` | Email templates for OTP and alerts |
| `scripts/` | Utility scripts for management tasks |

- **JWT authentication** with `djangorestframework-simplejwt`
- **WebSocket support** via Django Channels + Redis
- **Celery** for background tasks (OCR, privacy processing, SMS delivery)
- **PostgreSQL** with decimal coordinates and JSON geometry; optional PostGIS can be enabled by configuration
- **Automatic concern validation** before the official work queue, with category correction, duplicate context, reasoned rejection, and fail-open model recovery
- **Environment-driven** config with `django-environ` (reads `.env` from repo root)
- **CORS** configured for the Vite frontend dev server
- **Health check** at `/api/health/`

### `packages/ui` — Shared UI Library

A centralized component library consumed by `apps/web` (and any future apps):

- **shadcn/ui** components built on class-variance-authority and tailwind-merge
- **CSS design tokens** via Tailwind v4 `@theme` directive with OKLCH colors
- **Dark mode variables** via `.dark` class toggle
- **Zod** for runtime validation
- **Export map** for clean package-level imports (`@workspace/ui/components/*`)

## Tech Stack

### Implemented

| Technology | Purpose |
|------------|---------|
| React 19 | UI Library |
| Vite 8 | Build Tool & Dev Server |
| Tailwind CSS 4 | Utility-first CSS with `@theme` tokens |
| TypeScript 6 | Type safety |
| shadcn/ui (radix-nova) | Accessible, unstyled UI primitives |
| class-variance-authority | Component variant API |
| tailwind-merge | Class conflict resolution |
| Lucide Icons | Icon library |
| Zod | Schema validation |
| Turborepo | Monorepo orchestration & caching |
| ESLint 10 | Linting |
| Prettier | Code formatting |
| Django 5 | Backend API |
| Django REST Framework | REST endpoints |
| Django Channels | WebSocket support |
| Celery | Background task queue |
| Redis | Cache, Celery broker, Channels layer |
| PostgreSQL | Application database |
| PostGIS | Optional database extension; disabled by default |
| SimpleJWT | JWT authentication |
| Cloudinary | Legacy rollback-only media adapter |
| Resend | Email delivery (OTP, notifications) |
| SMS Gateway (Android) | SMS delivery (OTP, emergency alerts) |
| Ollama / Poolside | LLM inference (Gemma, Laguna) |
| Roboflow SAM3 | Privacy segmentation (face/license plate/blood) |
| OCR.space + EasyOCR | Document OCR with fallback |
| Nominatim / Overpass | Geocoding and POI data |
| Web Push (pywebpush) | Browser push notifications |
| Cloudflare Turnstile | Bot protection |
| IP2GEO | IP geolocation and intelligence |

### Planned

| Technology | Purpose |
|------------|---------|
| Docker | Containerization |
| Render | Cloud deployment |
| PaddleOCR | Alternative local OCR engine |
| YOLOv8m | Optional local image analysis for complaint photos |

## Getting Started

### Prerequisites

- **Node.js 20+** (npm 11.17+)
- **Python 3.13+** with virtual environment
- **PostgreSQL 14+**; PostGIS is optional unless `ENABLE_GIS` is enabled
- **Redis** (local or Upstash)
- A terminal (PowerShell, bash, or zsh)

### Quick Start

```bash
# Install dependencies (from repo root)
npm install

# Start the frontend dev server
npm run dev --workspace web
```

The root workspace does not start Django. Start the backend in a second terminal.

### Start Backend Only

```bash
cd apps/api
python manage.py runserver 0.0.0.0:8000
```

Run Redis plus the Celery worker and Beat when OCR, AI, privacy, SMS, scheduled content, retention, or retry behavior is tested:

```powershell
cd apps\api
powershell -ExecutionPolicy Bypass -File scripts\start-redis.ps1
powershell -ExecutionPolicy Bypass -File scripts\start-celery.ps1
```

### Access from a phone or other devices (same Wi‑Fi)

No cloud tunnel required. Host PC and phone must share the **same Wi‑Fi** (avoid guest networks).

1. **Find your PC IPv4** (PowerShell):

```powershell
ipconfig
```

Look under **Wireless LAN adapter Wi‑Fi** for `IPv4 Address` (example: `10.31.15.164`).

2. **Point env at that IP** in the repo root `.env`:

```env
FRONTEND_URL=https://YOUR_LAN_IP:5173
VITE_API_BASE_URL=/api
DJANGO_ENV=local
ALLOWED_HOSTS=localhost,127.0.0.1,YOUR_LAN_IP,*
CSRF_TRUSTED_ORIGINS=https://localhost:5173,https://YOUR_LAN_IP:5173,http://localhost:5173,http://YOUR_LAN_IP:5173
```

Restart Vite after changing any `VITE_*` value.

3. **Start the API bound to all interfaces** (`apps/api`, venv active):

```powershell
python manage.py runserver 0.0.0.0:8000
```

4. **Start the frontend** (repo root or `apps/web` — already uses `--host`):

```powershell
npm run dev
```

5. **On the phone**, open:

| What | URL |
|------|-----|
| App | `https://YOUR_LAN_IP:5173` |
| API health | `http://YOUR_LAN_IP:8000/api/health/` |

Use the LAN IP on the phone — **not** `localhost`.

6. **If the phone cannot connect**, allow Windows Firewall inbound TCP for ports `5173` and `8000` (Admin PowerShell):

```powershell
New-NetFirewallRule -DisplayName "E-Boses Vite 5173" -Direction Inbound -Protocol TCP -LocalPort 5173 -Action Allow
New-NetFirewallRule -DisplayName "E-Boses Django 8000" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow
```

If the API works yesterday but not today, your DHCP IP may have changed — run `ipconfig` again and update `.env`.

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev --workspace web` | Start the frontend |
| `npm run build` | Build all workspaces for production |
| `npm run lint` | Run ESLint across all workspaces |
| `npm run format` | Format code with Prettier |
| `npm run typecheck` | Run TypeScript type checking |
| `python manage.py test` | Run backend tests |
| `python manage.py test apps/sms` | Run SMS app tests only |

### Adding shadcn/ui Components

```bash
# Add a new component (from repo root)
npx shadcn@latest add card
npx shadcn@latest add dialog
```

Components are installed into `packages/ui/src/components/` and re-exported via `@workspace/ui/components/*`.

## Development

### Environment Variables

Copy `.env.example` to `.env` and fill in values as needed:

```bash
cp .env.example .env
```

See `.env` for all required variables. Secrets are gitignored.

### Project Conventions

- **TypeScript strict mode** — no implicit any, strict null checks
- **ES modules** (`"type": "module"` in packages)
- **shadcn/ui radix-nova style** for all new components
- **Prettier** with `prettier-plugin-tailwindcss` for class sorting
- **Turborepo caching** — builds, linting, and typechecking are cached per task
- **Django test isolation** — the default test lane uses an isolated database and mocked providers; controlled live canaries are separate
