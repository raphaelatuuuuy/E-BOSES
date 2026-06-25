# System Architecture Overview

## Architecture Style

E-Boses follows a **monorepo architecture** with separate frontend and backend applications sharing a common codebase.

```
┌─────────────────────────────────────────────────────────┐
│                    E-Boses Monorepo                      │
│  ┌────────────────┐         ┌────────────────┐          │
│  │                │         │                │          │
│  │   apps/web     │◄──HTTP──►   apps/api     │          │
│  │  (React/Vite)  │◄──WS────►  (Django/DRF)  │          │
│  │                │         │                │          │
│  └────────────────┘         └───────┬────────┘          │
│                                     │                   │
│                            ┌────────▼────────┐          │
│                            │                 │          │
│                            │   PostgreSQL    │          │
│                            │   + PostGIS     │          │
│                            │                 │          │
│                            └─────────────────┘          │
│                                     │                   │
│                            ┌────────▼────────┐          │
│                            │                 │          │
│                            │     Redis       │          │
│                            │  (Channels)     │          │
│                            │                 │          │
│                            └─────────────────┘          │
└─────────────────────────────────────────────────────────┘
```

## Frontend Architecture

- **React 19** with **Vite** for fast development and building
- **TypeScript** for type safety
- **Tailwind CSS** for utility-first styling
- **shadcn/ui** for accessible, consistent components
- **React Router** for client-side routing
- **React Context** for auth state management

### Directory Structure

```
apps/web/src/
├── app/           # App root, router setup
├── assets/        # Static assets
├── components/    # UI components
│   ├── common/    # Reusable project components
│   ├── forms/     # Form-specific components
│   ├── layout/    # Layout components
│   └── ui/        # shadcn/ui components
├── features/      # Feature modules
│   ├── auth/      # Authentication
│   ├── concerns/  # Civic concern reporting
│   ├── dashboard/ # Role-based dashboards
│   ├── emergencies/ # Emergency alerts
│   ├── map/       # Map features
│   └── notifications/ # Notifications
├── hooks/         # Custom React hooks
├── lib/           # Utilities, API client
├── pages/         # Page-level components
├── routes/        # Route guards
└── styles/        # Global styles
```

## Backend Architecture

- **Django 5** with **Django REST Framework**
- **PostgreSQL** with **PostGIS** for geospatial queries
- **Django Channels** + **Redis** for WebSocket/real-time
- **JWT** authentication via SimpleJWT
- **Modular structure** using domain modules

### Module Structure

```
modules/
├── accounts/     # User management, auth, OTP
├── barangays/    # Barangay management
├── concerns/     # Civic concern reports
├── emergencies/  # Emergency alerts
├── notifications/ # Notifications
├── audit/        # Audit logging
├── ai/           # AI services
│   ├── cv/       # Computer vision (YOLOv8)
│   ├── nlp/      # NLP (RoBERTa Tagalog)
│   └── ocr/      # OCR
└── common/       # Shared utilities
```

## API Design

All API endpoints are prefixed with `/api/v1/`:

```
/api/v1/auth/register/         # POST - Register
/api/v1/auth/otp/verify/       # POST - Verify OTP
/api/v1/auth/otp/resend/       # POST - Resend OTP
/api/v1/auth/login/            # POST - Login
/api/v1/auth/token/refresh/    # POST - Refresh JWT
/api/v1/auth/token/verify/     # POST - Verify JWT
/api/v1/auth/me/               # GET  - Current user
/api/v1/health/                # GET  - Health check
```

## Data Flow

1. User submits a concern via the web frontend
2. Frontend sends POST request to Django API
3. API validates user (JWT), content (placeholder), and location
4. Valid reports are stored in PostgreSQL + PostGIS
5. Status updates sent to user via WebSocket
6. Barangay officials review in their dashboard
