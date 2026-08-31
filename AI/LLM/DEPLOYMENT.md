# The inference service in production

The Node backend calls this service for three things: ranked disease candidates
from recorded symptoms, dataset-sourced precautions, and real Indian medicine
availability.

**It runs inside the same container as the API.** There is no second Railway
service and nothing to configure: `aiInferenceClient` looks for
`http://127.0.0.1:8001` when `AI_SERVICE_URL` is unset, and `start.sh` starts
uvicorn on exactly that address before handing off to Node. Loopback is also
where this service belongs — it has no authentication of its own, and inside
one container "only the backend can reach it" is literally true.

## Why it was never running

`AI_SERVICE_URL` was unset, so the client dialled `127.0.0.1:8001` — but
nothing was listening, because Railway's start command was
`cd backend && npm start` and the Python service was never launched.

It failed *quietly*, which is why this looked like poor model output rather
than a missing process: a circuit breaker opens after the first failure, each
call returns `null`, and the callers correctly treat `null` as "no candidates"
rather than "no disease". The assessment still rendered — without its retrieval
step.

## How it starts now

`railway.json` builds both halves and runs `bash ./start.sh`, which:

1. starts `uvicorn service.app:app` on `127.0.0.1:8001` in the background,
2. `exec`s the Node server in the foreground.

`start.sh` deliberately does **not** use `set -e`. If the inference service
cannot start, the clinic must still register patients, run consultations and
hand cases to doctors — so a Python failure costs the retrieval step, not the
platform. The script says so in its log rather than failing silently.

The Python dependencies install into `AI/LLM/.venv` during the build, because
the Nix store is read-only and pip cannot install into the interpreter that
`nixPkgs` provides.

## Deploying

Push to `main` and redeploy on Railway. No new service, no new variables.

The build takes longer than before — it now installs Python packages as well as
two npm trees and a Vite build.

## Confirming it worked

In the deploy logs, near the top:

```
Inference service starting on 127.0.0.1:8001 (pid ...)
```

Then, from the Python service itself, `Application startup complete.`

If instead you see:

```
WARNING: AI/LLM/.venv/bin/python not found — the inference service will not run.
```

the build's pip step did not produce the virtualenv — check the build log for
the `python3 -m venv` and `pip install` lines.

The backend logs a warning on every failed call, so a recurring

```
AI service /diagnose unreachable: ...
```

means the process died after starting. Its own output is in the same log
stream.

## What runs

Verified locally against the committed artifacts, driven through `start.sh` and
called through the real Node client:

```
GET  /health                  → models loaded, metrics, training metadata
POST /diagnose                → ranked candidates  (aiOrchestrator)
GET  /precautions/{disease}   → precaution list    (tierWorkflowService)
POST /medicine-availability   → products + prices
```

The symptom model reports top-1 0.85 / top-5 0.97 over 582 diseases. Its
artifacts are committed under `AI/LLM/data/models/`, so a deploy needs no
training step and no dataset download. If `/health` reports
`symptom_diagnosis: false`, that directory did not reach the image.

## Local development

`AI/LLM/service/run.sh` starts just the inference service against the repo's
virtualenv, on `127.0.0.1:8001`. Or run `./start.sh` from the repo root to
bring up both exactly as production does.

## Cost note

This adds a scikit-learn model and a medicine index to the API container's
memory. It is small, but it is not free. The alternative is dropping the
dependency and accepting the rule engine alone — which is what production has
been doing unintentionally all along.
