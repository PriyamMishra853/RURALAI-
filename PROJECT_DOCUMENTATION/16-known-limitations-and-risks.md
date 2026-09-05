# 16 — Known Limitations and Risks

> **Navigation:** [Index](README.md) · Previous: [15 — Error Handling and Observability](15-error-handling-and-observability.md) · Next: [17 — Architecture Decision Record](17-architecture-decision-record.md)

Every gap, defect and unproven claim found while reading this codebase. Nothing
here is softened. Several entries were discovered **during the writing of this
documentation** and are not recorded anywhere else in the repository.

Severity is engineering judgement:
**Critical** — could harm a patient or breach data ·
**High** — a core feature is broken or a claim is unsupported ·
**Medium** — degraded behaviour or an operational hazard ·
**Low** — correctness or hygiene.

---

## 1. Defects found while writing this documentation

These are not in `HANDOFF.md`, `implementation_plan.md` or
`docs/PHASE2_PROGRESS.md`.

### L1 — `visits.status = 'consultation_scheduled'` is not a valid enum value {#l1}

**Severity: Medium** · `consultation.controller.js:175`

```js
await supabaseAdmin.from('visits').update({ status: 'consultation_scheduled' }).eq('id', visit_id);
```

`consultation_scheduled` exists only in the **v1** `visit_status` enum
(`database/schema.sql:41`). The v2 enum is `in_progress`, `awaiting_ai`,
`awaiting_doctor`, `in_consultation`, `completed`, `referred`, `cancelled`.

The update fails with a Postgres enum error, **and the result is never checked** —
no `error` destructuring, no log. The consultation is booked successfully (that
insert already happened), so nothing visibly breaks; the visit's status simply
never changes to reflect that a consultation is scheduled.

**Fix:** use `awaiting_doctor`, or add the value to the enum. Either way, check
the result.

### L2 — `clinical_protocols` does not exist in v2 {#l2}

**Severity: Medium** · `ragEngine.js:53`

`ragEngine.js` falls back to `supabaseAdmin.from('clinical_protocols')` when
Qdrant is unavailable. That table, and `clinical_protocol_steps`, exist only in
the v1 schema — `database/v2/01_reset.sql:30` **drops** them and v2 never
recreates them.

The error is caught and logged as a warning, and the function returns `[]`. So
**Qdrant is effectively the only retrieval source**, and the "primary source:
Supabase, Qdrant attempted first" comment at the top of the file is backwards
relative to the current schema.

**Fix:** either create the tables in v2, or delete the fallback and be explicit
that Qdrant is required for retrieval.

### L3 — `applyV2.js` applied only migrations 01–06 — **FIXED** {#l3}

**Severity: was High** · `backend/src/scripts/applyV2.js`

It carried a hand-maintained `FILES` array that had drifted four migrations
behind. A fresh `npm run db:apply -- --confirm` produced a database where case
handoff failed on the enum (07), case withdrawal was impossible (08), emergency
registration was rejected by NOT NULL constraints (09) and the entire admin
dashboard returned 500 (10) — and the script reported success, because it had
applied every file it knew about.

It now reads the migration directory:

```js
const FILES = fs
  .readdirSync(V2_DIR)
  .filter((f) => /^\d{2}_.*\.sql$/.test(f))
  .sort();
```

Adding a migration file is enough to have it applied, so this class of drift
cannot recur.

### L4 — `mediasoup` is not a dependency {#l4}

**Severity: Low** (documented as Medium elsewhere) · `backend/package.json`

`MediasoupProvider.js` is complete and correct, and imports `mediasoup`
dynamically inside a `try/catch` — deliberately, so a missing native module means
"this provider is unusable here" rather than a crash. But the package is **not in
`package.json`**, so `isAvailable()` returns `false` on **every** host and
`P2PProvider` is always selected.

The file's own comment attributes this to a Windows build failure, which is true
but incomplete: it is not installed anywhere, including the Linux container.

**Impact is genuinely low** — a consultation is two peers, which is exactly P2P's
correct workload. It is a scaling limit (no third participant, no specialist
joining a call), not a defect.

### L5 — Rate limiting is in-memory {#l5}

**Severity: Medium** · `rateLimit.middleware.js` — documented in the file itself.

Per process, so behind N instances an attacker gets N× the limit. **Fix:** a
shared Redis store. Blocked on a Redis URL.

