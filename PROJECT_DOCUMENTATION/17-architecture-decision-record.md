# 17 — Architecture Decision Record

> **Navigation:** [Index](README.md) · Previous: [16 — Known Limitations and Risks](16-known-limitations-and-risks.md) · Next: [18 — Glossary](18-glossary.md)

Eighteen significant decisions, each with its context, the alternatives, the
choice, the consequences — including the bad ones — and its current status.

Several were **forced by an incident**. Where that is the case, the incident is
named, because a decision whose cost is already known is a stronger record than
one argued in the abstract.

---

## ADR-001 — AI prepares the case; the doctor makes the medical decision

**Status:** Accepted, enforced in code · **Date:** Foundational

**Context.** The problem statement permits protocol-based OTC suggestions to a
trained health worker. The NMC Telemedicine Practice Guidelines 2020 restrict
prescribing to registered practitioners. A health worker acting on a drug name
from an automated summary is the highest-consequence failure mode in the product.

**Alternatives.** (a) Show formulary-selected medication to the health worker for
LOW-tier cases, as the problem statement allows. (b) Show nothing.

**Decision.** (b). The engine is built, gated eight ways and tested — and its
output is **withheld from the health worker at every tier**, including LOW.

**Consequences.**
- ✅ The riskiest surface in the product does not exist.
- ✅ Asserted by tests that regex the serialised workflow for drug names.
- ❌ A capability is built and dormant ([L9](16-known-limitations-and-risks.md#l9)).
- ❌ Slightly less than the problem statement permits.

**Why (b).** The earlier design showed medication for LOW cases — *"which put a
dose in front of a health worker for exactly the cases nobody was going to look
at again, which is the wrong way round."*

---

## ADR-002 — Deterministic rules set a floor no model can lower

**Status:** Accepted · **Date:** Batch 1 remediation

**Context.** A language model asked for a risk level will produce one for any
input. Triage decides whether a patient is referred, and cannot be probabilistic.

**Alternatives.** (a) LLM decides the tier. (b) Rules decide, LLM advises. (c)
`final = MAX(rule, vision, model)`.

**Decision.** (c).

**Consequences.**
- ✅ The most consequential decision is made by code that can be read and tested.
- ✅ A model that ignores its instructions cannot clear a case.
- ✅ Three sub-rules follow: missing data escalates, degraded AI floors at MEDIUM,
  LOW is earned.
- ❌ The system is more conservative than a clinician would be, producing MEDIUM
  cases a doctor will clear quickly.

**The incident that forced it.** A visit with no vitals recorded returned **LOW**,
with the reasoning *"Vitals within standard physiological ranges"* — a statement
about readings nobody took.

---

## ADR-003 — Nothing is ever fabricated; an empty result is a valid answer

**Status:** Accepted · **Date:** Batch 1 remediation

**Context.** Every AI component can fail, and every one can fail by producing
something plausible.

**Alternatives.** (a) Fall back to a sensible default. (b) Return empty with a
reason.

**Decision.** (b), everywhere.

**Consequences.**
- ✅ A doctor can distinguish "not recorded" from "recorded as normal".
- ✅ The UI shows *why* something is missing.
- ❌ More failure states for the frontend to render.

**The incident.** `speechService.js` substituted a fixed Hindi sentence describing
fever, dry cough and body pain when transcription produced nothing. *Fever +
cough* is a MEDIUM-tier rule — so a silent recording produced a triaged case
describing a patient who did not exist.

---

## ADR-004 — Aadhaar is the primary key

**Status:** Accepted, with a documented migration path · **Date:** v2

**Context.** The specification names Aadhaar as the patient identifier. v1 had a
separate `patient_code`.

**Alternatives.** (a) Surrogate UUID + indexed Aadhaar. (b) Aadhaar as PK. (c)
Hash + last-4.

**Decision.** (b), as specified.

**Consequences.**
- ✅ One identifier at the counter, not two.
- ✅ Visit history follows the person.
- ❌ `patients` has **no `id` column** — which broke a health check doing
  `select('id')`.
- ❌ FKs are `VARCHAR(12)`; `audit_logs.entity_id` had to be `TEXT`.
- ❌ The key is immutable, so a wrong Aadhaar means a new record.
- ⚠️ Raw Aadhaar at rest is restricted under the Aadhaar Act 2016 §29 and the
  DPDP Act 2023.

**Mitigations.** Body-only transport, list masking to `XXXX XXXX NNNN`, audit
redaction to `****NNNN`, exact-match search only. `database/v2/README.md` records
the exact change to `aadhaar_hash` + `aadhaar_last4` if the position is revisited.

---

## ADR-005 — Age is derived, never stored

**Status:** Accepted · **Date:** v2

**Context.** The triage engine applies genuinely different thresholds across seven
age bands.

**Decision.** Store `date_of_birth`; compute age per request with `ageFromDob()`.

**Consequences.**
- ✅ Age is never stale. *"A stale age is a clinical error, not a display bug."*
- ✅ `ageDisplay()` reports months under two years and days under one month,
  because "0 years" tells a doctor nothing about a neonate.
- ❌ Cannot index or aggregate on age directly — `admin_analytics()` uses
  `width_bucket` over `EXTRACT(YEAR FROM age(date_of_birth))`.

---

## ADR-006 — Six roles, not three

**Status:** Accepted · **Date:** v2

**Alternatives.** (a) The three the specification names. (b) Six, with region
scope as a column.

**Decision.** (b).

**Consequences.**
- ✅ "Manage staff on a region basis" is enforceable, because scope is a column.
- ✅ The day-to-day admin account does not carry nationwide delete rights.
- ✅ Compliance review never requires an account that can mutate the roster.
- ✅ `CREATABLE_ROLES` asymmetry means a compromised district account cannot widen
  itself.
- ❌ More policies, more matrix, more to test — and the authorisation matrix is
  currently untested by automation.

---

## ADR-007 — Administrators have no clinical access, structurally

**Status:** Accepted · **Date:** Batch 3 remediation

**Alternatives.** (a) Per-route role lists. (b) Router-level guard. (c) Guard +
RLS.

**Decision.** (c).

**Consequences.**
- ✅ A route added later without its own role list **still fails closed**.
- ✅ Two independent statements of the same rule.
- ❌ They must be maintained together, and drift is the risk.

**The incident.** The frontend route table listed `'ADMIN'` alongside
`CLINIC_ASSISTANT` and `DOCTOR` on clinical routes — contradicting both the
specification and the backend.

---

## ADR-008 — Row-level security, even though the backend bypasses it

**Status:** Accepted · **Date:** v2

**Context.** The backend uses the service-role key, which bypasses RLS. So RLS
protects nothing on the API path.

**Alternatives.** (a) Skip RLS. (b) Enable it as defence in depth.

**Decision.** (b).

**Consequences.**
- ✅ The anon key ships in the browser bundle **by design** — RLS is what makes
  that safe.
- ✅ Two layers stating the same rules; either failing alone is not a breach.
- ❌ Every rule exists twice.

**The incident.** v1 had **zero** policies (`CREATE POLICY` appeared 0 times), so
the anon key committed to git history was a direct read/write handle on every
table through PostgREST — bypassing Express and every role check in it.

---

## ADR-009 — Clinical records are append-only; withdrawal is a soft delete

**Status:** Accepted · **Date:** Phase 1.3

**Alternatives.** (a) No delete. (b) Hard delete. (c) Soft delete with guards.

**Decision.** (c).

**Consequences.**
- ✅ An operator error is recoverable; the row records who withdrew it and why.
- ✅ Four guards, and each refusal names which one applied.
- ✅ Compare-and-set on `deleted_at IS NULL`, so two clicks produce one delete.
- ❌ Every clinical read needs `deleted_at IS NULL`, and forgetting it is a
  latent bug.

**Why not (b).** *"'I deleted the wrong case' has no remedy at all."*

---

## ADR-010 — Peer-to-peer WebRTC, after evaluating two hosted SDKs

**Status:** Accepted · **Date:** Batch 9

**Alternatives, all three actually tested:**

| Option | Result |
|---|---|
| ZegoCloud | Room join only; remote A/V unprovable. **Removed** |
| LiveKit | Worked fully. **Removed anyway** |
| Custom WebRTC | Worked fully, 0 errors, 0 warnings. **Kept** |

**Decision.** Custom P2P behind a `VideoProvider` abstraction.

**Consequences.**
- ✅ No per-minute cost, no vendor credential in the bundle, media never
  traverses a third party.
- ✅ Two peers is exactly P2P's correct workload, not a stand-in.
- ✅ The abstraction makes it reversible.
- ❌ Owning ICE, perfect negotiation and reconnection — 549 lines and nine
  distinct defects to fix.
- ❌ **Requires TURN.** STUN alone fails across carrier-grade NAT.
- ❌ Two peers maximum until `mediasoup` is installed
  ([L4](16-known-limitations-and-risks.md#l4)).

---

## ADR-011 — One WebSocket for notifications and call signalling

**Status:** Accepted · **Date:** Phase 0

**Decision.** A single authenticated socket at `/realtime`; any other upgrade
path is refused with a 404.

**Consequences.**
- ✅ Reconnect logic in one place; one socket per user, not two.
- ✅ Identity from the verified token resolved against `staff_profiles`.
- ❌ In-memory registry, so multi-replica needs sticky sessions or Redis.

**The incident.** A second signalling server on `/signal` served a call path that
had become unreachable from the UI and booked consultations with a payload the
API rejects. It also took `role=DOCTOR` from a query parameter, which was enough
to join a live consultation. Removed rather than left mounted.

---

## ADR-012 — Persist notifications, then push

**Status:** Accepted

**Decision.** Every event is written to `notifications` before the socket push.

**Consequences.**
- ✅ A doctor whose laptop was asleep still sees what happened.
- ✅ The socket is an optimisation, never the only delivery path.
- ✅ A failed push is not an error — the next page load recovers it.
- ❌ A database write on every event.

---

## ADR-013 — A trained classifier bounds the language model

**Status:** Accepted · **Date:** P2

**Alternatives.** (a) LLM alone. (b) Classifier alone. (c) Classifier proposes,
LLM re-ranks within the list.

**Decision.** (c).

**Consequences.**
- ✅ Output is traceable to 244,938 labelled training rows.
- ✅ "We do not have a confident match" is expressible, because NB gives
  calibrated probabilities.
- ✅ The classifier contributes duration/vitals/history-blind evidence; the LLM
  contributes the context the classifier cannot see.
- ❌ A second service to deploy and keep alive.
- ❌ Candidates the classifier misses cannot be introduced by the LLM.

**Why not KNN**, which the original plan named: it keeps the whole 246k × 377
matrix in memory and scans it per prediction, and its distance is hard to reason
about at this dimensionality.

---

## ADR-014 — Model identifiers live in one file, verified by a real call

**Status:** Accepted · **Date:** After the decommission incident

**Decision.** Every model id in `config/models.js`, overridable by environment,
plus `verifyModelsAvailable()`.

**Consequences.**
- ✅ A decommission is a config change, not a code change.
- ✅ It becomes a red line in `npm run check` instead of silence.
- ✅ The Gemini check makes a **real `generateContent` call with an image**, not a
  `/models` listing.

**Two incidents.** Groq decommissioned `llama-3.3-70b-versatile`, which was
hardcoded at three call sites; every one started returning 404 and each service
quietly fell back to its non-AI path — *"the assessment pipeline ran for an
unknown period with no model in it at all."* And `gemini-2.5-flash` stayed in the
`/models` listing for months after `generateContent` began returning 404 to new
keys, so a listing-based health check passed while every wound photo silently
fell back.

---

## ADR-015 — Pool the API keys rather than treat them as spares

**Status:** Accepted · **Date:** P1

**Context.** Four Groq keys. Under the demo condition — several assistant devices
running assessments at once — a single key hits its rate limit almost
immediately.

**Decision.** Round-robin pool with per-key benching (429), permanent retirement
(401/403), and a bounded wait when all are benched.

**Consequences.**
- ✅ Four keys of throughput, not one with three spares.
- ✅ Duplicates collapsed by value, so two vars holding one key do not fake
  capacity.
- ❌ A request may wait up to 30 s rather than degrading — *"a degraded assessment
  that looks normal is worse than one that takes two seconds longer."*

---

## ADR-016 — One container serves the SPA, the API and the inference service

**Status:** Accepted · **Date:** After the "never running" incident

**Alternatives.** (a) Vercel + Railway + a third service. (b) One container, the
Python service on loopback.

**Decision.** (b).

**Consequences.**
- ✅ One origin, so CORS is out of the production path entirely.
- ✅ The socket host is derived from the page rather than configured twice.
- ✅ The inference service is on loopback, where *"only the backend can reach it"*
  is literally true — which matters, because it has no authentication of its own.
- ❌ The two halves cannot scale independently.
- ❌ A longer build — two npm trees, a Vite build and a pip install.

**The incident.** `AI_SERVICE_URL` was unset and Railway's start command was `cd
backend && npm start`, so the Python service was **never launched**. It failed
quietly: the circuit breaker opened, calls returned `null`, callers correctly
treated that as "no candidates", and the assessment still rendered — without its
retrieval step. This looked like poor model output rather than a missing process.

---

## ADR-017 — The Python build fails soft

**Status:** Accepted

**Decision.** `build-ai.sh` exits `0` even on failure, deletes the half-built
virtualenv, and imports every package to verify it actually works.

**Consequences.**
- ✅ A resolver problem in an optional subsystem does not become a clinical
  outage.
- ✅ `start.sh` reports the venv as absent rather than launching a uvicorn that
  cannot import its dependencies.
- ✅ The import check catches the `libstdc++.so.6` class of failure, where pip
  reports success and the service is dead.
- ❌ A green build can ship a degraded system — which is why
  `GET /api/ai/service-status` exists and diagnoses which failure occurred.

---

## ADR-018 — Aggregate in Postgres, not over PostgREST

**Status:** Accepted · **Date:** Admin dashboard rebuild

**Decision.** `admin_analytics(scope_state, scope_district)` returning JSONB.

**Consequences.**
- ✅ No row cap, one round trip, cost independent of patient count.
- ✅ The 14-day trend includes quiet days — *"a line that skips days with no visits
  implies continuous activity and reads a closed Sunday as busy."*
- ❌ Business logic in SQL, and a migration to change it.

**The incident.** Computed in Node, PostgREST's 1,000-row cap silently described
the first thousand of 1,876 patients, and every "busiest district" came back as
exactly 25 — *"figures that were wrong and entirely plausible at the same
time."*

---

## Decisions summarised

| # | Decision | Forced by an incident? |
|---|---|---|
| 001 | Medication withheld from the health worker | Design |
| 002 | `final = MAX(rule, vision, model)` | ✅ Empty case triaged LOW |
| 003 | Never fabricate; empty is valid | ✅ Invented Hindi symptom sentence |
| 004 | Aadhaar as primary key | Specification |
| 005 | Age derived, never stored | Design |
| 006 | Six roles with region scope | Specification implication |
| 007 | Structural admin clinical lockout | ✅ Admin on clinical routes |
| 008 | RLS as defence in depth | ✅ Zero policies + a leaked anon key |
| 009 | Append-only; soft delete with guards | Design |
| 010 | P2P WebRTC after evaluating two SDKs | Measured comparison |
| 011 | One authenticated socket | ✅ A second, unauthenticated signalling path |
| 012 | Persist, then push | Design |
| 013 | Classifier bounds the LLM | Design |
| 014 | Model ids in one file, verified by a real call | ✅ Two decommissions |
| 015 | Key pool, not spares | Load reasoning |
| 016 | One container, loopback inference | ✅ The service was never running |
| 017 | Python build fails soft | ✅ A pip failure took the backend down |
| 018 | Aggregate in Postgres | ✅ Silent 1,000-row truncation |

**Eleven of eighteen were forced by a specific failure**, which is why so many
source comments read as incident reports. That is the most accurate summary of
how this codebase was built.
