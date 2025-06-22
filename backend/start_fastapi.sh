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
# MinIO credentials should be set as environment variables
# export MINIO_ACCESS_KEY="your-access-key"
# export MINIO_SECRET_KEY="your-secret-key"
python3 -m uvicorn main:app --reload --host 0.0.0.0 --port 8000 --log-level debug 