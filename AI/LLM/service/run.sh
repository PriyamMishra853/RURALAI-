#!/usr/bin/env bash
# Start the inference service. Bound to localhost: the Node backend is the only
# client, and the models must not be reachable from outside the host.
cd "$(dirname "$0")"
exec ../.venv/Scripts/python.exe -m uvicorn app:app --host 127.0.0.1 --port 8001 "$@"
