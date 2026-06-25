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
</p>

<p>
  <img src="https://img.shields.io/badge/React-19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/Django-5-092E20?style=for-the-badge&logo=django&logoColor=white" alt="Django" />
  <img src="https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PostGIS-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostGIS" />
</p>

</div>

## Overview

**E-Boses** is a web-based, mobile-responsive barangay civic engagement and emergency coordination platform designed for **Barangay Marikina Heights, Marikina City**.

The system helps digitize and structure how residents report community concerns, monitor report status, and send emergency alerts to barangay responders.

## Structure

This project uses a **monorepo** structure, meaning all code lives in one repository but is organized into separate folders by functionality.

```
master/
├── apps/           # Main applications
│   ├── api/        # Django backend API
│   └── web/        # React frontend
├── packages/       # Shared code between apps
├── infra/          # Infrastructure config (Docker, DB)
├── docs/           # Documentation files
└── scripts/        # Utility scripts
```

## Folder Descriptions

### `apps/` - Applications

| Folder | Description |
|--------|-------------|
| `apps/api/` | Django backend API server. Contains models, views, and API endpoints for authentication, concerns, emergencies, etc. |
| `apps/web/` | React frontend application. Contains pages, components, and routing for the user interface. Uses Vite for development. |

### `packages/` - Shared Code

Code that can be reused by both frontend and backend, such as:
- TypeScript types shared between apps
- Validation utilities
- Constants and enums

### `infra/` - Infrastructure

Configuration files for:
- `docker-compose.yml` - Docker services (database, Redis)
- Database initialization scripts

### `docs/` - Documentation

Project documentation including:
- Research documents
- Design files
- Setup guides

### `scripts/` - Utility Scripts

Helper scripts for:
- Setup and deployment
- Development tools

## Getting Started

### Prerequisites
- Node.js (for frontend)
- Python 3.11+ (for backend)
- PostgreSQL with PostGIS
- Docker (optional, for running services)

### Quick Start

1. **Frontend Development**
   ```bash
   cd apps/web
   npm install
   npm run dev
   ```

2. **Backend Development**
   ```bash
   cd apps/api
   python manage.py runserver
   ```

## License

This project is developed for academic purposes at the **Polytechnic University of the Philippines**.

All rights reserved.