#!/usr/bin/env bash
# Render build: install deps, collect static, migrate (pooler :6543).
# If migrate fails on the pooler, run it once from your PC via Direct :5432.
set -o errexit

pip install -r requirements.txt
python manage.py collectstatic --no-input
python manage.py migrate --no-input
