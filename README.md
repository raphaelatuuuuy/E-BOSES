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
  <img src="https://img.shields.io/badge/Planned-Django%20Backend-092E20?style=for-the-badge&logo=django&logoColor=white" alt="Django Planned" />
  <img src="https://img.shields.io/badge/Planned-PostGIS-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostGIS Planned" />
</p>

</div>

## Overview

**E-Boses** is a web-based, mobile-responsive barangay civic engagement and emergency coordination platform designed for **Barangay Marikina Heights, Marikina City**.

The system helps digitize and structure how residents report community concerns, monitor report status, and send emergency alerts to barangay responders.

## Current Status

This repository is in **active development**. The frontend is built with React 19 / Vite 8 using a **Turborepo monorepo** with shared UI components. The Django backend scaffolding is in place (`apps/api`) with PostgreSQL/PostGIS planned for production — ready for model and endpoint implementation.

## Architecture

```
e-boses/
├── apps/
│   ├── api/              # Django backend API (scaffolded)
│   └── web/              # React 19 frontend application
├── packages/
│   └── ui/               # Shared UI component library (shadcn/ui)
├── .claude/              # Claude Code configuration & memory
├── .turbo/               # Turborepo build cache
├── .vscode/              # Editor settings
└── .env.example          # Environment variable template
```

### `apps/web` — Frontend Application

The main web app built with React 19, Vite 8, and Tailwind CSS 4. Features include:

- **TypeScript 6** with strict mode and bundler module resolution
- **Dark mode** support with `ThemeProvider` — toggle with the `d` key
- **shadcn/ui** `radix-nova` style components (Button shipped, more to come)
- **Path alias** `@/` mapped to `src/` for clean imports
- **Code quality** — ESLint 10, Prettier with Tailwind plugin, full type checking

### `apps/api` — Backend API

A Django 5 backend scaffolded and ready for development:

| Module | Purpose |
|--------|---------|
| `config/` | Django project settings, URLs, WSGI/ASGI entry points |
| `apps/accounts/` | User registration, JWT auth, OTP verification, profiles |
| `apps/concerns/` | Community concern reporting with geolocation |
| `apps/emergencies/` | Emergency alerting & responder coordination |
| `apps/notifications/` | Push/in-app notifications & WebSocket channels |
| `templates/` | Email templates for OTP and alerts |
| `scripts/` | Utility scripts for management tasks |

- **JWT authentication** with `djangorestframework-simplejwt`
- **WebSocket support** via Django Channels + Redis
- **PostGIS-ready** `django.contrib.gis` configured in settings
- **Environment-driven** config with `django-environ` (reads `.env` from repo root)
- **CORS** configured for the Vite frontend dev server

### `packages/ui` — Shared UI Library

A centralized component library consumed by `apps/web` (and any future apps):

- **shadcn/ui** components built on class-variance-authority and tailwind-merge
- **CSS design tokens** via Tailwind v4 `@theme` directive with OKLCH colors
- **Dark mode variables** via `.dark` class toggle
- **Zod** for runtime validation
- **Export map** for clean package-level imports (`@workspace/ui/components/*`)

## Tech Stack

### Present

