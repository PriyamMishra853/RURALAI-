# 19 — Contributing and Conventions

> **Navigation:** [Index](README.md) · Previous: [18 — Glossary](18-glossary.md)

How this codebase is written, the invariants that must not be broken, and the
review checklist.

---

## 1. The eight invariants

These are the rules the whole system rests on. **Breaking one is a clinical
defect, not a style disagreement.** They are stated in `HANDOFF.md`, encoded in
tests, and repeated here because they are the most important thing in this
repository.

### 1. `final_tier = MAX(rule_tier, vision_tier, model_tier)`

Deterministic rules set a floor. A model may **raise** a tier and can **never**
lower one.
*Enforced by:* `higherTier()` in `riskEngine.js`; `RISK_RANK` comparisons in
`aiOrchestrator.js`. *Tested by:* `riskEngine.test.js`, `aiOrchestrator.test.js`.

### 2. Degraded AI fails safe to MEDIUM, never LOW

Timeout, malformed output, no model configured — all floor at MEDIUM and set
`degraded: true`.
*Enforced by:* the `degradedReason` branch in `aiOrchestrator.js`. *Tested by:*
three cases in `aiOrchestrator.test.js`.

### 3. Missing data escalates

Absent vitals or unknown age raise the tier. **Absence of evidence is not
evidence of absence.**
*Enforced by:* the missing-data block in `riskEngine.js`. *Tested by:* five cases.

### 4. A reading of `0` is a reading

Never `if (spo2)` — that treats an SpO₂ of 0 as "not recorded" and skips every
red-flag check.
*Enforced by:* `toNumber()`. *Tested by:* four cases.

### 5. Medicine is never model-authored

It comes from the signed formulary via the rules engine. Every emission carries
`rule_source_id`; `assertRuleSourced()` throws otherwise. **And none of it is
shown to the health worker, at any tier.**
*Enforced by:* `formularyService.js`, `aiOrchestrator.js` §7,
`tierWorkflowService.js`. *Tested by:* `formularyService.test.js`,
`medicationBoundary.test.js`.

### 6. Nothing is ever fabricated

No invented transcripts, no default symptoms, no guessed doses, no invented bed
counts. **An empty result is a valid, safe answer — render it as "none", never
substitute something plausible.**
*Enforced by:* `speechService.js`, `ocrService.js`, `visionService.js`,
`referralService.js`.

### 7. Admins have no clinical access

Not read, not write. Enforced by a router-level guard that fails closed for
routes added later, **and** by RLS.
*Enforced by:* `clinicalAccess.middleware.js`, `03_rls.sql`.

### 8. Clinical records are append-only

Soft delete only, guarded four ways. Demo records are flagged, never deleted.
*Enforced by:* `deleteVisit`, `08_visit_soft_delete.sql`.

---

## 2. Working agreements

From `HANDOFF.md` §7, and observed throughout the code.

**Alter the existing codebase in place.** Do not scaffold a parallel structure.

**Do not change the frontend palette, spacing or component styling** unless
explicitly asked. It should not look AI-generated, and the `tier-*` colour scale
carries clinical meaning that must not be reused decoratively.

**Never fabricate data as real.** Placeholder rows are labelled
`PLACEHOLDER_DEMO`, demo phone numbers cannot dial a real person, demo emails use
the RFC 2606 reserved `@vvc-demo.example.com`, and demo Aadhaars begin with `0`.

**Watch for checks that pass because the thing they test never ran.** Two
occurred: a Supabase `head: true` count reported an empty database as healthy, and
a constraint probe passed on `23502` (not-null) instead of `23514` (check). Both
looked green while proving nothing.

**Verify before claiming.** Every "done" has a command or a measurement behind it.

---

## 3. Coding conventions

### JavaScript

| Convention | Detail |
|---|---|
| Modules | ESM everywhere (`"type": "module"`). Always include the `.js` extension in relative imports |
| Async | `async`/`await`. No `.then()` chains except where a `.catch(() => {})` is the point |
| Naming | `camelCase` for JS, `snake_case` for database columns and API payloads. The boundary is the controller |
| Exports | Named exports for services and utilities; default only for Express routers and React components |
| Errors | Return a status and a JSON body from controllers. Throw only where a caller is expected to catch |
| Nullish | `??` and `?.` for absent values. **Never `||` on a numeric that could legitimately be `0`** — see invariant 4 |
| Guards | Validate and return early; keep the happy path unindented |

### SQL

