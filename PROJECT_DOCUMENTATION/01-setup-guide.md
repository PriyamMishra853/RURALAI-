# 01 — Setup Guide

> **Navigation:** [Index](README.md) · Previous: [00 — Project Overview](00-project-overview.md) · Next: [02 — Dependencies](02-dependencies.md)

Written to be followable by someone who has never seen this repository. Every
command is copy-pasteable. **No real credential value appears anywhere in this
file** — only variable names and what each one is for.

---

## 1. Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | **≥ 22.0.0** | `backend/package.json` `engines.node`. Node 22 provides a native `WebSocket` global; `config/supabase.js` polyfills it from `ws` for older runtimes, but 22 is what the code targets |
| npm | ships with Node | — |
| Python | **3.11** | `nixpacks.toml` pins `python311` for the deployed image. The inference service needs scikit-learn wheels that resolve cleanly on this version |
| Git | any recent | — |
| A POSIX shell | bash / Git Bash / WSL | `start.sh`, `build-ai.sh` and `AI/LLM/service/run.sh` are bash scripts |

You also need accounts for the hosted services in §3. All of them have free
tiers sufficient to run the platform.

---

## 2. Clone

```bash
git clone https://github.com/PriyamMishra853/RURALAI-.git
cd RURALAI-
```

Repository layout at a glance (full annotated tree in
[05 — Directory Structure](05-directory-structure.md)):

```
backend/     Express API, services, controllers, seed and check scripts
frontend/    React + Vite single-page application
database/    v2 schema, RLS policies and migrations
AI/LLM/      Python inference service, training scripts, model artifacts
```

---

## 3. External services to provision

| Service | What it provides here | Required? |
|---|---|---|
| **Supabase** | Postgres, Auth (passwords), and Storage (the private `injury-photos` bucket) | **Yes.** The clinical path cannot degrade past it |
| **Groq** | Assessment synthesis (`openai/gpt-oss-120b`) and speech-to-text (`whisper-large-v3-turbo`) | Yes for AI features; the platform runs degraded without it |
| **Google AI Studio (Gemini)** | Wound-photo vision, document OCR, health-card reading | Yes for vision/OCR; OCR falls back to Tesseract |
| **Qdrant Cloud** | Vector store for the approved clinical protocol corpus | Optional — retrieval degrades to zero protocols |
| **Resend** | Staff account invitation email | Optional |
| **A TURN provider** | WebRTC relay for calls across different networks | Strongly recommended — see §9 |
| **Kaggle** | Only to re-download the training datasets | Optional. Model artifacts are committed |

### 3.1 Supabase setup

1. Create a project. Note the **Project URL**, the **anon key**, the
   **service-role key**, and the **connection string (URI)** from
   *Project Settings → Database*.
2. Create a Storage bucket named exactly **`injury-photos`**, and set it to
   **private**. `npm run preflight` asserts both the name and `public === false`.
   Wound photographs are clinical images of identifiable patients; a public
   bucket means anyone holding the URL can view them indefinitely with no
   authentication.

---

## 4. Environment variables

Two files. Both are gitignored (`.gitignore` lines 8–10). Copy the examples and
fill them in.

```bash
cp backend/.env.example  backend/.env
cp frontend/.env.example frontend/.env
```

### 4.1 `backend/.env`

Read by `backend/src/config/env.js`, which validates several of these at boot.

#### Core

| Variable | Purpose | Notes |
|---|---|---|
| `PORT` | HTTP port | Defaults to `5000` |
| `NODE_ENV` | `development` or `production` | Production enables several refuse-to-start checks below |
| `JWT_SECRET` | Signs API session tokens | Generate with `openssl rand -base64 48`. **In production the server refuses to start** if it is missing, shorter than 32 characters, or one of two values previously committed to a public repo (`KNOWN_LEAKED_SECRETS` in `env.js`). In development a random secret is generated per boot instead, so there is no fixed value to leak — tokens simply do not survive a restart |
| `CORS_ALLOWED_ORIGINS` | Comma-separated origin allowlist | **Required in production**; the server refuses to start without it. A wildcard is never accepted, because `*` lets any website drive the API using a signed-in user's browser. In development it defaults to localhost on ports 3000/5000/5173 and the app's own port |

