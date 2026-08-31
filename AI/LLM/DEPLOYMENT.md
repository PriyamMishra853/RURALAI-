# Deploying the inference service

The Node backend calls this service for three things: ranked disease candidates
from recorded symptoms, dataset-sourced precautions, and real Indian medicine
availability.

**It has never run in production.** `aiInferenceClient` reads `AI_SERVICE_URL`
and falls back to `http://127.0.0.1:8001`; that variable was never set, and the
backend's Railway service starts only `cd backend && npm start`. Every call
therefore failed.

It failed *quietly*, which is why this looked like poor model output rather
than a missing deployment: a circuit breaker opens after the first failure,
each call returns `null`, and the callers correctly treat `null` as "no
candidates" rather than "no disease". The assessment still rendered, so nothing
appeared broken — it was simply running without its retrieval step.

## What runs

Verified locally against the committed artifacts:

```
GET  /health                  → models loaded, metrics, training metadata
POST /diagnose                → ranked candidates  (aiOrchestrator)
GET  /precautions/{disease}   → precaution list    (tierWorkflowService)
POST /medicine-availability   → products + prices  (formulary enrichment)
```

The symptom model reports top-1 0.85 / top-5 0.97 over 582 diseases. The
model artifacts are committed under `AI/LLM/data/models/`, so a deploy needs no
training step and no dataset download.

## Railway setup

1. **New service** in the same Railway project, from the same repository.
2. **Settings → Root Directory:** `AI/LLM`
   Railway then picks up `requirements.txt` and `railway.json` from this
   directory. The start command and the `/health` check are already in
   `railway.json`; `$PORT` is supplied by Railway, so do not hardcode 8001.
3. **Do NOT generate a public domain for this service.**
   It answers clinical queries and has no authentication of its own — it was
   written on the assumption that only the backend can reach it. Leave it on
   the private network.
4. **On the backend service**, set:

   ```
   AI_SERVICE_URL=http://<ai-service-name>.railway.internal:<port>
   ```

   Railway's private DNS resolves `*.railway.internal` between services in one
   project. Take the exact host and port from the AI service's Settings →
   Networking → Private Network.
5. **Redeploy the backend** so it picks up the variable.

## Confirming it worked

The backend logs a warning on every failed call, so absence of

```
AI service /diagnose unreachable: ...
```

is the first signal. To check positively, the assessment response gains
retrieval-backed candidates rather than falling through to the rule engine
alone.

The service's own `/health` returns `models.symptom_diagnosis: true` and a
`meta` block naming the training run. If `symptom_diagnosis` is `false`, the
model artifacts did not deploy — check that `AI/LLM/data/models/` is present in
the build, since that directory is the whole reason no training step is needed.

## Cost note

This service loads a scikit-learn model and a medicine index into memory at
startup. It is small, but it is a second always-on container. If that is not
wanted, the alternative is removing the dependency entirely and accepting the
rule engine alone — the callers already degrade to exactly that, which is what
production has been doing all along.
