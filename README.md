<a name="top"></a>

<a href="."><img src="media/hero-banner.png" alt="E-Boses — Ang bawat boses, naririnig." style="width:100%;border:2px solid #1a1a2e;border-radius:6px;"></a>

<div align="center">

[![Status](https://img.shields.io/badge/Status-In%20Development-7C3AED?style=for-the-badge)](.)
[![Platform](https://img.shields.io/badge/Platform-Mobile%20App-2563EB?style=for-the-badge)](.)
[![Capstone](https://img.shields.io/badge/Capstone-PUP-06B6D4?style=for-the-badge)](.)
[![Framework](https://img.shields.io/badge/React-19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](.)
[![Language](https://img.shields.io/badge/TypeScript-6-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](.)
[![Build](https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite&logoColor=white)](.)
[![Backend](https://img.shields.io/badge/Django-5-092E20?style=for-the-badge&logo=django&logoColor=white)](.)
[![Database](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](.)

</div>

<div style="display:flex;align-items:flex-start;gap:16px;margin-top:16px;">
  <img src="apps/web/public/contents/logo.webp" alt="E-Boses Logo" width="64" height="64" style="border-radius:8px;flex-shrink:0;">
  <p style="font-size:16px;margin:0;"><strong>E-Boses</strong> is a mobile-first barangay civic engagement and emergency coordination platform designed for <strong>Barangay Marikina Heights, Marikina City</strong>. It digitizes how residents report community concerns, monitor report status, and receive emergency alerts from barangay responders.</p>
</div>

## Table of Contents

- [About](#-about)
- [Key Features](#-key-features)
- [Quick Start](#-quick-start)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Documentation](#-documentation)
- [Feedback and Contributions](#-feedback-and-contributions)
- [License](#-license)

<h2 style="text-align:left;display:flex;align-items:center;justify-content:flex-start;gap:8px;"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg> About</h2>

**E-Boses** turns a barangay's community management into a digital, organized, and responsive mobile app. Rather than relying on manual reporting and paper-based tracking, residents submit concerns through the app, officials monitor progress through a dashboard, and responders receive real-time emergency alerts.

- **Concern Reporting:** residents submit community issues with photos, geolocation, and automated category classification
- **Emergency Alerts:** real-time SOS alerts with responder dispatch, live tracking, and escalation workflows
- **Role-Based Access:** three distinct roles (resident, official, responder) with JWT authentication and OTP verification
- **AI Validation:** automatic concern categorization, duplicate detection, and fail-open recovery when AI services are unavailable
- **Interactive Maps:** Leaflet maps for resident concerns, official zones, and live emergency positions

<h2 style="text-align:left;display:flex;align-items:center;justify-content:flex-start;gap:8px;"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg> Key Features</h2>

| Feature | Description |
|---------|-------------|
| Concern Reporting | Submit community issues with photos, geolocation, and automated category classification |
| Emergency Alerts | Real-time SOS alerts with responder dispatch, live tracking, and escalation workflows |
| Mobile-Responsive | Full PWA support across all devices on the same Wi-Fi network |
| AI Validation | Automatic concern categorization, duplicate detection, and fail-open recovery |
| Secure Auth | JWT authentication, OTP verification, and role-based access (resident, official, responder) |
| Interactive Maps | Leaflet maps for resident concerns, official zones, and live emergency positions |
| Notifications | Push, in-app, email, and SMS notification channels across all platforms |
| OCR Verification | Document OCR for official ID verification during registration |
| Multilingual | English and Filipino language support |

<h2 style="text-align:left;display:flex;align-items:center;justify-content:flex-start;gap:8px;"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Quick Start</h2>

### Prerequisites

| Requirement | Minimum Version |
|-------------|----------------|
| Node.js | 20+ (npm 11.17+) |
| Python | 3.13+ with virtual environment |
| PostgreSQL | 14+ (PostGIS optional) |
| Redis | Local or Upstash |

### Setup

```bash
# 1. Install frontend dependencies
npm install

# 2. Setup backend (in a separate terminal)
cd apps/api
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate

# 3. Start Redis and Celery workers
powershell -ExecutionPolicy Bypass -File scripts\start-redis.ps1
powershell -ExecutionPolicy Bypass -File scripts\start-celery.ps1

# 4. Start both servers
cd ..
npm run dev --workspace web
cd apps/api
python manage.py runserver 0.0.0.0:8000
```

<div style="border-left:4px solid #f97316; padding:8px 16px; margin:12px 0;">
  <p style="color:#f97316; font-weight:600; margin:0 0 4px 0; font-size:15px;">
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:4px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    Important
  </p>
  <p style="color:#c4c4c4; margin:0; line-height:1.6;">When deploying in a container, static assets may not reflect recent changes due to Docker build caching. Always run <code style="color:#e8e8e8;">npm run build</code> with <code style="color:#e8e8e8;">--no-cache</code> or clear the build cache before rebuilding. Verify the deployed files match the latest source code.</p>
</div>

<h2 style="text-align:left;display:flex;align-items:center;justify-content:flex-start;gap:8px;"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 12h4"/><path d="M10 8h4"/><path d="M14 21v-3a2 2 0 0 0-4 0v3"/><path d="M6 10V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v5"/><path d="M18 10h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2"/><path d="M6 21V10"/></svg> Architecture</h2>

```
e-boses/
├── apps/
│   ├── api/              # Django 5 backend (port 8000)
│   └── web/              # React 19 frontend (port 5173)
├── packages/
│   └── ui/               # Shared component library
├── media/                # Hero images and uploads
├── docs/                 # Documentation, demos, design system
├── scripts/              # Utility and automation scripts
├── .env                  # Environment variables (gitignored)
└── .env.example          # Environment variable template
```

### Backend Modules

| Module | Purpose |
|--------|---------|
| `accounts/` | Registration, JWT auth, OTP, profiles, OCR verification |
| `concerns/` | Community reporting, geolocation, AI assessment, privacy pipeline |
| `emergencies/` | SOS alert intake, severity transitions, responder assignment, response timelines |
| `notifications/` | Push/in-app notifications, device delivery, WebSocket fan-out |
| `assistant/` | AI chatbot |
| `audit_log/` | Audit trail for sensitive actions |

<h2 style="text-align:left;display:flex;align-items:center;justify-content:flex-start;gap:8px;"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/></svg> Tech Stack</h2>

### Frontend

| Technology | Role |
|------------|------|
| <img src="https://img.shields.io/badge/React--20232A?style=flat&logo=react&logoColor=61DAFB" alt="React 19" style="max-width:100%"> | UI library |
| <img src="https://img.shields.io/badge/TypeScript--3178C6?style=flat&logo=typescript&logoColor=fff" alt="TypeScript 6" style="max-width:100%"> | Type safety |
| <img src="https://img.shields.io/badge/Vite--646CFF?style=flat&logo=vite&logoColor=fff" alt="Vite 8" style="max-width:100%"> | Build tool and dev server |
| <img src="https://img.shields.io/badge/Tailwind%20CSS--06B6D4?style=flat&logo=tailwindcss&logoColor=fff" alt="Tailwind CSS 4" style="max-width:100%"> | Utility-first styling |
| <img src="https://img.shields.io/badge/shadcn%2Fui--000000?style=flat" alt="shadcn/ui" style="max-width:100%"> | Accessible component primitives |
| <img src="https://img.shields.io/badge/Three.js--1a1a1a?style=flat&logo=three.js&logoColor=fff" alt="Three.js" style="max-width:100%"> | 3D landing page animations |
| <img src="https://img.shields.io/badge/GSAP--888888?style=flat&logo=gsap&logoColor=fff" alt="GSAP" style="max-width:100%"> | Scroll-triggered animations |
| <img src="https://img.shields.io/badge/Lucide%20Icons--000000?style=flat&logo=lucide&logoColor=fff" alt="Lucide Icons" style="max-width:100%"> | Icon library |
| <img src="https://img.shields.io/badge/Zod--ffffff?style=flat&logo=zod&logoColor=000" alt="Zod" style="max-width:100%"> | Runtime schema validation |

### Backend

| Technology | Role |
|------------|------|
| <img src="https://img.shields.io/badge/Django--092E20?style=flat&logo=django&logoColor=fff" alt="Django 5" style="max-width:100%"> | Backend framework |
| <img src="https://img.shields.io/badge/DRF--ffffff?style=flat" alt="DRF" style="max-width:100%"> | REST API endpoints |
| <img src="https://img.shields.io/badge/Channels--ffffff?style=flat" alt="Channels" style="max-width:100%"> | WebSocket layer |
| <img src="https://img.shields.io/badge/Celery--378B29?style=flat&logo=celery&logoColor=fff" alt="Celery" style="max-width:100%"> | Background task queue |
| <img src="https://img.shields.io/badge/Redis--DC382D?style=flat&logo=redis&logoColor=fff" alt="Redis" style="max-width:100%"> | Cache, broker, and channels layer |
| <img src="https://img.shields.io/badge/PostgreSQL--4169E1?style=flat&logo=postgresql&logoColor=fff" alt="PostgreSQL" style="max-width:100%"> | Application database |
| <img src="https://img.shields.io/badge/SimpleJWT--ffffff?style=flat" alt="SimpleJWT" style="max-width:100%"> | JWT authentication |
| <img src="https://img.shields.io/badge/Ollama%20%2F%20Poolside--ffffff?style=flat" alt="Ollama / Poolside" style="max-width:100%"> | AI inference |
| <img src="https://img.shields.io/badge/Roboflow%20SAM3--ffffff?style=flat" alt="Roboflow SAM3" style="max-width:100%"> | Privacy segmentation |
| <img src="https://img.shields.io/badge/OCR.space%20%2B%20EasyOCR--ffffff?style=flat" alt="OCR.space + EasyOCR" style="max-width:100%"> | Document OCR |
| <img src="https://img.shields.io/badge/Resend--ffffff?style=flat" alt="Resend" style="max-width:100%"> | Email delivery |
| <img src="https://img.shields.io/badge/SMS%20Gateway--ffffff?style=flat" alt="SMS Gateway" style="max-width:100%"> | SMS delivery |
| <img src="https://img.shields.io/badge/Nominatim%20%2F%20Overpass--ffffff?style=flat" alt="Nominatim / Overpass" style="max-width:100%"> | Geocoding and POI data |
| <img src="https://img.shields.io/badge/IP2GEO--ffffff?style=flat" alt="IP2GEO" style="max-width:100%"> | IP geolocation |

<h2 style="text-align:left;display:flex;align-items:center;justify-content:flex-start;gap:8px;"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg> Documentation</h2>

| Resource | Location |
|----------|----------|
| Project Documentation | `apps/web/docs/PROJECT-DOCUMENTATION.md` |
| Demo Accounts | `docs/demo/DEMO-ACCOUNTS.md` |
| Feature Demo Guide | `docs/demo/FEAT1-FEAT8-DEMO-GUIDE.md` |
| Design System | `docs/design-system/` |
| Architecture | `docs/architecture/` |
| Testing Strategy | `docs/testing/` |
| API README | `apps/api/README.md` |
| Web README | `apps/web/README.md` |
| Android Native Docs | `apps/web/native-android/README.md` |

<h2 style="text-align:left;display:flex;align-items:center;justify-content:flex-start;gap:8px;"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m11 17 5-5a2.12 2.12 0 0 0-3-3l-5 5"/><path d="m11 7 5 5a2.12 2.12 0 0 0 3-3l-5-5"/><path d="M12 22 3 12 12 2 21 12 12 22Z"/></svg> Feedback and Contributions</h2>

The platform is actively developed, but edge cases in community workflows are difficult to anticipate from the codebase alone. Whether you have feedback on features, have encountered bugs, or have suggestions for enhancements, a report that names the specific scenario and user role turns a guess into a fix.

<div style="border-left:4px solid #f97316; padding:8px 16px; margin:12px 0;">
  <p style="color:#f97316; font-weight:600; margin:0 0 4px 0; font-size:15px;">
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:4px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    Important
  </p>
  <p style="color:#c4c4c4; margin:0; line-height:1.6;">For capstone presentation materials, see the <a href="docs/demo/DEMO-ACCOUNTS.md" style="color:#f97316;">demo account roster</a> and the <a href="docs/demo/FEAT1-FEAT8-DEMO-GUIDE.md" style="color:#f97316;">FEAT1-FEAT8 demonstration guide</a>.</p>
</div>

<h2 style="text-align:left;display:flex;align-items:center;justify-content:flex-start;gap:8px;"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg> License</h2>

MIT License — see [LICENSE](LICENSE) for details.

[Back to top](#top)