#### Supabase

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | Public key; used for the password sign-in call and subject to RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-only.** Bypasses all row-level security. Never expose to a browser |
| `DATABASE_URL` | Direct Postgres connection string. Needed by `db:apply`, `seed` and `seed:root`, because the REST API cannot run DDL |

In production, `env.js` refuses to start when `SUPABASE_URL` or
`SUPABASE_SERVICE_ROLE_KEY` is missing — a missing service key otherwise means
every patient write fails at runtime rather than at boot, which is a far worse
way to find out.

#### AI providers

| Variable | Purpose |
|---|---|
| `GROQ_API_KEY` | Primary Groq key |
| `Groq_API_Key1`, `Groq_API_Key2`, `Groq_API_Key3` | Optional additional keys. `keyPool.js` reads all four names, collapses duplicates, round-robins across them, benches a key on 429 and retires it permanently on 401/403. Several assistants running assessments at once will exhaust a single key almost immediately |
| `GEMINI_API_KEY` | Google AI Studio key for vision and OCR |
| `GROQ_TEXT_MODEL` | Optional override. Default `openai/gpt-oss-120b` |
| `GROQ_SPEECH_MODEL` | Optional override. Default `whisper-large-v3-turbo` |
| `GEMINI_VISION_MODEL` | Optional override. Default `gemini-3.6-flash` |
| `GEMINI_VISION_FALLBACKS` | Optional comma-separated chain. Default `gemini-3.6-flash,gemini-3.5-flash,gemini-3.1-flash-lite`. Gemini free-tier quota is **per model**, so a chain is what stops one exhausted model silently disabling every wound photo |

Model ids live in `backend/src/config/models.js` and nowhere else, so a provider
decommissioning a model is a config change rather than a code change.

#### Retrieval

| Variable | Purpose |
|---|---|
| `QDRANT_CLUSTER_ENDPOINT` | Preferred. The name the Qdrant Cloud console uses |
| `QDRANT_URL` | Fallback name. `env.js` prefers `QDRANT_CLUSTER_ENDPOINT` because `QDRANT_URL` has been left pointing at a decommissioned cluster before |
| `QDRANT_API_KEY` | Qdrant Cloud API key |

#### Inference service

| Variable | Purpose |
|---|---|
| `AI_SERVICE_URL` | Where the Python service listens. Defaults to `http://127.0.0.1:8001`, which is correct when `start.sh` runs both halves in one container |
| `AI_SERVICE_TIMEOUT_MS` | Per-call timeout. Default `6000` |
| `AI_SERVICE_PORT` | Port for `start.sh` to launch uvicorn on. Default `8001` |
| `AI_SERVICE_LOG` | File the service's own output is tee'd to, so `GET /api/ai/service-status` can show why it died. Default `/tmp/ai-service.log` |

#### Clinical safety

| Variable | Purpose |
|---|---|
| `REQUIRE_SIGNED_FORMULARY` | When `true` (**the default in production**), no medication is emitted at all until every formulary entry is signed by a registered practitioner. Set to `false` only to demonstrate the mechanism against placeholder data |

#### Video

| Variable | Purpose |
|---|---|
| `VIDEO_PROVIDER` | Optional. `p2p` or `mediasoup` to pin one explicitly. Unset means auto-select |
| `TURN_URL` | Comma-separated TURN URLs. Providers issue several for one credential — UDP, TCP, and 443 for networks that only allow HTTPS-looking traffic |
| `TURN_USERNAME`, `TURN_CREDENTIAL` | TURN credentials |
| `MEDIASOUP_ANNOUNCED_IP` | Only if running the SFU. **Required behind NAT/Docker** — without it peers negotiate a private address and the call connects but carries no media |
| `MEDIASOUP_MIN_PORT`, `MEDIASOUP_MAX_PORT`, `MEDIASOUP_WORKERS` | SFU RTC port range and worker count |

