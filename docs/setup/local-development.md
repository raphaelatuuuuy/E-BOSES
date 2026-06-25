# Local Development Setup

## Prerequisites

- **Node.js** 18+ and **npm**
- **Python** 3.12+ and **pip**
- **PostgreSQL** 16+ with **PostGIS** extension
- **Redis** 7+
- **Docker** & **Docker Compose** (optional)

## Quick Start (Docker)

```bash
# Clone the repository
git clone https://github.com/rplatoy/E-Boses.git
cd E-Boses

# Copy environment variables
cp .env.example .env

# Start all services
docker compose up -d
```

Services will be available at:
- Frontend: http://localhost:5173
- API: http://localhost:8000
- Admin: http://localhost:8000/admin/
- Database: localhost:5432
- Redis: localhost:6379

## Manual Setup

### 1. Environment Variables

```bash
cp .env.example .env
# Edit .env with your local database credentials
```

### 2. Backend Setup

```bash
cd apps/api

# Create and activate virtual environment
python -m venv venv
# Windows: venv\Scripts\activate
source venv/bin/activate

# Install dependencies
pip install -r requirements/development.txt

# Run migrations
python manage.py migrate

# Create superuser
python manage.py createsuperuser

# Start development server
python manage.py runserver
```

### 3. Frontend Setup

```bash
cd apps/web

# Install dependencies
npm install

# Start development server
npm run dev
```

### 4. shadcn/ui Setup

```bash
cd apps/web

# Initialize shadcn/ui
npx shadcn@latest init

# Add components
npx shadcn@latest add button card input label form alert badge
npx shadcn@latest add dialog dropdown-menu sheet tabs table
npx shadcn@latest add avatar separator sonner
```

## Common Commands

```bash
# Backend
python manage.py runserver      # Start dev server
python manage.py test            # Run tests
python manage.py makemigrations  # Create migrations
python manage.py migrate         # Apply migrations

# Frontend
npm run dev                      # Start dev server
npm run build                    # Production build
npm run lint                     # Lint code
```