### L6 — Helmet CSP is disabled {#l6}

**Severity: Medium** · `app.js`

```js
helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false })
```

The default policy blocks the SPA's own bundle, served from the same origin.
**Fix:** a real per-directive policy allowing self scripts and styles.

### L7 — The service reports a model name it is not running {#l7}

**Severity: Low** · `symptom_model_meta.json` + `app.py`

`train_symptom_diagnosis.py` picks a winner on top-5 alone:

```python
winner = 'bernoulli_nb' if top5 >= base_top5 else 'centroid'
```

The centroid baseline scored 0.9784 against NB's 0.9743, so the metadata records
`"selected": "centroid"`. But `app.py` loads and serves **`symptom_nb.joblib`**,
and `/diagnose` returns `'model': META.get('selected')` — so the API labels its
own answers `centroid` while running Bernoulli NB.

Serving NB is the **right** choice: a 0.4-point top-5 difference is within noise,
NB wins top-1 by a full point, and only NB gives calibrated per-class
probabilities, which is what makes `confident: false` expressible. The accuracy
figure reported alongside is read from the `bernoulli_nb` block and is correct.

**The bug is the label, not the model.** Fix: report the actually-loaded model,
and change the selection rule to weight top-1 and calibration.

### L8 — The RAG embedding is not semantic {#l8}

**Severity: Medium** · `ragEngine.js` → `generateSimpleEmbedding()`

```js
vector[idx % 384] = (charCode % 100) / 100;
```

A character-code hash, not a learned embedding. Retrieval is closer to
deterministic keyword hashing than to vector similarity. The function is honest
about this in its own docstring, and the corpus is only 3 protocols, so the
practical impact today is small — but the architecture is described as "RAG" and
this is the part that is not really doing retrieval.

**Fix:** a real sentence embedding. No other change is needed — the store, the
`approved` filter and the consumption path are all in place.

### L9 — Built capabilities with no live caller {#l9}

**Severity: Low**

| Capability | Status |
|---|---|
| `selectMedications()` | Fully implemented, 22 tests — called **only from tests** since medication was withheld from the assistant |
| `getMedicineAvailability()` / `POST /medicine-availability` | Implemented and serving — **no production code path calls it** |
| `formatMedicationLine` | Imported in `ai.controller.js` and **never used** |

This is a **deliberate consequence** of the medication boundary, not an oversight:
the engine governs what a doctor may prescribe, and the doctor's prescribing UI
does not yet consume it. Worth stating so nobody reads the formulary engine as
live behaviour.

### L10 — The frontend hardcodes a backend URL {#l10}

**Severity: Medium** · `frontend/src/services/api.js:4`

```js
baseURL: 'https://ruralai-production-220.up.railway.app/api'
```

`VITE_API_URL` is documented in `.env.example`, read by `RealtimeContext.jsx` and
`TierResult.jsx` — and **ignored here**. Three different backend URLs appear
across the codebase:

| Location | Points at |
|---|---|
| `api.js` | `ruralai-production-220.up.railway.app` |
| `vite.config.js` proxy | `bob-production-4e27.up.railway.app` |
| `vercel.json` rewrite | `bob-production-4e27.up.railway.app` |
| `frontend/.env.production` | `bob-production-4e27.up.railway.app/signal` |

Both hosts respond, but they are different deployments. A local backend cannot be
used without editing source.

**Fix:** `baseURL: import.meta.env.VITE_API_URL || '/api'`.

### L11 — Three unused dependencies {#l11}

**Severity: Low** · `backend/package.json`

| Package | Status |
|---|---|
| `zod` | Not imported anywhere. Validation is hand-written |
| `resend` | Configured in `env.js` but not imported. Invitation email is not wired |
| `@google/generative-ai` | Not imported. `config/gemini.js` is a hand-written REST client |

**Fix:** remove all three, or wire `resend` for the password-reset flow that is
also missing.

### L12 — Client-side PDF builds unescaped HTML {#l12}

**Severity: Low** · `PatientAssessmentVisitPage.jsx` → `generateCompletePDFReport()`

Builds an HTML string with template interpolation of patient name, symptoms and
assessment text, and writes it into a `window.open()` document. The values come
from the same clinic's own staff and the document opens in a blank window rather
than the app origin — but it is unescaped interpolation.