| Badge | Technology | Purpose |
|-------|------------|---------|
| <img src="https://img.shields.io/badge/React-19-20232A?style=flat-square&logo=react&logoColor=61DAFB" alt="React 19" /> | React 19 | UI Library |
| <img src="https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite&logoColor=white" alt="Vite 8" /> | Vite 8 | Build Tool & Dev Server |
| <img src="https://img.shields.io/badge/Tailwind%20CSS-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind CSS 4" /> | Tailwind CSS 4 | Utility-first CSS with `@theme` tokens |
| <img src="https://img.shields.io/badge/TypeScript-6-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 6" /> | TypeScript 6 | Type safety |
| <img src="https://img.shields.io/badge/shadcn%2Fui-000000?style=flat-square&logo=shadcnui&logoColor=white" alt="shadcn/ui" /> | shadcn/ui (radix-nova) | Accessible, unstyled UI primitives |
| <img src="https://img.shields.io/badge/CVA-A855F7?style=flat-square&logo=react&logoColor=white" alt="class-variance-authority" /> | class-variance-authority | Component variant API |
| <img src="https://img.shields.io/badge/tailwind--merge-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" alt="tailwind-merge" /> | tailwind-merge | Class conflict resolution |
| <img src="https://img.shields.io/badge/Lucide-F56565?style=flat-square&logo=lucide&logoColor=white" alt="Lucide" /> | Lucide Icons | Icon library |
| <img src="https://img.shields.io/badge/Zod-3068B7?style=flat-square&logo=zod&logoColor=white" alt="Zod" /> | Zod | Schema validation |
| <img src="https://img.shields.io/badge/Turborepo-EF4444?style=flat-square&logo=turborepo&logoColor=white" alt="Turborepo" /> | Turborepo | Monorepo orchestration & caching |
| <img src="https://img.shields.io/badge/ESLint-10-4B32C3?style=flat-square&logo=eslint&logoColor=white" alt="ESLint 10" /> | ESLint 10 | Linting |
| <img src="https://img.shields.io/badge/Prettier-F7B93E?style=flat-square&logo=prettier&logoColor=black" alt="Prettier" /> | Prettier | Code formatting |
| <img src="https://img.shields.io/badge/Django-5-092E20?style=flat-square&logo=django&logoColor=white" alt="Django 5" /> | Django 5 | Backend API (scaffolded) |
| <img src="https://img.shields.io/badge/DRF-A30000?style=flat-square&logo=django&logoColor=white" alt="Django REST Framework" /> | Django REST Framework | REST endpoints (scaffolded) |
| <img src="https://img.shields.io/badge/Django%20Channels-0F766E?style=flat-square&logo=django&logoColor=white" alt="Django Channels" /> | Django Channels | WebSocket support (scaffolded) |
| <img src="https://img.shields.io/badge/Python-3.11+-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python 3.11+" /> | Python 3.11+ | Backend programming language |

### Planned

The `.env.example` contains configuration scaffolding for:

| Badge | Technology | Purpose |
|-------|------------|---------|
| <img src="https://img.shields.io/badge/PostgreSQL%20%2B%20PostGIS-4169E1?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL + PostGIS" /> | PostgreSQL + PostGIS | Database with geospatial queries |
| <img src="https://img.shields.io/badge/Redis-DC382D?style=flat-square&logo=redis&logoColor=white" alt="Redis" /> | Redis | Caching & WebSocket layer |
| <img src="https://img.shields.io/badge/Cloudinary-3448C5?style=flat-square&logo=cloudinary&logoColor=white" alt="Cloudinary" /> | Cloudinary | Media storage |
| <img src="https://img.shields.io/badge/Turnstile-1D9B7A?style=flat-square&logo=cloudflare&logoColor=white" alt="Turnstile" /> | Turnstile (Cloudflare) | Bot protection |
| <img src="https://img.shields.io/badge/Twilio%20%2F%20SMS-F22F46?style=flat-square&logo=twilio&logoColor=white" alt="Twilio" /> | Twilio / SMS | OTP & alert delivery |
| <img src="https://img.shields.io/badge/Render-000000?style=flat-square&logo=render&logoColor=white" alt="Render" /> | Render | Cloud deployment |
| <img src="https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker" /> | Docker | Containerization |
| <img src="https://img.shields.io/badge/PaddleOCR-2563EB?style=flat-square&logo=python&logoColor=white" alt="PaddleOCR" /> | PaddleOCR | Document OCR pipeline |
| <img src="https://img.shields.io/badge/IP2GEO-7C3AED?style=flat-square&logo=googlemaps&logoColor=white" alt="IP2GEO" /> | IP2GEO | Geolocation |
| <img src="https://img.shields.io/badge/Google%20OAuth-4285F4?style=flat-square&logo=google&logoColor=white" alt="Google OAuth" /> | Google OAuth | Social login |

## Getting Started

### Prerequisites

- **Node.js 20+** (npm 11.17+)
- A terminal (PowerShell, bash, or zsh)

### Quick Start

```bash
# Install dependencies (from repo root)
npm install

# Start the frontend dev server
npm run dev

# Or target the web app directly
cd apps/web && npm run dev
```

The Vite dev server starts at `http://localhost:5173`.

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start all workspaces in dev mode |
| `npm run build` | Build all workspaces for production |
| `npm run lint` | Run ESLint across all workspaces |
| `npm run format` | Format code with Prettier |
| `npm run typecheck` | Run TypeScript type checking |

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

### Project Conventions

- **TypeScript strict mode** — no implicit any, strict null checks
- **ES modules** (`"type": "module"` in packages)
- **shadcn/ui radix-nova style** for all new components
- **Prettier** with `prettier-plugin-tailwindcss` for class sorting
- **Turborepo caching** — builds, linting, and typechecking are cached per task

## License

This project is developed for academic purposes at the **Polytechnic University of the Philippines**.

All rights reserved.
