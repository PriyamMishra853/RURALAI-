#!/usr/bin/env bash
#
# Build step for the inference service.
#
# This exits 0 even when it fails, on purpose.
#
# The clinic's core work — registering patients, running consultations, handing
# cases to doctors — does not depend on the Python service. The Node client
# already degrades correctly when it is absent, treating a failed call as "no
# candidates" rather than "no disease". So a dependency that will not resolve
# should cost the retrieval step, not the entire platform.
#
# Before this, a pip failure failed the whole Railway build and took the
# backend down with it: a resolver problem in an optional subsystem became a
# clinical outage. The failure is loud in the build log and visible afterwards
# at /api/ai/service-status, which is where it belongs.
set -u

VENV="AI/LLM/.venv"

echo "--- Building inference service dependencies ---"

if ! python3 -m venv "$VENV"; then
  echo "WARNING: could not create $VENV — the inference service will not run."
  echo "         The API will start; symptom retrieval and precautions will be unavailable."
  exit 0
fi

if ! "$VENV"/bin/pip install --no-cache-dir -r AI/LLM/requirements.txt; then
  echo ""
  echo "WARNING: inference service dependencies failed to install."
  echo "         The API will start WITHOUT symptom retrieval and precautions."
  echo "         Assessments fall back to the rule engine, which is a real"
  echo "         degradation but not an outage. Check the resolver output above,"
  echo "         then confirm with GET /api/ai/service-status after deploy."
  # Remove the half-built virtualenv so start.sh reports it as absent rather
  # than launching a uvicorn that cannot import its own dependencies.
  rm -rf "$VENV"
  exit 0
fi

echo "--- Inference service dependencies installed ---"
"$VENV"/bin/python -c "import sklearn, numpy, scipy, fastapi; print('resolved:', 'scikit-learn', sklearn.__version__, '| numpy', numpy.__version__, '| scipy', scipy.__version__)" || true
exit 0
