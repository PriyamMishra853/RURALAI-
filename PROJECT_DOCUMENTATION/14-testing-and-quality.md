# 14 — Testing and Quality

> **Navigation:** [Index](README.md) · Previous: [13 — API Reference](13-api-reference.md) · Next: [15 — Error Handling and Observability](15-error-handling-and-observability.md)

**171 tests across 12 suites, all passing.** Plus a Python regression suite, three
live-service check scripts, and a pre-demonstration preflight. This section covers
what each asserts, what it deliberately does not cover, and the two false passes
that shaped how the suite is written.

---

## 1. Current state — verified

```
$ cd backend && npm test

Test Suites: 12 passed, 12 total
Tests:       171 passed, 171 total
Snapshots:   0 total
Time:        14.688 s
```

Run on the current `feat/case-handoff` branch while writing this documentation.

`HANDOFF.md` records "87 tests" — that figure is stale; the suite has grown by 48
tests since it was written.

---

## 2. Testing philosophy

Three principles, each stated in the code itself.

### 2.1 The suite never touches the network

```js
// jest.config.js
// External APIs (Groq, Gemini, Supabase, Qdrant) are never called from this
// suite. CI must stay free, deterministic, and must not spend AI quota;
// anything that needs a live provider belongs in a separate check script.
```

Fakes are injected via `jest.unstable_mockModule`. A suite that calls a real
model provider is non-deterministic, costs money per run, and fails when a key
rotates — none of which are properties you want in the thing that tells you
whether a safety invariant still holds.

### 2.2 Tests are organised by **invariant**, not by function

`riskEngine.test.js` reads:

```
describe('invariant: LOW is earned, never defaulted')
describe('invariant: a reading of zero is a reading, not an absence')
describe('invariant: escalation is monotonic')
```

Each `describe` block names a property that must hold. When one fails, the failure
message states which safety property broke, not merely which function returned an
unexpected value.

### 2.3 Every negative test is a defect that actually occurred

`AI/LLM/eval/test_symptom_matching.py`:

> Every case here is a failure that actually happened during development… The
> **negative** cases matter more than the positive ones. A missed match is
> recoverable — the assistant re-words it. A fabricated symptom silently corrupts
> the whole assessment, and nobody downstream can tell it was invented.

---

## 3. The nine suites

### `riskEngine.test.js` — 28 tests

The largest suite, on the file that decides clinical outcomes.

| Group | Asserts |
|---|---|
| `higherTier` | Raises a tier; **never** lowers one |
| LOW is earned | LOW only with every core vital present and in range; an empty case is **not** LOW; every missing vital is named; one absent vital floors at MEDIUM; unknown age floors at MEDIUM even with complete vitals |
| Zero is a reading | SpO₂ of 0 is a critical red flag; systolic of 0 is a critical red flag; an unparseable vital is absent, not zero; numeric strings are accepted |
| Temperature scale | Celsius converted before thresholds; a Celsius reading critical in °F terms escalates; a Fahrenheit reading is left alone |
| HIGH + immediate referral | SpO₂ < 90, BP extremes, red-flag phrases; **any fever in an infant under 2 months** (IMNCI); the infant rule does **not** apply to an older child at the same temperature |
| HIGH without referral | SpO₂ 90–93, severe respiratory rate for age, temperature ≥ 103.5 °F |
| MEDIUM | Concurrent fever and cough; comorbidity in history; age-banded pulse and respiratory rate |
| Monotonicity | A MEDIUM finding cannot pull a HIGH case down; missing data cannot pull a HIGH case down |

### `aiOrchestrator.test.js` — 15 tests

The pipeline, with fake Groq and inference clients.

| Group | Asserts |
|---|---|
| Degraded AI fails safe | Floors LOW at MEDIUM when no provider is configured, when the call throws, and when the response is off-schema; does **not** mark a successful assessment as degraded |
| Final tier is the maximum | The model may raise above the rule tier; the model may **not** lower below it; a wound photograph may raise it; the missing-vitals list is carried through |
| Medication is never model-authored | **Discards medication the model authored, even when it looks plausible**; emits no medication from any source; states why it is absent; withholds it for HIGH too |

The "even when it looks plausible" test is the important one — it plants a
well-formed, realistic medication object in the fake model's response and asserts
it does not survive.

### `formularyService.test.js` — 22 tests

All eight gates, exhaustively.

