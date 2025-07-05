#!/bin/bash

# Exit on error
set -e

cd "$(dirname "$0")"
source venv/bin/activate

# Start Huey consumer
echo "Starting Huey consumer..."
export HUEY_LOG_LEVEL=INFO
# export MINIO_ENDPOINT="http://localhost:9000"
# MinIO credentials should be set as environment variables
# export MINIO_ACCESS_KEY="your-access-key"
# export MINIO_SECRET_KEY="your-secret-key"
export MINIO_ACCESS_KEY="0W5QGI7U7OOCE4E7MP3X"
export MINIO_SECRET_KEY="HZc7kzDwQoFuWT4FZzZYs+m9ITWgpnGVlWTGmgaR"
exec python3 run_huey.py
