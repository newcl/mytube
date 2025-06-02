#!/bin/bash

# Start backend server in background
echo "Starting backend server..."
cd backend && ./start_servers.sh > backend.log 2>&1 &
BACKEND_PID=$!

# Start frontend server in background
echo "Starting frontend server..."
cd frontend && npm start > frontend.log 2>&1 &
FRONTEND_PID=$!

echo "Servers are starting..."
echo "Backend PID: $BACKEND_PID"
echo "Frontend PID: $FRONTEND_PID"
echo "Check backend.log and frontend.log for output"
echo "To stop servers, run: kill $BACKEND_PID $FRONTEND_PID" 