A **server-side PDF route already exists** (`GET /api/reports/visits/:id/:type.pdf`,
rendered with pdfkit, Aadhaar masked, access-scoped).

**Fix:** delete the client-side generator.

### L13 — PostgREST `.or()` filter interpolation {#l13}

**Severity: Low** · `patient.controller.js`, `admin.controller.js`

```js
q.or(`full_name.ilike.%${term}%,phone.ilike.%${term}%,village_line1.ilike.%${term}%`)
```

**Not SQL injection** — PostgREST parses this as a filter expression and emits
parameterised SQL. It **is** filter-syntax injection: a term containing a comma or
a closing parenthesis can alter which columns are matched. Every such query is
additionally constrained by `.eq('clinic_district_id', …)` or `applyScope()`, so
the blast radius stays inside the caller's own district.

**Fix:** escape or reject `,`, `(`, `)` and `.` in search terms.

### L14 — Two enum values with no matching code path {#l14}

**Severity: Low**

- `visit_status` declares `awaiting_ai`, which nothing sets — the assessment runs
  synchronously, so a visit never sits in that state.
- `consultation_status` (`waiting`/`active`/…) is declared in `02_schema.sql` but
  `05_consultations.sql` drops and rebuilds `consultations` around
  `consultation_state`. The old type survives as an orphan no live table uses.

### L15 — `document_extractions` does not exist in v2 {#l15}

**Severity: Low** · `ai.controller.js:128`

```js
.select('*, document_extractions(*)')
```

That table is v1-only. The embed fails, the surrounding `try/catch` swallows it,
and `verifiedDocs` stays as whatever came from the request body.

**Practical impact is small** — the frontend passes `verified_ocr_data` directly,
so the working path is unaffected. But documents verified in an earlier session
and stored in the database never reach the orchestrator on a later assessment.
v2's extraction data lives in `patient_documents.extracted_data`.

`AIDoctorVisualSeparation.jsx` reads the same non-existent relation.

---

## 2. Clinical limitations

### C1 — The formulary is unsigned

**Severity: Critical (clinical), currently mitigated**

All five entries in `backend/src/data/formulary.js` are
`UNSIGNED_PLACEHOLDER`. The file's own header states the position:

> The dose figures are the standard published values from the WHO Model List of
> Essential Medicines and India's NLEM… They have **NOT** been reviewed by a
> registered medical practitioner for this deployment, this population, or this
> care model, and until they have been they must not reach a patient.

**Mitigated** by `REQUIRE_SIGNED_FORMULARY`, on by default in production, which
suppresses medication entirely. And doubly mitigated by the boundary that
withholds medication from the health worker at every tier regardless.

**Blocked on a registered practitioner, not on code.** The longest lead time in
the project.

### C2 — Triage thresholds are unvalidated for this deployment {#c2-triage-thresholds-are-unvalidated-for-this-deployment}

**Severity: Critical (clinical), disclosed**

Derived from NEWS2, PALS and WHO IMNCI, and internally consistent — but not
reviewed by a practitioner for this population. `ClinicalUseNotice.jsx` says so on
the landing and sign-in pages.

### C3 — The protocol corpus is 3 demo entries

**Severity: High (clinical)**

`seedQdrant.js` seeds three protocols. A physician-reviewed MoHFW Standard
Treatment Guidelines corpus is the substantive gap. The ingestion path, the
`approved` flag, version stamping and citation rendering all exist and are
exercised — the content does not.

### C4 — The model's accuracy is measured on a public dataset, not on Indian rural presentations

**Severity: High**

