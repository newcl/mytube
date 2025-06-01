#!/bin/bash

# Exit on error
set -e

# Change to the backend directory
cd "$(dirname "$0")"
BACKEND_DIR="$(pwd)"

# Function to kill a process if it exists
kill_if_exists() {
    local pid=$1
    local name=$2
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        echo "Stopping $name (PID: $pid)..."
        kill "$pid" 2>/dev/null || true
        # Give it a moment to terminate gracefully
        sleep 1
        # Force kill if still running
        if kill -0 "$pid" 2>/dev/null; then
            echo "Force stopping $name..."
            kill -9 "$pid" 2>/dev/null || true
        fi
    fi
}

# Function to read PID from file
read_pid() {
    local name=$1
    cat "$BACKEND_DIR/pids/$name.pid" 2>/dev/null || echo ""
}

# Function to kill a process and its children
kill_process_tree() {
    local pid=$1
    local name=$2
    
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        echo "Stopping $name process tree (PID: $pid)..."
        
        # Get child PIDs
        local children=$(ps --ppid "$pid" -o pid= 2>/dev/null || true)
        
        # Kill children first
        for child in $children; do
            if [ -n "$child" ]; then
                echo "Stopping child process $child..."
                kill "$child" 2>/dev/null || true
                sleep 0.5
                if kill -0 "$child" 2>/dev/null; then
                    kill -9 "$child" 2>/dev/null || true
                fi
            fi
        done
        
        # Kill the parent process
        kill "$pid" 2>/dev/null || true
        sleep 0.5
        if kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" 2>/dev/null || true
        fi
    fi
}

# Function to kill Python multiprocessing processes
kill_multiprocessing() {
    echo "Stopping Python multiprocessing processes..."
    
    # Kill resource tracker processes
    pids=$(ps aux | grep "multiprocessing.resource_tracker" | grep -v grep | awk '{print $2}' || true)
    if [ -n "$pids" ]; then
        for pid in $pids; do
            echo "Stopping resource tracker process $pid..."
            kill -9 "$pid" 2>/dev/null || true
        done
    fi
    
    # Kill spawn processes
    pids=$(ps aux | grep "multiprocessing.spawn" | grep -v grep | awk '{print $2}' || true)
    if [ -n "$pids" ]; then
        for pid in $pids; do
            echo "Stopping spawn process $pid..."
            kill -9 "$pid" 2>/dev/null || true
        done
    fi
    
    # Kill any remaining Python processes in our venv
    pids=$(ps aux | grep "$BACKEND_DIR/venv/bin/python" | grep -v grep | awk '{print $2}' || true)
    if [ -n "$pids" ]; then
        for pid in $pids; do
            echo "Stopping Python process $pid..."
            kill -9 "$pid" 2>/dev/null || true
        done
    fi
}

# Read and kill processes using PID files
FASTAPI_PID=$(read_pid "fastapi")
HUEY_PID=$(read_pid "huey")
TAIL_PID=$(read_pid "tail")

# Kill process trees
kill_process_tree "$FASTAPI_PID" "FastAPI"
kill_process_tree "$HUEY_PID" "Huey"
kill_if_exists "$TAIL_PID" "Log tail"

# Kill any remaining Python multiprocessing processes
kill_multiprocessing

# Clean up PID files
rm -rf "$BACKEND_DIR/pids"

echo "All servers stopped successfully!" 