| Convention | Detail |
|---|---|
| File naming | `NN_description.sql`, applied in order |
| Transactions | `BEGIN` / `COMMIT`, **except** `ALTER TYPE … ADD VALUE`, which cannot run inside one |
| Idempotency | `IF NOT EXISTS` / `IF EXISTS` wherever possible |
| Constraints | Name them: `CONSTRAINT patients_identity_required_unless_emergency CHECK (…)` |
| Indexes | `idx_<table>_<purpose>`. Use partial indexes where the common query filters |
| Comments | A header block explaining **why** the migration exists and what broke without it |

### Python

| Convention | Detail |
|---|---|
| Style | PEP 8, 4-space indent |
| Types | Type hints on public functions |
| Validation | Pydantic models at the HTTP boundary, with field bounds |
| Purity | Keep decision functions pure — `gate_candidate` and `match_symptoms` are importable and testable without the service |
| Determinism | Never iterate an unordered set where the result affects output. Sort explicitly |

### React

| Convention | Detail |
|---|---|
| Components | Function components with hooks |
| State | `useState` for UI, `useRef` for anything a callback reads **synchronously** (all WebRTC negotiation state) |
| Context | Three providers: `Theme`, `Auth`, `Realtime` |
| Styling | Tailwind utilities composed through `cn()`. No CSS modules, no styled-components |
| Data | `axios` through the shared `api` instance. Never `fetch` directly, except the PDF blob path which needs manual header control |
| Safety | Never render untrusted HTML. `dangerouslySetInnerHTML` appears nowhere and must stay that way |

---

## 4. Comment style — the distinctive convention

**Comments explain what a line prevents, with the specific failure that
occurred.** This is the single most valuable convention in the codebase and it
should be maintained.

Not this:

```js
// Check if spo2 is a number
const spo2 = toNumber(vitals.spo2);
```

This:

```js
/**
 * Parse a vital sign into a number.
 *
 * Returns null for absent or unparseable values so that a genuine reading of
 * zero is never confused with "not recorded". The previous `if (spo2)` guards
 * skipped both cases identically, which meant an SpO2 of 0 — a device fault or
 * a peri-arrest patient — silently passed every red-flag check.
 */
```

Three rules:

1. **Name the failure.** "One truncated upload from one assistant killed the
   backend for every clinic."
2. **Explain why the obvious approach is wrong.** "`no_speech_prob` is not usable
   for this: on one second of pure digital silence Whisper returned 'Thank you.'
   with `no_speech_prob: 0`."
3. **Say what must not be changed back.** "That false pass cost an hour; do not
   'simplify' this back."

---

## 5. Adding a feature

### A new endpoint

1. **Choose the router.** Clinical routers already carry
   `denyAdminClinicalAccess` — mount there and inherit it.
2. **Add `authorizeRoles(...)`** even if the router guard would cover it.
   Defence in depth, and it documents intent.
3. **Scope every query** on `req.user.districtId` (assistant) or
   `req.user.id` against `assigned_doctor_id` (doctor) — **inside the query**, not
   after the fetch.
4. **Validate input**, returning field-keyed errors for anything a form submits.
5. **Never accept tenancy from the request.** District and state come from the
   profile.
6. **Add an audit entry** for anything that mutates clinical data or a staff
   account.
7. **Add an RLS policy** if a new table is involved.
8. **Update** [13 — API Reference](13-api-reference.md) and
   [10 — Authorisation](10-authorisation.md).

### A new database column

1. Add a numbered file in `database/v2/`.
2. Write the header block: why it exists, and what broke without it.
3. Use `IF NOT EXISTS`; wrap in a transaction **unless** it is `ALTER TYPE … ADD
   VALUE`.
