#!/bin/bash

# Exit on error
set -e

# Change to the backend directory
cd "$(dirname "$0")"
BACKEND_DIR="$(pwd)"

# Create a directory for PID files
mkdir -p "$BACKEND_DIR/pids"

# Function to save PID to file
save_pid() {
    local pid=$1
    local name=$2
    echo "$pid" > "$BACKEND_DIR/pids/$name.pid"
}

# Start FastAPI server in the foreground
echo "Starting FastAPI server..."
./start_fastapi.sh > "$BACKEND_DIR/fastapi.log" 2>&1 &
FASTAPI_PID=$!
save_pid "$FASTAPI_PID" "fastapi"

# Start Huey consumer in the background
echo "Starting Huey consumer..."
./start_huey.sh > "$BACKEND_DIR/huey.log" 2>&1 &
HUEY_PID=$!
save_pid "$HUEY_PID" "huey"

# Function to handle script termination
cleanup() {
    echo "Stopping servers..."
    ./stop_servers.sh
    exit 0
}

# Set up trap to catch termination signal
trap cleanup SIGINT SIGTERM

echo "Servers started successfully!"
echo "FastAPI running on http://localhost:8000"
echo "Huey consumer is running"
echo "Press Ctrl+C to stop both servers"

# Comment out the tail -f line to keep the script alive
# tail -f "$BACKEND_DIR/fastapi.log" "$BACKEND_DIR/huey.log" &
# TAIL_PID=$!
# save_pid "$TAIL_PID" "tail"

# Wait for the FastAPI process
wait $FASTAPI_PID

# Wait for the Huey process
wait $HUEY_PID 