#!/bin/bash

# Exit on error
set -e

# Change to the backend directory
cd "$(dirname "$0")"
BACKEND_DIR="$(pwd)"

# Start FastAPI server in the background
echo "Starting FastAPI server..."
./start_fastapi.sh > "$BACKEND_DIR/fastapi.log" 2>&1 &
FASTAPI_PID=$!

# Start Huey consumer in the background
echo "Starting Huey consumer..."
./start_huey.sh > "$BACKEND_DIR/huey.log" 2>&1 &
HUEY_PID=$!

# Function to handle script termination
cleanup() {
    echo "Stopping servers..."
    kill $FASTAPI_PID 2>/dev/null || true
    kill $HUEY_PID 2>/dev/null || true
    echo "Servers stopped."
    exit 0
}

# Set up trap to catch termination signal
trap cleanup SIGINT SIGTERM

echo "Servers started successfully!"
echo "FastAPI running on http://localhost:8000"
echo "Huey consumer is running"
echo "Press Ctrl+C to stop both servers"

# Keep script running and show logs
tail -f "$BACKEND_DIR/fastapi.log" "$BACKEND_DIR/huey.log" 