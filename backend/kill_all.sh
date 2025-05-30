#!/bin/bash

echo "Attempting to kill FastAPI (uvicorn) and Huey processes..."

# Find PIDs for uvicorn main:app and kill them
UVICORN_PIDS=$(pgrep -f "uvicorn main:app")

if [ -z "$UVICORN_PIDS" ]; then
  echo "No FastAPI (uvicorn main:app) processes found."
else
  echo "Found FastAPI (uvicorn) processes with PIDs: $UVICORN_PIDS"
  # Use kill -9 for forceful termination
  echo $UVICORN_PIDS | xargs kill -9
  echo "FastAPI (uvicorn) processes killed."
fi

# Find PIDs for python3 run_huey.py and kill them
HUEY_PIDS=$(pgrep -f "python3 run_huey.py")

if [ -z "$HUEY_PIDS" ]; then
  echo "No Huey (python3 run_huey.py) processes found."
else
  echo "Found Huey processes with PIDs: $HUEY_PIDS"
  # Use kill -9 for forceful termination
  echo $HUEY_PIDS | xargs kill -9
  echo "Huey processes killed."
fi

echo "Process killing script finished." 