Top-5 of 0.974 on 48,988 held-out cases measures generalisation **within** the
Kaggle augmented dataset. It does not measure accuracy on the deployment
population. This is the single largest caveat on that figure, and it is stated in
[11 §14](11-ai-model-training.md#14-how-accuracy-is-measured-today).

### C5 — No clinical validation of end-to-end output

**Severity: High**

No study, no adjudicated concordance, no sensitivity/specificity for triage.
`doctor_reviews.agreed_with_ai` is the column designed to capture it and is
populated only by real usage.

### C6 — 191 disease classes were dropped

**Severity: Medium, disclosed**

Classes with fewer than 30 examples were removed — correct for a statistical
model, but it means those conditions are invisible to the classifier. The rule
engine still triages such a patient on vitals and red flags; only the candidate
list is silent.

### C7 — The LOW-tier dispensing policy is undecided

**Severity: Medium**

`docs/PHASE2_PROGRESS.md` flags the conflict with the NMC Telemedicine Practice
Guidelines 2020: may an assistant dispense before the doctor's daily review, or
must approval come first? **Currently moot**, because medication is withheld from
the assistant entirely — but it becomes live the moment the formulary is signed.

---

## 3. Operational limitations

### O1 — No dedicated TURN server

**Severity: Medium (availability)**

Falls back to Metered's free public Open Relay with a one-time warning. Calls
connect across networks, but on a shared free tier with no capacity guarantee.
Not a confidentiality issue — TURN forwards DTLS-SRTP it cannot decrypt.

### O2 — In-memory realtime fan-out

**Severity: Medium (scaling)**

`userSockets` is a per-process `Map`. Multi-replica delivery needs sticky sessions
or a Redis pub/sub fan-out. As `AI/LLM/MASTER_PLAN.md` puts it: *"without it,
'load balanced' and 'realtime notifications' are in direct conflict."*

### O3 — No CI pipeline

**Severity: Medium**

135 tests exist and nothing runs them automatically. No `npm audit`, no
Dependabot, no automated deploy gate.

### O4 — No observability stack

**Severity: Medium**

No structured logging, no metrics, no tracing, no alerting, no uptime monitoring,
no frontend error reporting. Covered in
[15 §12](15-error-handling-and-observability.md#12-observability-gaps).

### O5 — No backup or disaster-recovery procedure

**Severity: Medium**

Supabase provides managed backups on paid tiers; nothing in this repository
documents a restore procedure or an RPO/RTO target.

### O6 — Historical credential exposure

**Severity: High — requires action before any real deployment**

An earlier public repository committed a working `JWT_SECRET`, a ZegoCloud secret
and a Supabase anon key. The code now hard-refuses both leaked JWT values at boot
and RLS closed the anon-key exposure — but **scrubbing files does not remove them
from git history**.

**Every key that ever appeared in a commit or a chat transcript must be rotated.**

### O7 — Frontend `.env.production` is committed and stale

**Severity: Low**

Contains `VITE_SIGNAL_URL=wss://…/signal` — a WebSocket path that **no longer
exists** on the server. The `/signal` server was removed; `/realtime` replaced it.
The variable is also read by nothing.

---

## 4. Unproven claims

Things that are built but have not been demonstrated end to end.

| Claim | Status |
|---|---|
| **Cross-network video** | The two-tab test passed with `host ↔ host` candidates — **no NAT traversal was exercised**. Recorded in `HANDOFF.md` |
| **Wound-photo capture end to end** | The write path was repaired (`e238cbf`), but `implementation_plan.md` §2.4 records `patient_images` holding 0 rows and says one real capture is needed to prove it |
| **Migration 10 applied in production** | Presumed, because the dashboard works — but there is no verification note. Verify with `SELECT proname FROM pg_proc WHERE proname = 'admin_analytics';` |
| **Multi-assistant concurrent load** | The key pool is built for it; no concurrent test has been run |
| **Speech accuracy across 7 languages** | Whisper supports them; no WER measurement exists |
| **OCR accuracy on real Indian prescriptions** | Verified on synthetic fixtures only |
| **Multi-page PDF lab reports** | The path exists; verified on generated two-page fixtures |

---

## 5. Documentation drift

The repository's own documents disagree with the code in places. **The code
wins.**

| Document | Stale claim | Reality |
|---|---|---|
| `README.md` (old) | Clone `Ashish42-droid/BOB` | Wrong repository |
| `README.md` (old) | 19 tables including `clinics`, `document_extractions`, `knowledge_sources` | Those are v1; v2 has 17 different tables |
| `README.md` (old) | "142 tele-clinics in 12 states" | Nowhere in the code. Seed is 36 states, 75 UP districts |
| `README.md` (old) | `llama-3.3-70b-versatile`, `llama-3.2-11b-vision-preview` | Decommissioned. Actual: `openai/gpt-oss-120b`, `gemini-3.6-flash` |
| `README.md` (old) | Demo passwords "Any / demo" | Rotated into a gitignored file; `LoginPage.jsx` ships no passwords |
| `README.md` (old) | Three roles | Six exist |
| `README.md` (old) | Prints a live Supabase and Qdrant URL | Removed in the rewrite |
| `HANDOFF.md` | "87 tests" | **135** |
| `HANDOFF.md` | "`/api/calls` unauthenticated" | `call.routes.js` no longer exists |
| `HANDOFF.md` | "passwords hardcoded in `LoginPage.jsx`" | No longer true |
| `HANDOFF.md` | "No RLS policies" | v2 has ~40 |
| `HANDOFF.md` | "Migration 002 unapplied" | Superseded — `02_schema.sql` already has `patients.is_demo` |
| `docs/PHASE2_PROGRESS.md` | "Access control is app-layer only" | Written before v2's RLS |
| `ragEngine.js` header | "Primary source: the seeded `clinical_protocols` tables" | That table does not exist in v2 — [L2](#l2) |
| `AI/LLM/MASTER_PLAN.md` §2.1 | KNN + `llama-3.3-70b` | Superseded by Bernoulli NB and `gpt-oss-120b`; §10 records the correction |

This documentation set is written from the code, and every claim in it names the
file that backs it.

---

## 6. Risk register

| # | Risk | Likelihood | Impact | Mitigation in place | Residual |
|---|---|---|---|---|---|
| R1 | A health worker acts on an unreviewed medication suggestion | **Very low** | Severe | Medication deleted from output at every tier; formulary suppressed by default; 6 tests assert no drug name appears | **Low** |
| R2 | An emergency case is under-triaged | Low | Severe | Deterministic rules the model cannot lower; missing data escalates; degraded AI floors at MEDIUM; 28 tests | **Low** — but C2 means the thresholds themselves are unvalidated |
| R3 | Fabricated clinical data enters a record | **Very low** | Severe | Three speech gates; OCR fails to `needs_manual_entry`; vision returns `analysis_possible: false`; mandatory human verification | **Low** |
| R4 | A patient record is read across districts | Low | High | Three scoping layers + RLS | **Low** — untested by automation ([14 §7](14-testing-and-quality.md#7-coverage)) |
| R5 | An admin reads clinical data | **Very low** | High | Router-level lockout that fails closed, plus no admin role in any clinical RLS policy | **Very low** |
| R6 | A leaked historical credential is exploited | **Medium** | High | Leaked JWT values hard-refused at boot; RLS closed the anon-key path | **Medium until every key is rotated** — O6 |
| R7 | The video call carries no media across networks | **High** without TURN | Medium | Public relay fallback with a warning; `npm run check` reports it | **Medium** |
| R8 | A model decommission silently degrades the pipeline | Medium | Medium | Ids centralised in `config/models.js`; `verifyModelsAvailable()` uses a real call, not a listing; Gemini fallback chain | **Low** |
| R9 | Rate limits bypassed behind multiple instances | Medium | Medium | `trust proxy` set; limits are per process | **Medium** — L5 |
| R10 | A fresh install is missing recent migrations | was **High** | High | `applyV2.js` now reads the migration directory rather than a hand-maintained list | **Low** — L3 fixed |
| R11 | Assessment quality is worse than believed | Medium | Medium | Held-out accuracy measured; `confident` flag; candidates shown separately | **Medium** — C4, C5 |
| R12 | A regression ships because nothing runs the tests | Medium | Medium | 135 tests exist | **Medium** — O3 |

---

## 7. If you only fix five things

1. **Rotate every credential that ever appeared in git history or a chat
   transcript.** (O6) Nothing else on this list matters if a key is public.
2. **Rotate the demo staff password and the Maps API key.** Both have appeared
   in a chat transcript, which is a disclosure like any other. (~~L3 —
   `applyV2.js` — is fixed: it now reads the migration directory.~~)
3. **Get the formulary signed and the triage thresholds reviewed by a registered
   practitioner.** (C1, C2) Not code. Start it now — it is the critical path for
   both this system and
   [Section 12](12-next-generation-model-roadmap.md).
4. **Write the RLS and authorisation test suites.** ([14 §8](14-testing-and-quality.md#8-what-would-close-the-gaps-in-priority-order))
   The layers that would fail silently are the ones with no tests.
5. **Configure a dedicated TURN server.** (O1) Without it, the video
   consultation — the feature the platform is *for* — does not work reliably
   between two networks.