#### Optional

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` | Staff account invitation email |
| `GOOGLE_MAPS_API_KEY` | Upgrades referral straight-line distance to live driving distance. Entirely optional — the straight-line answer is computed first and stands if the call fails |
| `DEMO_ACCOUNT_PASSWORD` | Shared password for seeded demo accounts. Written to a gitignored credentials file, never compiled into the frontend bundle |
| `ROOT_ADMIN_EMAIL`, `ROOT_ADMIN_PASSWORD`, `ROOT_ADMIN_NAME` | Passed at provision time for `npm run seed:root`. There is deliberately no default — a super admin with a known password is the same as no password |
| `KAGGLE_USERNAME`, `KAGGLE_KEY` | Only to re-download the training datasets |
| `BACKEND_URL`, `WS_URL` | Cosmetic; used only in the startup banner |

### 4.2 `frontend/.env`

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | Base path for API calls. Leave as `/api` when the backend serves the built app from the same origin |
| `VITE_REALTIME_URL` | Optional explicit WebSocket override. Normally omit it: `RealtimeContext.jsx` derives the socket host from `VITE_API_URL`, then from the page's own origin. The scheme is always taken from the page, never from configuration, because an HTTPS document may not open a `ws://` socket |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Supabase project for browser-side realtime subscriptions. The anon key belongs in the bundle by design; RLS protects the data. If unset, `config/supabase.js` exports a no-op client so a missing `.env` degrades realtime rather than white-screening the app |
| `VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL` | Client-side TURN. See §9 |
| `VITE_DEMO_MODE` | `true` shows seeded assistant/doctor **emails** as clickable hints on the sign-in page. Passwords are never included and admin accounts are never listed. Leave unset for any real deployment |
| `VITE_DEMO_ASSISTANT_EMAIL`, `VITE_DEMO_DOCTOR_EMAIL` | The emails shown when demo mode is on |

