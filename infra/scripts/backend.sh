#!/bin/bash
# ============================================================
# E-Boses Backend Setup Script
# ============================================================
set -e

# Navigate to API directory
cd "$(dirname "$0")/../../apps/api"

echo "=== Setting up E-Boses Backend ==="

# Create virtual environment
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Install dependencies
echo "Installing Python dependencies..."
pip install -r requirements/development.txt

# Run migrations
echo "Running database migrations..."
python manage.py migrate

# Create superuser (optional)
echo "---"
read -p "Create a superuser? (y/n): " create_su
if [ "$create_su" = "y" ]; then
    python manage.py createsuperuser
fi

echo "=== Setup Complete ==="
echo "Run: cd apps/api && source venv/bin/activate && python manage.py runserver"
