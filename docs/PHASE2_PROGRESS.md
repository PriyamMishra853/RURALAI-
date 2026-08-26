# Phase 2 — Build Progress

Implementation log against [`PHASE1_PRODUCTION_READINESS_PLAN.md`](PHASE1_PRODUCTION_READINESS_PLAN.md).

**Approach:** alter the existing codebase in place. The hackathon `backend/` +
`frontend/` layout is kept; the `RuralAI/`-style scaffold described in the
Phase 2 brief is **not** being created, per the owner's instruction on
2026-08-26. The frontend visual design — palette, spacing, component styling —
is off-limits unless a change is explicitly requested.

**Patient identity:** the codebase never stored Aadhaar. `patients.abha_number`
is optional and stays. No further action needed on §0.3.

---

## Batch 1 — Triage safety core ✅

Plan §D.6. The rule engine already overrode the LLM's tier, but three
invariants were not held.

| Defect | Was | Now |
|---|---|---|
| **Missing data did not escalate** | A visit with no vitals recorded returned **LOW**, with the reasoning "Vitals within standard physiological ranges" — a statement about readings nobody took | Each absent core vital is named, and the tier is floored at **MEDIUM**. LOW now requires SpO₂, temperature, blood pressure, pulse and age all present and in range |
| **A reading of `0` was treated as absent** | `if (spo2 && spo2 < 90)` — an SpO₂ of 0 from a device fault or a peri-arrest patient skipped every red-flag check | `toNumber()` distinguishes absent from zero. `0` triggers immediate referral |
| **Celsius was read as Fahrenheit** | Every threshold is °F. A recorded `39` (°C, a real fever) read as 39 °F and cleared every threshold → **LOW** | Readings below 45 are converted, and the conversion is surfaced in the warnings |
| **Degraded AI did not fail safe** | A Groq outage, timeout or off-schema response kept whatever the rules produced, including LOW | Any degraded path floors the tier at **MEDIUM** and sets `degraded: true` |
| **The model could not raise the tier** | The LLM's `risk_level` was discarded entirely | `final = MAX(rule, vision, model)`. The model may raise and can never lower |

Also added: age-banded IMNCI rule — any fever in an infant under 2 months is an
immediate referral.

**Verification:** 47 tests, all passing. `backend/tests/riskEngine.test.js` is
the golden case suite from §D.7 — treat it as the specification and add a case
before changing any threshold.

```bash
cd backend && npm test
```

## Batch 2 — Authentication and transport security ✅

| Defect | Detail |
|---|---|
| **Public privilege escalation** 🚨 | `POST /api/auth/register` was unauthenticated and accepted a client-supplied `role`. A public `/register` page in the frontend exposed it with a role dropdown. Anyone who could reach the site could issue themselves an **ADMIN** account. Removed at both ends; `POST /api/admin/users` (already admin-gated) is the only provisioning path — plan §C.3 |
| **Forgeable tokens** 🚨 | `JWT_SECRET` fell back to a hardcoded literal, and a second known value sits in the public README. Either signs a token claiming any role. Production now refuses to start on a missing, short, or known-leaked secret; development generates a random one per boot |
| **`cors({ origin: '*' })`** | Any website could drive the API through a signed-in user's browser. Now an allowlist via `CORS_ALLOWED_ORIGINS`, required in production |
| **No rate limiting** | Login was unlimited. Added limiters for login, patient lookup, AI calls and a global ceiling |
| **Unbounded uploads** | `multer.memoryStorage()` with no limit buffers an arbitrary file in heap. Capped at 10 MB / 10 files |
| **50 MB JSON bodies** | Uploads are multipart, so JSON bodies are small. Reduced to 1 MB |
| **Error detail leaked** | 5xx responses returned `err.message`, which carries table names and upstream provider detail. Suppressed in production, still logged in full |
| **No `trust proxy`** | Behind a load balancer every request shared one rate-limit bucket |

**Verification:** `POST /api/auth/register` → 404. Health → 200. Frontend
builds clean with no dangling references.

---

## Known gaps

| Gap | Detail |
|---|---|
| **Rate limit store is in-memory** | Per-process, so behind N instances the real limit is N×. Needs a shared Redis store — plan §A.4. Blocked on a Redis URL |
| **Helmet CSP disabled** | The default policy blocks the SPA's own bundle. Needs a real per-directive policy, not left off |
| **Admins can read patient routes** | `GET /api/patients` still permits `ADMIN`, contradicting plan §C.2 ("admins have no clinical access"). Not changed yet because the admin dashboard may depend on it — needs a check before removal |
| **Access control is app-layer only** | There are no RLS policies yet. Every check lives in `authorizeRoles`, so one missing guard is a breach. Plan §B.5 |
| **Formulary not implemented** | Medication is still authored by the LLM prompt and by a hardcoded fallback list in `aiOrchestrator.js`. Plan §D.2 requires a clinician-signed formulary behind a rules engine, with a `rule_source_id` the database enforces. **This is the largest remaining clinical gap and it is blocked on a clinician, not on code** |
| **Thresholds unvalidated** | NEWS2/IMNCI-derived but not reviewed for this deployment. The app carries no "not for clinical use" notice yet — plan §J.5 item 22 |
| **Leaked credentials** | `README.md` commits `ZEGOCLOUD_SERVER_SECRET` in plaintext. Rotate before any public demonstration |
