#!/bin/bash

# Function to kill processes by pattern
kill_processes() {
    local pattern=$1
    local name=$2
    local pids=$(pgrep -f "$pattern")
    
    if [ -n "$pids" ]; then
        echo "Found $name processes (PIDs: $pids)"
        for pid in $pids; do
            if kill -9 "$pid" 2>/dev/null; then
                echo "✓ Killed $name process $pid"
            else
                echo "✗ Failed to kill $name process $pid"
            fi
        done
    else
        echo "No $name processes found"
    fi
}

echo "🔍 Searching for processes to kill..."

# Kill FastAPI/uvicorn processes
kill_processes "uvicorn main:app" "FastAPI"

# Kill Huey processes
kill_processes "python3 run_huey.py" "Huey"

# Verify no processes are still running
if pgrep -f "uvicorn main:app" >/dev/null || pgrep -f "python3 run_huey.py" >/dev/null; then
    echo "⚠️  Warning: Some processes may still be running"
else
    echo "✅ All processes successfully terminated"
fi 