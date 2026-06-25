#!/bin/bash
# ============================================================
# E-Boses Frontend Setup Script
# ============================================================
set -e

# Navigate to web directory
cd "$(dirname "$0")/../../apps/web"

echo "=== Setting up E-Boses Frontend ==="

# Install dependencies
echo "Installing Node.js dependencies..."
npm install

# Copy environment file
if [ ! -f ".env" ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
fi

# Initialize shadcn/ui
echo "---"
read -p "Initialize shadcn/ui? (y/n): " init_shadcn
if [ "$init_shadcn" = "y" ]; then
    npx shadcn@latest init
fi

# Add shadcn/ui components
echo "---"
read -p "Add default shadcn/ui components? (y/n): " add_components
if [ "$add_components" = "y" ]; then
    npx shadcn@latest add button card input label form alert badge dialog dropdown-menu sheet tabs table avatar separator sonner
fi

echo "=== Setup Complete ==="
echo "Run: cd apps/web && npm run dev"
