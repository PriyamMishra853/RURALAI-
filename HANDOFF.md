# RuralAI — Session Handoff

**Read this first in a new context window or on a new machine.**
Current as of the last commit on `main`. Repo: `Ashish42-droid/governor` (private).

---

## 1. ⚠ The only thing that does NOT travel

Everything is committed and pushed. **Except the two `.env` files, which are
gitignored by design.** Nothing else is lost by moving machines.

You must recreate `backend/.env` on the new machine. It holds 21 values:

```
PORT  NODE_ENV  JWT_SECRET  CORS_ALLOWED_ORIGINS
SUPABASE_URL  SUPABASE_ANON_KEY  SUPABASE_SERVICE_ROLE_KEY  DATABASE_URL
GROQ_API_KEY  GEMINI_API_KEY
QDRANT_URL  QDRANT_CLUSTER_ENDPOINT  QDRANT_API_KEY
RESEND_API_KEY  REQUIRE_SIGNED_FORMULARY  SEED_ADMIN_PASSWORD
```

`backend/.env.example` and `frontend/.env.example` list every variable with a
comment. Copy them and fill in.

**Two values exist nowhere else and are gone if you do not copy this file:**

| Value | Why it matters |
|---|---|
| `SEED_ADMIN_PASSWORD` | The only credential for `admin@clinic.org`. Generated locally, never had a default, and is not recoverable. Losing it means re-running `npm run seed:staff` with a new one. |
| `DATABASE_URL` | Still has the **wrong password** — see §6. Not a loss. |

`ZEGOCLOUD_*` and `LIVEKIT_*` are still present in the local `.env` but are
**inert** — both integrations were removed. Do not carry them over.

> **Before anything public: rotate Supabase, Groq, Gemini and Qdrant keys.**
> They were pasted into a chat transcript, and the original `Ashish42-droid/BOB`
> repo published a working `JWT_SECRET` and ZegoCloud secret for its whole life.
> Scrubbing the README does not remove them from git history.

---

## 2. Run it

```bash
cd backend  && npm install
cd ../frontend && npm install && npm run build
cd ../backend && PORT=5055 node src/server.js
```

Open **http://localhost:5055**. The API serves the built frontend from the same
origin, so there is no separate dev server to start and no CORS to configure.

| Role | Email | Password |
|---|---|---|
| Clinic Assistant | `assistant@clinic.org` | `Assist@123` |
| Doctor | `doctor@clinic.org` | `Doctor@123` |
| Admin | `admin@clinic.org` | `SEED_ADMIN_PASSWORD` from `.env` |

The assistant and doctor passwords are hardcoded in `LoginPage.jsx` and ship in
the public bundle. That is acceptable only for throwaway demo accounts. The
admin deliberately does not follow that pattern.

---

## 3. Verification commands

| Command | What it proves |
|---|---|
| `npm test` | 87 tests. Fakes injected — never spends AI quota, never hits the network. |
| `npm run check` | Every external service reachable, and that the configured AI models still exist at their provider. |
| `npm run check:pipelines` | Real input through all 7 pipelines, output inspected. |
| `npm run check:flow` | Full clinical flow over the real HTTP API, with the safety invariants asserted. |
| `npm run seed:staff` | Re-provision demo accounts. `-- --purge` reverses it. |
| `npm run rag:seed` | Re-seed the Qdrant protocol collection. |

**The `check*` scripts are the only places allowed to hit real APIs.** Keep it
that way — twice they caught bugs no unit test could.

Last known state: **87 tests · 8/8 services · 7/7 pipelines · 10/10 flow steps.**

---

## 4. Architecture in one screen

Node/Express API + Supabase Postgres + React/Vite frontend served by the same
Express process. Qdrant for protocol retrieval. Groq for assessment and speech,
Gemini for wound vision. Video is peer-to-peer WebRTC over the app's own
WebSocket — no third-party SDK.

