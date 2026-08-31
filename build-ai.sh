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

# Installing is not the same as working.
#
# The first deploy of this installed every wheel successfully and then failed
# at runtime with "libstdc++.so.6: cannot open shared object file" — NumPy's
# compiled extension could not load, because a Nix-provided Python does not put
# the C++ runtime on the loader path. pip reported success throughout, so the
# build was green and the service was dead.
#
# Importing them here is what tells those apart, at the point where the output
# is still being read.
echo "--- Verifying the installed packages actually import ---"
if ! "$VENV"/bin/python -c "
import sklearn, numpy, scipy, fastapi, joblib, rapidfuzz
print('resolved: scikit-learn', sklearn.__version__, '| numpy', numpy.__version__, '| scipy', scipy.__version__)
"; then
  echo ""
  echo "WARNING: the dependencies installed but cannot be imported."
  echo "         This is usually a missing system library rather than a bad"
  echo "         wheel — see nixLibs in nixpacks.toml. The API will start"
  echo "         WITHOUT symptom retrieval; assessments fall back to the rule"
  echo "         engine. Confirm with GET /api/ai/service-status after deploy."
  rm -rf "$VENV"
  exit 0
fi

echo "--- Inference service ready ---"
exit 0
