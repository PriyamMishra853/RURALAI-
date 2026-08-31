#!/usr/bin/env bash
#
# Start the inference service for local development.
#
# Bound to localhost by default: the Node backend is the only client, and the
# models must not be reachable from outside the host. In deployment the same
# app is started by railway.json, which binds 0.0.0.0 because the platform
# terminates the connection — see DEPLOYMENT.md for why that service must not
# be given a public domain.
#
# Runs from the repo's virtualenv if there is one, otherwise whatever `python`
# is on PATH. The previous version hardcoded a Windows venv path, so it only
# ever ran on one machine.
set -euo pipefail

cd "$(dirname "$0")/.."

HOST="${AI_SERVICE_HOST:-127.0.0.1}"
PORT="${AI_SERVICE_PORT:-8001}"

if   [ -x .venv/Scripts/python.exe ]; then PY=.venv/Scripts/python.exe   # Windows
elif [ -x .venv/bin/python ];        then PY=.venv/bin/python            # macOS / Linux
else                                      PY="$(command -v python3 || command -v python)"
fi

exec "$PY" -m uvicorn service.app:app --host "$HOST" --port "$PORT" "$@"
