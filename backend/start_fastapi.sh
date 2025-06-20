#!/bin/bash

# Exit on error
set -e

# Change to the backend directory
cd "$(dirname "$0")"

# Activate virtual environment
source venv/bin/activate

# Start FastAPI server
echo "Starting FastAPI server..."
export MINIO_ENDPOINT="minio.elladali.com"
export MINIO_ACCESS_KEY="vRbz7k4tk5FUQj4ZcbiC"
export MINIO_SECRET_KEY="IIbDkUO36qMd9IEjW4FpDfh9wH46LI2GPt6S0hNm"
python3 -m uvicorn main:app --reload --host 0.0.0.0 --port 8000 --log-level debug 