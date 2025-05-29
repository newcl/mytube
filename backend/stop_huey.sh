#!/bin/bash

cd "$(dirname "$0")"

if [ -f huey.pid ]; then
    PID=$(cat huey.pid)
    echo "Stopping Huey consumer with PID $PID..."
    kill "$PID" && rm huey.pid
else
    echo "No PID file found. Is Huey running?"
fi