> **Known issue you must handle.** `frontend/src/services/api.js` currently sets
> `baseURL` to a **hardcoded** deployed URL and ignores `VITE_API_URL`. To run
> against a local backend, change that one line to
> `import.meta.env.VITE_API_URL || '/api'`. Tracked as
> [L10](16-known-limitations-and-risks.md#l10).

---

## 5. Install dependencies

```bash
cd backend  && npm install
cd ../frontend && npm install
cd ..
```

Python inference service:

```bash
python -m venv AI/LLM/.venv

# Linux / macOS
AI/LLM/.venv/bin/pip install -r AI/LLM/requirements.txt

# Windows
AI/LLM/.venv/Scripts/pip.exe install -r AI/LLM/requirements.txt
```

Or run `bash ./build-ai.sh`, which does the same and additionally **imports every
package to confirm it actually works**. That distinction matters: the first
deploy of this installed every wheel successfully and then failed at runtime with
`libstdc++.so.6: cannot open shared object file`, because a Nix-provided Python
does not put the C++ runtime on the loader path. pip reported success
throughout, so the build was green and the service was dead. `build-ai.sh` exits
`0` even on failure and deletes the half-built virtualenv, so a dependency
problem costs the retrieval step rather than the whole deploy.

---

## 6. Database migration order

**This is the part most likely to go wrong. Run the files in exactly this order.**

`npm run db:apply` is destructive: it drops every table in the public schema and
rebuilds it. It refuses to run without `--confirm` and prints the target
hostname first.

```bash
cd backend
npm run inspect                  # what is in the target right now
npm run db:apply -- --confirm    # DESTRUCTIVE
```

`applyV2.js` discovers every `NN_*.sql` file in `database/v2/` and runs them in
order — it no longer carries a hand-maintained list, so adding a migration file
is enough to have it applied:

| # | File | What it does |
|---|---|---|
| 1 | `database/v2/01_reset.sql` | Drops all v1 tables and enum types |
| 2 | `database/v2/02_schema.sql` | 14 core tables, 9 enums, indexes, `touch_updated_at()` triggers |
| 3 | `database/v2/03_rls.sql` | Enables RLS on 14 tables; ~40 policies; 6 `SECURITY DEFINER` helper functions |
| 4 | `database/v2/04_visit_history.sql` | Adds `medical_history`, `known_allergies`, `symptom_duration_value`, `symptom_duration_unit` to `visits` |
| 5 | `database/v2/05_consultations.sql` | `doctor_schedules`, rebuilt `consultations` with the state machine, `notifications`, the two partial unique indexes |
| 6 | `database/v2/06_patient_images.sql` | `patient_images`; adds `DOCTOR_REVIEW_COMPLETED` to the notification enum; opens review and prescription reads to the visit's assistant |

It then continues through the rest of the directory:

| # | File | What it does | Note |
|---|---|---|---|
| 7 | `07_case_handoff.sql` | Adds `CASE_ASSIGNED` to the `notification_event` enum | Runs **outside** a transaction — `ALTER TYPE … ADD VALUE` cannot run inside one. The file has no `BEGIN` for this reason |
| 8 | `08_visit_soft_delete.sql` | Adds `deleted_at`, `deleted_by`, `deletion_reason` to `visits`, plus a partial index on live rows | |
| 9 | `09_emergency_registration.sql` | Makes five identity columns nullable and adds a conditional CHECK so only `emergency_bypass` may omit them | |
| 10 | `10_admin_analytics.sql` | Creates `admin_analytics(scope_state, scope_district)` | Without it `GET /api/admin/analytics` returns 500 |
| 11 | `11_referral_audit.sql` | Creates `referrals` with its indexes, RLS and the `referrals_via_district` policy | Without it the emergency referral screen still works, but writes no audit row |

To apply one by hand instead — into an already-built database, say:

```bash
psql "$DATABASE_URL" -f database/v2/11_referral_audit.sql
```

### Do **not** run these

| Path | Why |
|---|---|
| `database/schema.sql`, `database/apply_all.sql` | **v1.** Superseded entirely by `database/v2/`. Kept for historical reference only |
| `database/seed.sql` | v1 seed data |
| `database/migrations/001_medication_rule_source.sql` | Targets `ai_recommendations`, a table v1 had and v2 dropped |
| `database/migrations/002_patient_is_demo_flag.sql` | Adds `patients.is_demo`, which `02_schema.sql` already includes, and backfills by a `patients.id` column that no longer exists (v2 keys on `aadhaar_number`) |

---

## 7. Seeding

```bash
cd backend
npm run seed          # demo regions, staff, patients, visits
npm run seed:schedules # doctor working hours — without these every date reads "Closed"
npm run seed:daily     # deterministic 5 cases per doctor for today
npm run rag:seed       # 3 clinical protocols into Qdrant
```

What `npm run seed` produces (`seedV2.js`):

| | |
|---|---:|
| States and union territories | 36 |
| Districts (Uttar Pradesh) | 75 |
| Doctors (5 per district) | 375 |
| Clinic assistants (1 per district) | 75 |
| District admins | 8 |
| State admins | 1 |
| Patients (5 per doctor) | 1,875 |
| Visits, risk-tiered over 7 days | 1,875 |

Every row carries `is_demo = true`, and re-running clears the previous demo rows
and their Supabase Auth users first, so it is safe to run repeatedly. Demo
Aadhaar numbers all begin with `0`; UIDAI allocates real numbers from 2–9, so
seeded values satisfy the 12-digit constraint while being structurally incapable
of colliding with a real person's number. Demo emails use
`@vvc-demo.example.com` (RFC 2606 reserved), so they cannot reach a real inbox.

Sign-ins are written to `database/v2/DEMO_CREDENTIALS.md`, which is gitignored.

### Your own super admin

Never seeded, never in the repository, never in the frontend bundle:

```bash
ROOT_ADMIN_EMAIL=you@example.com \
ROOT_ADMIN_PASSWORD='a long unique password' \
npm run seed:root
```

Re-running with the same email rotates the password rather than failing. The
minimum length is 12 characters and there is no default.

### Rotating the shared demo password

```bash
npm run rotate:demo                  # generate a new one
npm run rotate:demo -- 'YourChoice'  # set a specific one
```

Only accounts on `@vvc-demo.example.com` are touched. The super admin is never
in scope.

---

## 8. Running locally

### Option A — one process, production-shaped (recommended)

The API serves the built frontend from the same origin, so there is no separate
dev server and no CORS to configure.

```bash
cd frontend && npm run build && cd ..
bash ./start.sh
```

`start.sh` starts uvicorn on `127.0.0.1:8001` in the background, then `exec`s
the Node server in the foreground. It deliberately does **not** use `set -e`: if
the inference service cannot start, the clinic must still register patients, run
consultations and hand cases to doctors — so a Python failure costs the retrieval
step, not the platform. Open `http://localhost:5000`.

### Option B — three services, with hot reload

```bash
bash ./start-dev.sh
```

Frees ports 3000/5000/8001, starts the inference service, the backend and the
Vite dev server, and reports which came up. Logs go to `$TMPDIR`.

Or start each by hand:

```bash
# Terminal 1 — inference service (127.0.0.1:8001)
bash AI/LLM/service/run.sh

# Terminal 2 — API (:5000)
cd backend && npm run dev

# Terminal 3 — frontend (:3000)
cd frontend && npm run dev
```

> `vite.config.js` proxies `/api` and `/realtime` to a **deployed** backend by
> default. To develop against your local API, change those two `target` values to
> `http://localhost:5000` and `ws://localhost:5000`, and fix the `api.js`
> `baseURL` noted in §4.2.

### Verify it came up

```bash
cd backend
npm test              # 135 tests, 9 suites. No network, no AI quota spent
npm run check         # every external service reachable, and the configured models still exist
npm run check:ai      # real input through the OCR, lab and vision pipelines
npm run preflight     # is the system demo-ready right now?
```

`npm run check` and `npm run check:ai` are the **only** places allowed to make
real API calls. Keep it that way — twice they caught bugs no unit test could,
including a Gemini model that was still listed by its provider months after
`generateContent` started returning 404 for new keys.

`npm run preflight` checks the six things that fail *silently*: empty
`doctor_schedules` (every booking date reads "Closed"), no cases assigned for
today, the deterministic five-case queues, the inference service, the private
`injury-photos` bucket, and the `CASE_ASSIGNED` enum value.

---

## 9. TURN — read this before any multi-machine demo

Video is peer-to-peer. STUN alone is enough when both parties can reach each
other directly. It is **not** enough across carrier-grade NAT, which is the
normal case on a rural mobile ISP, or across restrictive venue wifi. Without a
relay the call negotiates successfully and then carries no media — which looks
like a frozen black screen, not an error.

`P2PProvider.js` falls back to Metered's free public **Open Relay** service when
`TURN_URL` is unset, and logs a warning once. Calls will connect, but on a shared
free tier with no capacity guarantee. A TURN server forwards DTLS-SRTP it cannot
decrypt, so it does not expose consultation media to the relay operator.

Set `TURN_URL` / `TURN_USERNAME` / `TURN_CREDENTIAL` (backend) and the matching
`VITE_TURN_*` (frontend) to a dedicated service for anything real. `npm run
check` reports an unset `TURN_URL` as a non-fatal warning.

---

## 10. Production deployment

### Current production shape

One Railway service runs the whole platform: Express API + built React SPA +
Python inference service on loopback, backed by one Supabase project.

`railway.json`:

```json
{
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "cd backend && npm install && cd ../frontend && npm install && npm run build && cd .. && bash ./build-ai.sh"
  },
  "deploy": {
    "startCommand": "bash ./start.sh",
    "healthcheckPath": "/api/health",
    "healthcheckTimeout": 300,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

`nixpacks.toml` provides `nodejs_20` and `python311`, and — importantly —
`nixLibs = ['stdenv.cc.cc.lib', 'zlib']`. NumPy, SciPy and scikit-learn ship
manylinux wheels containing compiled extensions that link against the system C++
runtime. A Nix-provided Python does not put that runtime on the loader path, so
the wheels install perfectly and then fail at import. `nixLibs` adds them to
`LD_LIBRARY_PATH` for the built image.

### Deployment steps

1. Create a Railway project from the repository. Nixpacks is detected
   automatically.
2. Set every variable from §4.1 in the Railway environment. In particular:
   - `NODE_ENV=production`
   - `JWT_SECRET` — 48 bytes of randomness; the server refuses to boot otherwise
   - `CORS_ALLOWED_ORIGINS` — the exact origins the frontend is served from
   - `REQUIRE_SIGNED_FORMULARY=true`
3. Apply the database migrations (§6), including 07–10.
4. Seed (§7), and provision your own super admin.
5. Deploy. Railway health-checks `/api/health`.

### Confirming the deploy worked

In the deploy logs, near the top, you should see:

```
Inference service starting on 127.0.0.1:8001 (pid ...)
```

then, from the Python service itself, `Application startup complete.`

If instead you see `WARNING: AI/LLM/.venv not found`, the build's pip step did
not produce the virtualenv — check the build log for the `python3 -m venv` and
`pip install` lines.

Once signed in as an administrator, `GET /api/ai/service-status` reports whether
the inference service is reachable, and when it is not, distinguishes *"the
virtualenv is absent, so the build could not install the dependencies"* from
*"dependencies installed but the service failed at startup"* — those need
opposite fixes, and `fetch failed` is the same message for both. It also returns
the tail of the service's own log.

### Alternative: split frontend and backend

`frontend/vercel.json` contains a working Vercel configuration that builds the
SPA and rewrites `/api/*` to a Railway backend. If you use it, you must set
`CORS_ALLOWED_ORIGINS` on the backend to include the Vercel origin, and update
the rewrite target and the `api.js` `baseURL` to your own backend. The
single-origin deployment in §10 avoids all of this and is what production
currently runs.

---

## 11. Re-training the model (optional)

Model artifacts are **committed**, so no deploy or clone needs this. To
reproduce them from scratch:

```bash
# Kaggle credentials go in backend/.env as KAGGLE_USERNAME and KAGGLE_KEY
AI/LLM/.venv/bin/python AI/LLM/training/check_kaggle.py   # confirm auth first
AI/LLM/.venv/bin/python AI/LLM/training/download.py       # ~223 MB, gitignored
AI/LLM/.venv/bin/python AI/LLM/training/inspect_datasets.py
AI/LLM/.venv/bin/python AI/LLM/training/train_symptom_diagnosis.py
AI/LLM/.venv/bin/python AI/LLM/training/build_medicine_index.py
```

Run the matcher regression suite afterwards:

```bash
cd AI/LLM && ../.venv/bin/python -m pytest eval/ -v
```

Details of what each script does, and what the numbers mean, are in
[11 — AI Model Training](11-ai-model-training.md).

---

## 12. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Server refuses to start: "JWT_SECRET is not set" | Production boot check | Generate one: `openssl rand -base64 48` |
| Server refuses to start: "CORS_ALLOWED_ORIGINS is not set" | Production boot check | List the exact frontend origins |
| Every booking date reads "Closed" | `doctor_schedules` is empty. A missing row means "not working that day" — the engine is correct | `npm run seed:schedules` |
| `GET /api/admin/analytics` returns 500 | `admin_analytics()` function missing | Apply `database/v2/10_admin_analytics.sql` |
| Case handoff fails | `CASE_ASSIGNED` missing from the enum | Apply `database/v2/07_case_handoff.sql` |
| Emergency registration rejected | Identity columns still `NOT NULL` | Apply `database/v2/09_emergency_registration.sql` |
| Wound photos analysed but never visible to the doctor | `injury-photos` bucket missing or public | Create it, private. `npm run preflight` checks both |
| Assessments have no disease candidates | Inference service down | Check `GET /api/ai/service-status` as an admin |
| Video connects but shows a black screen | No TURN relay across NAT | Configure `TURN_URL` — §9 |
| `npm run check` reports a model unavailable | Provider decommissioned it | Change `GROQ_TEXT_MODEL` / `GEMINI_VISION_MODEL` in the environment; ids live only in `config/models.js` |
| Frontend calls the wrong backend | `api.js` `baseURL` is hardcoded | See §4.2 |