| Group | Asserts |
|---|---|
| Tier gate | Nothing for HIGH; nothing for MEDIUM; medication for a matching LOW case |
| Signature gate | Nothing while unsigned and signing is required; every line labelled unsigned when relaxed for a demo |
| Exclusions | Paracetamol blocked on liver disease; blocked on a recorded allergy; blocked on a red-flag symptom **even though the indication matches**; blocked when not established as safe in pregnancy |
| Age and weight | **Refuses to dose when age is unknown rather than assuming an adult**; blocks paracetamol for an infant under 3 months; refuses a per-kg dose with no weight; emits it once a weight is recorded; applies the paediatric zinc protocol to a child but not an adult |
| Rule sourcing | Stamps every emission with its formulary entry; **throws** rather than emitting an unsourced medication; accepts a properly sourced list |
| Rendered line | Always carries the doctor-approval caveat |

### `medicationBoundary.test.js` — 6 tests

The strictest suite in the repository. It serialises the entire tier workflow and
searches it with a word-boundary regex for every drug name in the formulary:

```js
const mentionsDrug = (haystack, drug) => new RegExp(`\\b${drug}\\b`, 'i').test(haystack);
```

Asserts that at **every** tier — including LOW — no medication is emitted, the
absence is explained rather than left blank, and no drug name appears anywhere in
the workflow object.

### `healthCardOcr.test.js` — 14 tests

Values that must never reach the registration form.

| Group | Asserts |
|---|---|
| A clean card | Returns the three fields the form needs |
| Must never reach the form | Future date of birth rejected; implausibly old date rejected; a non-`YYYY-MM-DD` date rejected; a gender outside the enum rejected; a name of only digits rejected (a misread card number); a one-character name rejected |
| Year-only cards | Keeps the year but **refuses to invent a full date from it** |
| When the read goes wrong | Reports the fields it refused, so half a card does not look like all of it; refuses a non-identity document; fails cleanly when the model returns nothing; treats an unstated confidence as **low** rather than assuming it is good; rejects an empty upload |

### `realtimeHub.test.js` — 10 tests

Drives a **real** `ws` server on an ephemeral port.

Refuses a socket with no token · refuses an upgrade to a non-`/realtime` path ·
introduces two participants to each other · refuses a non-participant · relays an
offer to the other peer **only** · tells the remaining peer when the other drops ·
restores membership when a participant reconnects and rejoins · replaces a stale
socket rather than treating a reconnect as a third party.

### `speechService.test.js` — 7 tests

Hallucination patterns · **only rejects a bare thanks, not speech containing it**
· padding-artifact detection: flags a segment running far past the real duration,
does not flag genuine short speech, does not flag a normal full-length recording,
and is inert when the provider returns no segment data.

The "only rejects a bare thanks" test guards against over-rejection — a real
utterance that happens to contain a matched phrase must survive.

### `visitRiskTier.test.js` — 8 tests

Translates the rule vocabulary to the database enum · **maps MEDIUM to
`moderate` — the case that broke every handoff** · passes through values that are
already enum values · case- and whitespace-insensitive · accepts the synonyms
clinical text actually uses (`MILD`, `SEVERE`, `CRITICAL`) · returns `null` for
anything unrecognised rather than guessing · **only ever returns a value the
database enum accepts**.

### `visitWithdrawal.test.js` — 12 tests

Withdraws a case still the assistant's own · records who withdrew it and why
rather than removing the row · refuses once a doctor is assigned · refuses once a
consultation is booked · refuses once a review exists · refuses a visit outside
the caller's district · **says which guard applied, not a flat refusal** ·
withdrawing twice is not an error · reports failure rather than claiming success
when the write fails.

---

## 4. Python regression suite

`AI/LLM/eval/test_symptom_matching.py`, run with `pytest`.