4. **Add it to the `FILES` array in `applyV2.js`** — currently 07–10 are missing,
   which is [L3](16-known-limitations-and-risks.md#l3).
5. Add an index if it will be filtered on; prefer a partial index.
6. Update the RLS policy if visibility changes.
7. Update [06 — Database Schema](06-database-schema.md), including the applied
   status.

### A new AI capability

1. **Decide which layer it belongs to.** Deterministic → the rule engine.
   Statistical → the Python service. Generative → an orchestrator stage.
2. **Define the failure value first**, and make sure it is not a plausible
   substitute.
3. **If it can affect the tier, it may only raise it.**
4. **Cap any confidence in code**, not only in the prompt.
5. **Add the model id to `config/models.js`** and to `verifyModelsAvailable()`.
6. **Never let it name a medicine.**
7. Add unit tests with a fake provider. Add a live probe to
   `checkAiPipelines.js` if it calls an external model.

---

## 6. Review checklist

Before merging anything that touches the clinical path:

**Safety**
- [ ] No new path can lower a tier
- [ ] No new path can emit a medication without `rule_source_id`
- [ ] No new path can show a medication to a `CLINIC_ASSISTANT`
- [ ] Every failure returns an empty or explicit value, never a plausible
      substitute
- [ ] Any confidence a model reports is capped in code

**Access control**
- [ ] Every new query is district- or assignment-scoped **inside the query**
- [ ] Tenancy comes from `req.user`, never the request body
- [ ] New routes are on a router carrying `denyAdminClinicalAccess`, or explain
      why not
- [ ] `authorizeRoles` is present even where the router would cover it
- [ ] An RLS policy exists for any new table
- [ ] The Express guard and the RLS policy **agree**

**Data**
- [ ] Numeric guards use `!== null`, not truthiness
- [ ] Enum values written match the v2 enum exactly
- [ ] Clinical reads filter `deleted_at IS NULL`
- [ ] Any identifier written to `audit_logs` is in `REDACT_KEYS`
- [ ] Aadhaar never appears in a URL

**Operational**
- [ ] Errors that a user depends on are `console.error`, not `console.warn`
- [ ] Any new external call has a defined timeout and failure value
- [ ] A new migration is added to `applyV2.js`
- [ ] `npm test` passes
- [ ] The relevant documentation section is updated

---

## 7. Git conventions

**Commit messages describe the outcome, not the diff.** From the actual history:

```
Add a preflight check for the state that breaks between demonstrations
Restrict the AI service diagnostic to administrators
Wound photographs: fix the whole path, and keep them private
Admin dashboard: operational figures, drawn correctly
Never let an optional Python dependency fail the whole deploy
Make the service-status endpoint say which failure it is
```

Not `fix bug`, not `update controller`.

**Branch naming:** `feat/`, `fix/`, `docs/` + a short description.

### Remotes — read this before pushing

```
ruralai  https://github.com/PriyamMishra853/RURALAI-.git   ← THIS project
```

**Every push to `ruralai/main` is a live deploy.** Railway watches all paths
(`"watchPatterns": ["**"]`), so any push rebuilds and redeploys production.
Confirm before pushing.

---

## 8. Things that must not be changed without discussion

| Thing | Why |
|---|---|
| The eight invariants (§1) | Each encodes a specific clinical failure |
| `REQUIRE_SIGNED_FORMULARY` defaulting on in production | The only thing stopping unsigned doses reaching a patient |
| The `approved = true` Qdrant filter **and its payload index** | Without the index the filter silently never runs |
| `looksLikeDecodableImage()` | Removing it lets one bad upload kill the process |
| `select('*')` in `checkServices.js` | `select('id')` fails — `patients` has no `id` column |
| The real `generateContent` call in `verifyModelsAvailable()` | A `/models` listing proved nothing for months |
| Persist-then-push in `notify()` | The socket is an optimisation, not the delivery path |
| Politeness fixed by role in `CallPage.jsx` | Election by arrival order cannot survive a rejoin |
| Deriving `patient_id` from the visit in `analyzeImageAI` | Reading it from the body let a photo be attached to another patient |
| `ClinicalUseNotice` wording, in one place | Two copies of a safety disclaimer drift |
| Demo Aadhaars beginning `0`, guest ids beginning `1` | The property that makes collision with a real number impossible |
| Compare-and-set guards | Each one is a race that occurred |

---

## 9. Getting oriented

| Question | Read |
|---|---|
| How is a case triaged? | `backend/src/services/riskEngine.js` |
| How is the AI bounded? | `backend/src/services/aiOrchestrator.js` — system prompt, then §7 |
| What is the data model? | `database/v2/02_schema.sql` |
| Who can do what? | `backend/src/config/roles.js` + `database/v2/03_rls.sql` |
| What does the trained model do? | `AI/LLM/service/app.py` |
| How accurate is it? | `AI/LLM/data/models/symptom_model_meta.json` |
| What is broken? | [16 — Known Limitations](16-known-limitations-and-risks.md) |
| Why is it built this way? | [17 — Architecture Decision Record](17-architecture-decision-record.md) |
| What does a clinical term mean? | [18 — Glossary](18-glossary.md) |

Then run the tests, and read `docs/PHASE2_PROGRESS.md` — it is the record of nine
batches of remediation and explains why so much of the code reads as a set of
incident reports.
