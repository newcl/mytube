#!/bin/bash

# Exit on error
set -e

cd "$(dirname "$0")"
source venv/bin/activate

# Start Huey consumer
echo "Starting Huey consumer..."
export HUEY_LOG_LEVEL=INFO
exec python3 run_huey.py