```
backend/src/
  config/      env validation, models.js (ALL model ids live here), supabase, qdrant
  controllers/ one domain per file
  middleware/  auth, RBAC, clinicalAccess (admin lockout), rateLimit, audit
  services/    riskEngine · formularyService · aiOrchestrator · ragEngine
               ocrService · visionService · speechService · signalingService
  data/        formulary.js — the ONLY source of medication
  scripts/     check* scripts and seeders
frontend/src/  pages/ components/ context/ — styling is off-limits unless asked
database/      schema.sql, apply_all.sql, migrations/
docs/          PHASE1_PRODUCTION_READINESS_PLAN.md · PHASE2_PROGRESS.md
```

---

## 5. The invariants. Do not break these.

1. **`final_tier = MAX(rule_tier, vision_tier, model_tier)`.** Deterministic
   rules set a floor. A model may raise a tier and can never lower one.
2. **Degraded AI fails safe to MEDIUM, never LOW.** Timeout, malformed output,
   no model configured — all floor at MEDIUM and set `degraded: true`.
3. **Missing data escalates.** Absent vitals or unknown age raise the tier.
   Absence of evidence is not evidence of absence.
4. **A reading of `0` is a reading.** Never `if (spo2)` — that treats an SpO₂ of
   0 as "not recorded" and skips every red-flag check.
5. **Medicine is never model-authored.** It comes from the signed formulary via
   the rules engine. A medication row with no `rule_source_id` is rejected by a
   database CHECK constraint. LOW tier only.
6. **Nothing is ever fabricated.** No invented transcripts, no default symptoms,
   no guessed doses. An empty result is a valid, safe answer — render it as
   "none", never substitute something plausible.
7. **Admins have no clinical access** — not read, not write. Enforced by a
   router-level guard that fails closed for routes added later.
8. **Clinical records are append-only.** Demo records are flagged, not deleted.

---

## 6. Open items — be honest about these

| Item | Detail |
|---|---|
| **Migration 002 unapplied** | `database/migrations/002_patient_is_demo_flag.sql`. Paste into the Supabase SQL Editor. Until then `is_demo` does not exist, the DEMO badges render nothing, and item 1 of the last brief is **unverified**. |
| **`DATABASE_URL` password is wrong** | Region and username verified correct (`ap-northeast-2`, `postgres.fysndhtjnlxcknompopr`); only the password fails. Reset it in Supabase → Settings → Database. Until then all DDL must go through the SQL Editor. |
| **No TURN server** | Video is peer-to-peer. The two-tab test passed with `host ↔ host` candidates — **no NAT traversal was exercised**. Across two networks the call negotiates and then carries no media, which looks like a frozen black screen, not an error. Needs a TURN credential before any multi-machine demo. |
| **Formulary is UNSIGNED** | The mechanism is built and enforced but every entry is `UNSIGNED_PLACEHOLDER`. **Blocked on a registered medical practitioner, not on code — the longest lead time in the project.** |
| **No RLS policies** | Access control is entirely application-layer. One missing guard is a breach. |
| **`/api/calls` unauthenticated** | Every route in `call.routes.js` runs with no auth guard. |
| **Only 3 protocols seeded** | Demo content from `seedQdrant.js`. A real physician-reviewed MoHFW corpus is still needed. |
| **Dashboard counts include demo records** | All 3 patients in the database are demo records, so the stats panel and the risk-distribution percentages currently describe test data. Whether to exclude them is an open decision. |
| **Helmet CSP disabled** | The default policy blocks the SPA's own bundle. Needs a real per-directive policy. |
| **Rate limiting is in-memory** | Per-process, so behind N instances the real limit is N×. |

---

## 7. Working agreements from these sessions

- **Alter the existing codebase in place.** Do not scaffold the `RuralAI/`
  structure from the original Phase 2 brief.
- **Do not change the frontend palette, spacing or component styling** unless
  explicitly asked. It should not look AI-generated.
- **Never fabricate data as real.** Placeholder rows are labelled
  `PLACEHOLDER_DEMO` and demo phone numbers are `+91-00000-xxxxx` so they cannot
  dial a real person.
- **Watch for checks that pass because the thing they test never ran.** Two
  occurred in these sessions: a Supabase `head: true` count reported an empty
  database as healthy, and a constraint probe passed on `23502` (not-null)
  instead of `23514` (check). Both looked green while proving nothing.
- **Verify before claiming.** Every "done" in `docs/PHASE2_PROGRESS.md` has a
  command or a measurement behind it.