Its docstring is a four-iteration record of the matcher's failures — the table is
reproduced in [11 §4](11-ai-model-training.md#4-the-symptom-matcher).

**Positive:** `body ache` → *ache all over* · `itchy rash spreading on both
forearms` → *skin rash* (the dilution case v3 missed) · a cardiac cluster ·
a febrile cluster.

**Negative — the ones that keep the system honest:**
`body ache` must not match *foreign body sensation in eye* · `itchy rash` must
not match *itchy ear(s)* · `vomiting` must not invent *vomiting blood* · `no
urine` must not invent *pus in urine*.

It also imports `gate_candidate` directly, which is why that function is written
as a pure function — so the demographic gates can be asserted without standing up
the service.

---

## 5. Live-service checks — a separate tier, deliberately

These make **real** API calls and are the only places allowed to.

### `npm run check` — `checkServices.js`

Eight probes:

| Probe | Required | Asserts |
|---|:--:|---|
| Supabase Auth | ✅ | `/auth/v1/health` reachable |
| Supabase REST / schema | ✅ | 7 core tables present |
| Groq | ✅ | Key valid, models listed |
| Gemini | ✅ | Key valid, models listed |
| Qdrant | ❌ | Cluster reachable, collections listed |
| Realtime | ✅ | **Rejects an unauthenticated socket.** A 401 is the *pass* condition |
| TURN relay | ❌ | A dedicated relay is configured |
| Model availability | ✅ | Every configured model still exists at its provider |
| Formulary signature gate | ✅ | Reports SIGNED / UNSIGNED-suppressed / UNSIGNED-demo |

The realtime probe is unusual and correct: the socket admits a caller into a live
consultation, so **anyone who could open it without a token could join a doctor's
call**. The check asserts the door is locked.

### `npm run check:ai` — `checkAiPipelines.js`

Drives generated bitmap-text fixtures (no clinical data is carried around)
through prescription OCR, a two-page lab report, and wound-photo vision. Fixtures
are crude on purpose — *"expect `(unclear)` markers in the output. That is the
correct behaviour: the pipeline must flag an uncertain read, never invent a
value."*

### `npm run preflight` — `preflight.js`

Six checks, each corresponding to something that **fails silently**:

| # | Check | Silent failure it catches |
|---|---|---|
| 1 | Doctor working hours | Empty `doctor_schedules` makes every booking date read "Closed". The engine is correct; a missing row means "not working" |
| 2 | Cases assigned for today | `visit_date` is a date and the demo rolls over at midnight IST |
| 3 | Deterministic five-case queues | Confirms `seed:daily` ran |
| 4 | AI inference service | Reachable while every page still renders — a failed call degrades to "no candidates" rather than an error |
| 5 | Wound-photo storage | The bucket exists **and** `public === false` |
| 6 | `CASE_ASSIGNED` enum value | Migration 07 applied |

Read-only. It reports; it does not fix, and prints what to run next to each
failure. Check 4 is honest about its own limits: run from a laptop it is asking a
different machine, so it says *"this only works from inside the container"*
rather than emitting a meaningless FAIL.

---

## 6. Two false passes that shaped the suite

Both recorded in `HANDOFF.md` §7 as a working agreement: *"Watch for checks that
pass because the thing they test never ran."*

### A HEAD count reported an empty database as healthy

```js
// Use a real row select, NOT `{ head: true, count: 'exact' }` — a HEAD count
// against a table that does not exist returns no error, so the head form
// reports a completely empty database as healthy. That false pass cost an
// hour; do not "simplify" this back.
```

A related fix in the same probe: `select('*')`, not `select('id')`, because
`patients` is keyed on `aadhaar_number` and has no `id` column — so naming a
column made a healthy table look missing with error `42703`.

### A constraint probe passed on the wrong error code

A test asserting that a database CHECK constraint rejected an insert passed on
`23502` (not-null violation) instead of `23514` (check violation) — green, while
proving nothing about the constraint it claimed to test.

---

## 7. Coverage

### Configured scope

```js
collectCoverageFrom: ['src/services/**/*.js', 'src/middleware/**/*.js']
```

Deliberately narrowed to the safety-critical surface rather than chasing a
repository-wide percentage.

### What is well covered

| Area | Coverage |
|---|---|
| `riskEngine.js` | **Extensive** — every tier path, every invariant, both temperature scales, age bands, zero handling |
| `formularyService.js` | **Extensive** — all 8 gates, rule sourcing, rendering |
| `aiOrchestrator.js` | **Good** — degradation, tier combination, medication discard |
| `speechService.js` | **Good** on the exported detectors |
| `ocrService.js` (health card) | **Good** — validation and every failure mode |
| `realtimeHub.js` | **Good** — auth, membership, relay, reconnect |
| `visit.controller.js` (withdrawal, tier translation) | **Good** |

### What is not covered by automated tests

| Area | Status | Why it matters |
|---|---|---|
| **HTTP route integration** | ❌ None | No test drives an actual Express route end to end. Middleware ordering, the router-level admin lockout and role guards are verified only by code reading |
| **RLS policies** | ❌ None | ~40 policies, no test connects with an anon key and asserts a denial. The most significant gap |
| **Authorisation matrix** | ❌ None | No test asserts that a doctor gets 404 on another doctor's case |
| **Consultation state machine** | ❌ None | Race guards, join windows, sweeper — the partial unique indexes are untested |
| **Scheduling engine** | ❌ None | Slot grid, IST boundaries, `nextSlotBoundary` |
| **Document OCR (non-health-card)** | ⚠️ Live script only | The two schemas and the Tesseract fallback |
| **Vision service** | ⚠️ Live script only | |
| **Lab interpretation** | ❌ None | |
| **PDF generation** | ❌ None | Three templates, tier gating |
| **Referral routing** | ❌ None | Haversine, nearest-hospital selection |
| **Admin controller** | ❌ None | Scoping, `CREATABLE_ROLES`, the Auth rollback |
| **Frontend** | ❌ None | No component or E2E tests at all |
| **The Python service's HTTP layer** | ⚠️ Partial | `match_symptoms` and `gate_candidate` are tested directly; the FastAPI endpoints are not |
| **Load and performance** | ❌ None | |

### An honest reading

The suite is **deep on the clinically dangerous paths and shallow on the
plumbing**. That is a defensible allocation for the time available — a bug in
`riskEngine.js` can harm a patient, while a bug in the admin roster is an
inconvenience. But the RLS and authorisation gaps are the ones that matter most,
because those are the layers that would fail *silently* and where a defect is a
breach rather than a malfunction.

---

## 8. What would close the gaps, in priority order

| Priority | Work | Why first |
|---|---|---|
| 1 | **RLS policy test suite** — connect as each role with the anon key and assert both permitted reads and denials | ~40 untested policies enforcing the central privacy guarantee |
| 2 | **Authorisation matrix integration tests** — supertest against the real app with a stub `authenticateUser`, asserting the full table in [Section 10](10-authorisation.md) | Catches a route added without a guard, which the router-level lockout is designed to make safe but which should still be proven |
| 3 | **Consultation state-machine tests** — including concurrent inserts against the partial unique indexes | The race guard is the one piece of concurrency correctness in the system |
| 4 | **Scheduling tests** — IST boundaries, `nextSlotBoundary` (the docstring already lists verified cases: 2:31→2:35, 2:36→2:40, 2:59→3:00) | Timezone arithmetic is where silent errors live |
| 5 | **Frontend component tests** for `TierResult`, `OCRVerificationModal` and `RequireRole` | The three components carrying safety-relevant behaviour |
| 6 | **A CI pipeline** running `npm test`, `pytest` and `npm audit` on every push | None exists today |
| 7 | **E2E smoke test** — register → assess → hand off → review | Would have caught the `consultation_scheduled` enum defect |

---

## 9. Quality practices beyond tests

### Comments record the defect, not the behaviour

The codebase's most distinctive quality practice: a comment explains **what a
line prevents**, with the specific failure that occurred.

```js
// This insert had been failing on every wound photo ever taken. It wrote
// `image_type`, a column the live table does not have, so Postgres rejected
// the row — and the failure was a console.warn, so the request still returned
// the analysis, the screen still showed it, and the table stayed empty.
```

This is why the source reads as a record of nine batches of remediation
(`docs/PHASE2_PROGRESS.md`) rather than as a first draft.

### Loud failures where silence hid a bug

```js
if (imgErr) {
  console.error('patient_images insert FAILED — the doctor will not see this photo:', imgErr.message);
}
```

Deliberately `console.error`, not `console.warn`. The previous warning hid this
for the lifetime of the feature.

### Verify before claiming

`HANDOFF.md`: *"Every 'done' in `docs/PHASE2_PROGRESS.md` has a command or a
measurement behind it."* The `seed:daily` entry in `implementation_plan.md` is a
good example — it records the exact production distribution
(`moderate=750, low=375, high=375, emergency=375`) and that re-running reproduces
an identical assignment, confirmed by fingerprint.

### Deterministic seeds

`seedV2.js` uses a fixed xorshift RNG (`rngState = 0x2f6e2b1`) so the same seed
produces the same dataset, and `seedDailyWorkload.js` is stable per date. A
demonstration is reproducible, and a bug found in a demo can be reproduced
exactly.

---

## 10. Running everything

```bash
# Unit suite — no network, no AI spend
cd backend && npm test
cd backend && npm run test:watch

# Python matcher regression
cd AI/LLM && ../.venv/bin/python -m pytest eval/ -v

# Live checks — real API calls
cd backend
npm run check         # 8 services + model existence + formulary gate
npm run check:ai      # OCR, lab and vision pipelines against live models
npm run preflight     # is the system demo-ready right now?
npm run inspect       # row counts and demo-flag warnings for a target database
```
