#!/bin/bash

cd "$(dirname "$0")"
source venv/bin/activate

LOG_FILE="huey.log"
PID_FILE="huey.pid"

# Start in background with log redirection
echo "Starting Huey consumer..."
export HUEY_LOG_LEVEL=INFO
nohup python3 run_huey.py >> "$LOG_FILE" 2>&1 &

# Save the PID
echo $! > "$PID_FILE"
echo "Huey consumer started with PID $! and logging to $LOG_FILE"
