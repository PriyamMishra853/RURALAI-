#!/usr/bin/env bash
# Start both servers for local development.
#
# Written because restarting the API with `taskkill /IM node.exe` also kills the
# Vite dev server — they are both node, and Windows has no per-process name to
# tell them apart. This starts each one and reports which ports came up, so a
# half-running stack is obvious immediately rather than after a blank page.
set -u

ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="${TMPDIR:-/tmp}"

echo "Stopping anything already on 3000/5000/8001..."
for port in 5000 3000 8001; do
  pid=$(netstat -ano 2>/dev/null | grep "LISTENING" | grep ":$port " | awk '{print $NF}' | head -1)
  [ -n "${pid:-}" ] && taskkill //F //PID "$pid" >/dev/null 2>&1 && echo "  freed port $port (pid $pid)"
done
sleep 2

# The Python inference service owns the trained models. Started first: the API
# probes it at boot, and a race there just means a needless "degraded" log line.
if [ -x "$ROOT/AI/LLM/.venv/Scripts/python.exe" ]; then
  echo "Starting AI inference service (port 8001)..."
  (cd "$ROOT/AI/LLM/service" && nohup ../.venv/Scripts/python.exe -m uvicorn app:app       --host 127.0.0.1 --port 8001 > "$LOG_DIR/vvc-ai.log" 2>&1 < /dev/null &) >/dev/null 2>&1
else
  echo "Skipping AI service — no venv at AI/LLM/.venv (run: python -m venv AI/LLM/.venv)"
fi

echo "Starting backend (port 5000)..."
# stdin/stdout/stderr all redirected, or this script never exits: bash waits
# on any child still holding its terminal open.
(cd "$ROOT/backend" && nohup node src/server.js > "$LOG_DIR/vvc-backend.log" 2>&1 < /dev/null &) >/dev/null 2>&1

echo "Starting frontend (port 3000)..."
(cd "$ROOT/frontend" && nohup npx vite --port 3000 --host > "$LOG_DIR/vvc-frontend.log" 2>&1 < /dev/null &) >/dev/null 2>&1

echo "Waiting for both to answer..."
for i in $(seq 1 30); do
  back=$(curl -s -o /dev/null -w '%{http_code}' -m 3 http://127.0.0.1:5000/api/health 2>/dev/null)
  front=$(curl -s -o /dev/null -w '%{http_code}' -m 3 http://localhost:3000/ 2>/dev/null)
  ai=$(curl -s -o /dev/null -w '%{http_code}' -m 3 http://127.0.0.1:8001/health 2>/dev/null)
  [ "$back" = "200" ] && [ "$front" = "200" ] && [ "$ai" = "200" ] && break
  sleep 1
done

echo
echo "  backend   http://localhost:5000/api   -> ${back:-no answer}"
echo "  frontend  http://localhost:3000       -> ${front:-no answer}"
echo "  AI models http://127.0.0.1:8001       -> ${ai:-no answer}"
echo
if [ "${back:-}" = "200" ] && [ "${front:-}" = "200" ]; then
  [ "${ai:-}" = "200" ] || echo "  (AI models did not answer — assessments will run without disease candidates)"
  echo "All running. Open http://localhost:3000"
else
  echo "Something did not start. Logs:"
  echo "  $LOG_DIR/vvc-backend.log"
  echo "  $LOG_DIR/vvc-frontend.log"
  exit 1
fi
