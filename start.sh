#!/usr/bin/env bash
#
# Production entrypoint: the inference service and the API in one container.
#
# The Node backend already looks for the inference service at
# http://127.0.0.1:8001 when AI_SERVICE_URL is unset, so running it here on
# loopback needs no configuration at all — and loopback is where it should be.
# The service has no authentication of its own; it was written on the
# assumption that only the backend can reach it, and inside this container that
# is literally true.
#
# `set -e` is deliberately NOT used. If the inference service cannot start, the
# clinic must still be able to register patients, run consultations and hand
# cases to doctors. The Node client already degrades correctly — a failed call
# returns null and the callers treat that as "no candidates", never "no
# disease" — so a Python problem costs the retrieval step, not the platform.
set -uo pipefail

cd "$(dirname "$0")"

AI_PORT="${AI_SERVICE_PORT:-8001}"

# The deployed container is Linux; the Windows path is here so this same script
# can be run locally, rather than only being exercised for the first time in
# production.
if   [ -x AI/LLM/.venv/bin/python ];        then AI_PY=AI/LLM/.venv/bin/python
elif [ -x AI/LLM/.venv/Scripts/python.exe ]; then AI_PY=AI/LLM/.venv/Scripts/python.exe
else AI_PY=""
fi

if [ -n "$AI_PY" ]; then
  AI_PY_ABS="$PWD/$AI_PY"
  # Tee'd to a file as well as the container log so /api/ai/service-status can
  # show why it died. Without that, diagnosing a crash needs log access that
  # whoever is looking at the running system may not have.
  AI_LOG="${AI_SERVICE_LOG:-/tmp/ai-service.log}"
  (
    cd AI/LLM
    exec "$AI_PY_ABS" -m uvicorn service.app:app --host 127.0.0.1 --port "$AI_PORT"
  ) 2>&1 | tee "$AI_LOG" &
  AI_PID=$!
  echo "Inference service starting on 127.0.0.1:${AI_PORT} (pid ${AI_PID})"

  # Stop it with the container rather than leaving it orphaned.
  trap 'kill "$AI_PID" 2>/dev/null || true' EXIT INT TERM
else
  echo "WARNING: AI/LLM/.venv not found — the inference service will not run."
  echo "         The build step could not install its dependencies; see build-ai.sh output."
  echo "         Symptom retrieval and precautions will be unavailable; the"
  echo "         rule engine still produces an assessment."
fi

cd backend
exec node src/server.js
