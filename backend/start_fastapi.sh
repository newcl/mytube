#!/bin/bash

# Exit on error
set -e

# Change to the backend directory
cd "$(dirname "$0")"

# Activate virtual environment (if it exists)
if [ -d "venv" ]; then
    source venv/bin/activate
fi

# Wait for database to be ready
# echo "Waiting for database to be ready..."
# while ! python3 -c "import psycopg2; psycopg2.connect('$DATABASE_URL')" 2>/dev/null; do
#     echo "Database not ready, waiting..."
#     sleep 2
# done
# echo "Database is ready!"

# Run database migrations
export DATABASE_URL=postgresql://mytube:123456@localhost:5432/mytube
echo "Running database migrations..."
alembic upgrade head

# Start FastAPI server
echo "Starting FastAPI server..."
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4 --log-level info 