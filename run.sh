#!/usr/bin/env bash
set -euo pipefail

# run.sh
# - starts backend (uvicorn) in background (inside backend/.venv)
# - serves frontend/dist using python http.server on port 5173
# - opens default browser to the frontend URL
# - supports "stop" command to stop started processes

ROOT="$(cd "$(dirname "$0")" && pwd)"
CMD="${1:-start}"

LOGDIR="$ROOT/logs"
mkdir -p "$LOGDIR"
BACKEND_LOG="$LOGDIR/backend.log"
FRONTEND_LOG="$LOGDIR/frontend.log"
PIDFILE_BACKEND="$LOGDIR/backend.pid"
PIDFILE_FRONTEND="$LOGDIR/frontend.pid"

function start_services() {
  echo "Starting services..."

  # 1) Start backend
  if [ -f "$ROOT/backend/.venv/bin/activate" ]; then
    # run backend in venv
    source "$ROOT/backend/.venv/bin/activate"
    echo "Starting backend (uvicorn) in venv..."
    # run uvicorn in background, write PID
    # ensure we are in backend folder
    cd "$ROOT/backend"
    nohup uvicorn main:app --host 0.0.0.0 --port 8000 > "$BACKEND_LOG" 2>&1 &
    BACKEND_PID=$!
    echo $BACKEND_PID > "$PIDFILE_BACKEND"
    echo "Backend PID: $BACKEND_PID (logs: $BACKEND_LOG)"
    deactivate
  else
    echo "Virtualenv not found at backend/.venv. Please run ./setup.sh first."
    exit 1
  fi

  # 2) Serve frontend dist on port 5173
  if [ -d "$ROOT/frontend/dist" ]; then
    echo "Serving frontend (frontend/dist) on http://localhost:5173 ..."
    # serve from frontend/dist
    cd "$ROOT/frontend/dist"
    nohup python3 -m http.server 5173 > "$FRONTEND_LOG" 2>&1 &
    FRONTEND_PID=$!
    echo $FRONTEND_PID > "$PIDFILE_FRONTEND"
    echo "Frontend PID: $FRONTEND_PID (logs: $FRONTEND_LOG)"
  else
    echo "frontend/dist not found. Run ./setup.sh or build frontend manually."
    exit 1
  fi

  # 3) Wait a moment and open the browser
  sleep 1
  FRONTEND_URL="http://localhost:5173"
  echo "Opening browser at $FRONTEND_URL"
  # xdg-open is standard on Ubuntu
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$FRONTEND_URL" || true
  else
    echo "xdg-open not available; open $FRONTEND_URL in your browser."
  fi

  echo "Services started."
  echo "To stop: './run.sh stop'"
}

function stop_services() {
  echo "Stopping services..."
  if [ -f "$PIDFILE_BACKEND" ]; then
    BACKEND_PID=$(cat "$PIDFILE_BACKEND")
    echo "Killing backend PID $BACKEND_PID"
    kill "$BACKEND_PID" || true
    rm -f "$PIDFILE_BACKEND"
  fi
  if [ -f "$PIDFILE_FRONTEND" ]; then
    FRONTEND_PID=$(cat "$PIDFILE_FRONTEND")
    echo "Killing frontend PID $FRONTEND_PID"
    kill "$FRONTEND_PID" || true
    rm -f "$PIDFILE_FRONTEND"
  fi
  echo "Stopped."
}

case "$CMD" in
  start)
    start_services
    ;;
  stop)
    stop_services
    ;;
  restart)
    stop_services
    start_services
    ;;
  *)
    echo "Usage: $0 {start|stop|restart}"
    exit 1
    ;;
esac
