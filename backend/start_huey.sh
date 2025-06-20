#!/bin/bash

# Exit on error
set -e

cd "$(dirname "$0")"
source venv/bin/activate

# Start Huey consumer
echo "Starting Huey consumer..."
export HUEY_LOG_LEVEL=INFO
export MINIO_ENDPOINT="minio.elladali.com"
export MINIO_ACCESS_KEY="vRbz7k4tk5FUQj4ZcbiC"
export MINIO_SECRET_KEY="IIbDkUO36qMd9IEjW4FpDfh9wH46LI2GPt6S0hNm"
exec python3 run_huey.py
