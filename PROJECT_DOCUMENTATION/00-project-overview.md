# 00 — Project Overview

> **Navigation:** [Index](README.md) · Next: [01 — Setup Guide](01-setup-guide.md)

---

## 1. What this platform is

A web platform that turns a village health sub-centre with a trained health
worker and no resident doctor into a functioning virtual clinic.

The health worker operates the system. The patient never touches it. A remote
doctor, working from a district town or anywhere with a network, receives
prepared cases and makes every clinical decision.

Concretely, the software does eight things that a paper register and a phone
call cannot:

1. Captures spoken symptoms in Hindi and other Indian languages and turns them
   into structured text (`backend/src/services/speechService.js`).
2. Reads paper prescriptions and multi-page lab reports by photograph, and
   requires a human to confirm the reading before it counts as clinical input
   (`backend/src/services/ocrService.js`,
   `frontend/src/components/OCRVerificationModal.jsx`).
3. Reads photographs of visible injuries and returns observational findings that
   are explicitly never a diagnosis (`backend/src/services/visionService.js`).
4. Tiers every case LOW / MEDIUM / HIGH by deterministic rules that a language
   model can raise but never lower (`backend/src/services/riskEngine.js`).
5. Proposes ranked disease candidates from a classifier trained on 244,938
   labelled symptom vectors, and shows them to the doctor as clearly-labelled
   statistical evidence rather than folding them into prose
   (`AI/LLM/service/app.py`, `backend/src/services/aiOrchestrator.js`).
6. Hands the case to a named doctor in the same district, with a manifest of
   exactly what the doctor will receive
   (`backend/src/controllers/visit.controller.js` → `handOffVisit`).
7. Runs a peer-to-peer video consultation over the platform's own authenticated
   WebSocket, with no third-party video SDK
   (`backend/src/services/video/P2PProvider.js`, `frontend/src/pages/CallPage.jsx`).
8. Routes a HIGH-risk case out of the platform entirely to the nearest of 75
   real district hospitals, by coordinates, with no paid mapping API required
   (`backend/src/services/referralService.js`).

---

## 2. The core product principle

> **AI prepares the case. The doctor makes the medical decision.**

This is not a slogan on a landing page; it is a set of enforced boundaries. Each
one is a specific mechanism you can open and read:

| Boundary | Where it is enforced |
|---|---|
| The language model may never state a diagnosis | System prompt rule 1, `aiOrchestrator.js:22` |
| The language model may never name any medicine, dose, frequency or duration — not even OTC | System prompt rules 4 and 5, `aiOrchestrator.js` |
| Whatever the model says about medicine is **discarded**, not filtered | `delete finalAssessment.medications` — `aiOrchestrator.js` §7 |
| The health worker is shown no medication at all, at any tier | `tierWorkflowService.js` → `medicationFor()` returns `emitted: false` unconditionally |
| Any medication that ever *is* emitted must carry a formulary rule id | `formularyService.js` → `assertRuleSourced()` throws otherwise |
| Deterministic rules set a floor the model cannot lower | `riskEngine.js` → `higherTier()`; `final = MAX(rule, vision, model)` |
| A degraded model fails safe to MEDIUM, never LOW | `aiOrchestrator.js` §5, `degradedReason` branch |
| Nothing is ever fabricated — an empty result is a valid answer | `speechService.js` header comment and `noSpeechResult()`; `ocrService.js` → `extractionFailure()` |
| Administrators cannot read a patient record at all | `clinicalAccess.middleware.js` + no admin role in any RLS policy on `patients`/`visits` |

Nine tests in `backend/tests/medicationBoundary.test.js` and
`backend/tests/aiOrchestrator.test.js` assert these directly, including one that
plants a plausible-looking model-authored medication and asserts it is
discarded.

---

## 3. Every built feature

Nothing in this section is planned, partial or stubbed. Where a feature has a
limitation, the limitation is stated here rather than deferred.

### 3.1 Patient registration — six fields, everything else derived

`backend/src/controllers/patient.controller.js`,
`backend/src/services/patientFields.js`,
`frontend/src/pages/PatientRegistrationPage.jsx`

The Aadhaar number **is** the primary key of `patients` — there is no second
patient code to print, type and mistype. Registration collects six things:
Aadhaar (12 digits), full name, gender, date of birth, address (village line 1,
optional line 2, district, state, PIN), and phone.

Age is **never stored**. `ageFromDob()` computes it per request. A stored age is
wrong the day after registration, and the triage engine applies different
thresholds to infants and to adults — so a stale age is a clinical error, not a
display bug. Under two years, `ageDisplay()` reports months and then days,
because "0 years" tells a doctor nothing about a neonate.

Registration is two steps: the Aadhaar is checked against the register first
(`POST /api/patients/lookup`), and the rest of the form opens only if it is new.
A returning patient is the common case at a sub-centre.

Lists render `XXXX XXXX 9012`; the full number appears only on the single-patient
view. Aadhaar Act 2016 §29(4) prohibits public display of the full number, and a
patient list on a shared clinic screen is that situation.

### 3.2 Emergency registration bypass

`registerUrgentPatient` in `patient.controller.js`,
`database/v2/09_emergency_registration.sql`,
`frontend/src/components/UrgentRegistrationModal.jsx`

A patient who arrives without documents gets a provisional record. A guest
identifier is allocated with a leading `1`; UIDAI allocates real Aadhaar numbers
from 2–9, so the identifier satisfies the 12-digit column constraint while being
structurally incapable of colliding with a real person's number.

Every identity field the clinic does not have is left **null**, not invented.
This required migration 09: `phone`, `pin_code`, `village_line1`,
`address_district` and `address_state_id` were `NOT NULL` *and* format-checked,
so registering an undocumented patient previously demanded inventing a mobile
number and a PIN that would pass those checks — fabricated values
indistinguishable from real ones, inside a clinical record. A conditional CHECK
now keeps the requirement for standard and ABHA registrations only.

An **estimated age is still required**, because triage thresholds differ for
children and the elderly and a missing age silently changes how the patient is
scored. The estimate is converted to a date of birth; `registration_mode =
'emergency_bypass'` on the row is what marks it as an estimate.

### 3.3 Multilingual speech capture

`backend/src/services/speechService.js`, `POST /api/voice/transcribe`

Groq `whisper-large-v3-turbo` with automatic language identification across
Hindi, English, Tamil, Telugu, Marathi, Bengali and Gujarati.

The substantive engineering here is refusal. Whisper emits training-data
artefacts on silence — channel sign-offs, URLs, "Thanks for watching" — and in a
symptom field those are fabricated clinical input. Two independent detectors run:

- `looksHallucinated()` matches whole transcripts against known artefact
  patterns.
- `isPaddingArtifact()` catches Whisper's structural tell. `no_speech_prob` is
  not usable: on one second of pure digital silence Whisper returned "Thank you."
  with `no_speech_prob: 0`. The reliable signal is that Whisper pads short audio
  to a 30-second window and labels the whole padded window, so a segment ending
  more than five seconds past the reported duration is the artefact.

No prompt naming clinical vocabulary is sent to Whisper, because priming it with
symptom words makes it more likely to emit them from unclear audio.

When nothing usable is captured the endpoint returns `ok: false` with a reason
and an **empty** transcript. It never substitutes a plausible sentence. An
earlier version substituted a fixed Hindi sentence describing fever, cough and
body pain — and "fever" plus "cough" is a MEDIUM-tier rule in the triage engine,
so a silent recording could produce a triaged case describing a patient who did
not exist.

Seven tests in `backend/tests/speechService.test.js` cover this.

### 3.4 Document OCR with mandatory human verification

`backend/src/services/ocrService.js`, `backend/src/controllers/document.controller.js`,
`frontend/src/components/OCRVerificationModal.jsx`,
`frontend/src/components/FileCaptureInput.jsx`

Two engines in order: Gemini multimodal, which reads images **and PDFs natively,
all pages in one request**, then Tesseract per image followed by Groq text
structuring for anything Gemini declines.

One upload may carry several files, because one document often is several files
— pages 1..N of a lab report, or the front and back of a prescription. They are
sent as one model call so cross-page context survives: the header on page 1 and
the reference ranges on page 3 belong to the same reading.

Two different extraction schemas, because a prescription and a lab report carry
different information and a single generic schema read neither well:
`PRESCRIPTION_SCHEMA` (medicines, strengths, frequencies, `1-0-1` notation
preserved as written) and `LAB_REPORT_SCHEMA` (panels, tests, values, units,
reference ranges, abnormal flags).

**Nothing reaches the clinical record until a human confirms it.**
`POST /api/documents/:id/verify` is what sets `verified_by` and `verified_at`;
until then the extraction is a draft. `handOffVisit` reports verified and
unverified document counts separately in its manifest.

Tesseract is screened by magic bytes before it sees a buffer
(`looksLikeDecodableImage`). Tesseract.js reports a failed decode by throwing
from its worker thread on a later tick, which escapes the surrounding try/catch
and took the whole Node process down — one truncated upload from one assistant
killed the backend for every clinic.

### 3.5 Health card / ABHA card reading

`readHealthCard()` in `ocrService.js`, `POST /api/documents/health-card`,
`frontend/src/components/HealthCardScanner.jsx`

Deliberately separate from clinical-document OCR, and it **stores nothing**. It
runs during registration, before a patient record exists, and its output is a
proposal the operator accepts field by field.

Every field is validated rather than trusted (`validateHealthCardFields`): a name
of pure digits is a misread card number, a date of birth in the future is a
misread, a gender outside the enum is refused. A rejected field is simply absent,
and the API reports which fields it refused — a card whose date of birth failed
validation should say so, rather than silently returning three fields when the
operator can see four printed on the card.

Most Indian cards print only a year of birth. That is returned as
`year_of_birth` and is **never** turned into a full date; the form asks the
operator.

Fourteen tests in `backend/tests/healthCardOcr.test.js`.

### 3.6 Wound and injury photograph analysis

`backend/src/services/visionService.js`, `POST /api/vision/analyze`

Gemini vision, with a three-model fallback chain, because Gemini free-tier quota
is **per model**: a key exhausted on one model while another answers normally
would otherwise silently disable every wound photo.

Output is observational only. The prompt forbids stating a diagnosis; every
entry in `possible_conditions` is phrased as an appearance ("consistent with a
superficial partial-thickness burn"), and `confidence` is **capped at
"moderate" in code as well as in the prompt** — a model that ignores its
instruction must not be able to present a photograph as high-confidence
evidence.

`severity_impression` (LOW/MEDIUM/HIGH) can **raise** the triage tier and can
never lower it (`aiOrchestrator.js` §1).

Photographs go to a **private** Supabase Storage bucket. The stored row carries
a `storage_path` and no URL; readers mint a one-hour signed URL on demand
(`backend/src/services/imageAccess.js`). A permanent link to a clinical
photograph of an identifiable patient would be viewable by anyone who ever saw
it, indefinitely, with no authentication.

The vision observation is stored **alongside** the file in
`patient_images.observation`, because that is what the doctor actually reads and
re-running the model on an old photo would cost money and could return something
different.

### 3.7 Deterministic clinical triage

`backend/src/services/riskEngine.js` — the single most important file in the
repository. Three invariants it is solely responsible for:

1. **Escalation is monotonic.** `higherTier()` may raise a tier and can never
   lower one.
2. **Missing data escalates.** Each absent core vital is named, and the tier is
   floored at MEDIUM. Absence of evidence is not evidence of absence.
3. **LOW is earned, never defaulted.** It requires SpO₂, temperature, blood
   pressure, pulse and age all present and in range.

Specific clinical content:

- **Age-banded thresholds** across seven bands from under-1-month to adult,
  derived from PALS and WHO IMNCI. Every threshold used to be an adult one
  applied to every patient — which flags every well infant as MEDIUM (a healthy
  6-month-old has a pulse of 130) and leaves a 5-year-old in early shock at a
  pulse of 140 under no rule at all. The adult row keeps the original values
  exactly, so no adult case changed tier when this table was added.
- **Celsius auto-conversion.** Every threshold is in °F. An unconverted 39 °C
  reads as 39 °F, below every threshold — a high fever would have triaged LOW.
  Human temperatures in °C never reach 45 and in °F never fall below 80, so the
  scales cannot be confused in any survivable range. The conversion is surfaced
  in the warnings.
- **A reading of `0` is a reading.** `toNumber()` distinguishes absent from
  zero. `if (spo2)` treats an SpO₂ of 0 — a device fault or a peri-arrest
  patient — as "not recorded" and skips every red-flag check.
- **IMNCI dehydration as a syndrome**, not a single vital crossing a line. Fluid
  loss plus two dehydration signs is Plan B (MEDIUM); fluid loss plus a severe
  sign is Plan C (immediate referral); fluid loss in a child under five escalates
  regardless, because that group decompensates fastest.
- **Immediate-referral red flags:** SpO₂ < 90, systolic BP < 90 or ≥ 180, seven
  red-flag symptom phrases, and any fever in an infant under 2 months (IMNCI).

Twenty-eight tests in `backend/tests/riskEngine.test.js`, organised by invariant.

### 3.8 The assessment pipeline

`backend/src/services/aiOrchestrator.js`

Eight ordered stages. The order is the safety argument:

1. Deterministic rule triage → `ruleTier`. This is the floor.
2. Vision severity may raise the tier.
3. Statistical disease candidates from the Python service, bounded — the
   language model may re-rank and reject them but may not introduce a disease
   outside the list. That bound is what keeps the output traceable to training
   data rather than to the model's imagination.
4. Protocol retrieval (`ragEngine.js`) with an `approved = true` filter.
5. Language-model synthesis of the doctor-ready handoff.
6. Re-derivation of everything that depends on the final tier.
7. Medication deleted from both sources, unconditionally.
8. Immutable safety metadata attached: `rule_tier`, `degraded`, `missing_data`,
   `immediate_referral`, `risk_reasoning`, `legal_disclaimer`.

If the model is unavailable, times out, or returns off-schema, `degradedReason`
is set and a LOW case is floored at MEDIUM with an explicit warning that
*"This case was not assessed by the model."*

### 3.9 Tier-specific workflows

`backend/src/services/tierWorkflowService.js`

Each tier produces a genuinely different output set, because each changes who is
accountable for the patient next:

| Tier | Headline | Doctor queue | Consultation | Referral |
|---|---|---|---|---|
| LOW | Protocol care — complete plan issued | `DAILY_REVIEW` (batch, not an interruption) | none | none |
| MEDIUM | Video consultation required before treatment | `CONSULTATION` | required, speciality-routed | none |
| HIGH | Refer immediately — danger zone | `NONE` — the case leaves the platform | none | nearest hospital + emergency lines |

MEDIUM routing uses `specialityFor()`, which matches the top disease candidates
against eight speciality patterns (Cardiology, Pulmonology, Dermatology,
Orthopaedics, Obstetrics & Gynaecology, Paediatrics, Ophthalmology, ENT) and
falls through to General Medicine — the correct default, not a failure.

Precautions come from the Kaggle-sourced dataset via the Python service, keyed
on the top candidate, with a fuzzy fallback at score ≥ 80 and a protocol-sourced
default. Diet guidance is pattern-matched against five clinical patterns and
returns **nothing** rather than filler when there is no confident match.

### 3.10 HIGH-risk referral routing

`backend/src/services/referralService.js`, `AI/LLM/data/up_district_hospitals.json`

All **75 Uttar Pradesh district hospitals** with real coordinates ship as a data
file. Nearest-facility routing is haversine — no Google Maps key required, which
matters twice over: a rural sub-centre may be on a poor link exactly when this
screen is needed most, and a referral must not fail because a billing quota was
exceeded. If `GOOGLE_MAPS_API_KEY` is set, the straight-line answer is upgraded
to live driving distance, but the straight-line answer is computed first and
stands if that call fails.

`capacity_status` is hard-coded to `'UNKNOWN'` with an instruction to confirm by
phone. There is no public real-time bed-availability feed for UP district
hospitals, and an invented bed count on a referral screen is the single most
dangerous thing this system could display. The four emergency numbers shown
(108, 102, 104, 112) are nationally published; individual hospital switchboard
numbers are deliberately **not** listed, because there is no authoritative public
register of them and a wrong number on a referral screen costs minutes at exactly
the wrong moment.

### 3.11 Case handoff to a named doctor

`handOffVisit` in `backend/src/controllers/visit.controller.js`

The assistant selects a doctor from the district roster
(`GET /api/doctor/directory`) and hands the case over. The endpoint:

- verifies the doctor is active, is a doctor, and is **in the same district**;
- reads the tier from the visit rather than accepting one from the client;
- refuses only a case with *nothing* in it (422), and otherwise reports what is
  thin in a `missing` array — a clinician escalating an urgent patient must not
  be blocked because the vitals are not typed in yet;
- returns a **manifest** of exactly what the doctor will receive: assessment
  present, vitals count, symptoms count, documents count, verified-documents
  count, images count. "Case sent" with no statement of what was sent is what let
  empty cases through unnoticed;
- persists a `CASE_ASSIGNED` notification **before** pushing it live, so a doctor
  who was offline still finds the case waiting.

### 3.12 Doctor queue and case review

`backend/src/controllers/doctor.controller.js`,
`frontend/src/pages/DoctorQueueDashboard.jsx`,
`frontend/src/pages/DoctorCaseViewPage.jsx`

A doctor sees **only cases assigned to them**, day-wise, sorted worst-first
(`RISK_ORDER = { emergency: 0, high: 1, moderate: 2, low: 3 }` — Postgres would
sort the enum in declaration order, which is the wrong direction, so ordering is
done in Node). Ownership is checked **inside the query**, not after the fetch, so
a doctor cannot read another doctor's case by guessing a visit id.

Past days are read-only, enforced both in the response (`read_only: true`) and
again in `recordDoctorReview` — a tab left open overnight would otherwise be able
to close yesterday's case as if it were today's.

A review requires a decision from a fixed set (`treat_locally`, `prescribe`,
`refer_hospital`, `follow_up`, `no_action_needed`) **and a diagnosis**. A
`prescribe` decision requires at least one medicine; a `refer_hospital` decision
requires a named hospital. The prescription is written to `prescriptions` as a
separate signed clinical record, not as a note.

Closing the loop: a `DOCTOR_REVIEW_COMPLETED` notification goes back to the
assistant who opened the visit, carrying the patient id so the alert can navigate
to the right screen. `GET /api/visits/:id/review` and `DoctorReviewPanel.jsx`
render it on the assistant's side.

### 3.13 Consultation scheduling and the state machine

`backend/src/services/schedulingService.js`,
`backend/src/controllers/consultation.controller.js`,
`database/v2/05_consultations.sql`

State machine: `SCHEDULED → ACTIVE → COMPLETED`, plus `CANCELLED` and `MISSED`.
Every transition happens server-side; the frontend requests one and renders
whatever comes back.

Availability is computed from `doctor_schedules` (one row per doctor per weekday;
a missing row means "not working", the same as `is_off`) intersected with
existing SCHEDULED/ACTIVE consultations. 5-minute slot grid, 15-minute
consultations, ±5-minute join tolerance, all in IST.

The booking path re-runs the entire availability check **at booking time**,
because a slot list rendered eight seconds ago is a guess, not a fact. The final
backstop is two partial unique indexes:

```sql
CREATE UNIQUE INDEX idx_one_active_per_doctor  ON consultations(doctor_id)  WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX idx_one_active_per_patient ON consultations(patient_id) WHERE status = 'ACTIVE';
```

An application-level "is this doctor free?" check loses to a concurrent request
every time; the database does not. `createInstantConsultation` walks the
candidate list and treats a unique violation as "someone took this doctor" and
moves to the next.

A background sweeper (`consultationSweeper.js`, 60-second timer) marks expired
SCHEDULED consultations `MISSED` and fires reminders ~10 minutes before start,
re-reading `status` at send time and marking `reminder_sent_at` **before**
notifying so a crash cannot duplicate a reminder.

### 3.14 Video consultation

`backend/src/services/video/`, `frontend/src/pages/CallPage.jsx`

Peer-to-peer WebRTC. Media flows directly between the two peers; signalling goes
over the platform's own authenticated WebSocket. No third-party video SDK, no
per-minute cost, and consultation media never traverses a vendor.

A `VideoProvider` abstraction (`VideoProvider.js`) means the consultation state
machine never imports a media type. Two implementations exist: `P2PProvider`
(active) and `MediasoupProvider` (an SFU, written and complete, but see
[16 — Known Limitations](16-known-limitations-and-risks.md#l4) — `mediasoup` is
not in `package.json`, so P2P is the provider on every host today).

Client-side correctness:

- **Perfect negotiation** with politeness fixed by role (`DOCTOR` is polite).
  Election by arrival order cannot survive a rejoin, where both peers are already
  present.
- **Declarative membership.** The server forgets a socket's call room the moment
  it disconnects, so `call:join` is re-sent on every reconnect rather than once
  at startup.
- **Outbound buffering with a 10-second TTL.** The socket authenticates via a
  database lookup, so it is still opening for a few hundred milliseconds after
  the page starts working; a `call:join` sent into a CONNECTING socket is
  silently dropped. Stale SDP and ICE are dropped rather than replayed.
- **Media survives a signalling reconnect.** The peer connection is deliberately
  not rebuilt, because WebRTC media is unaffected by the signalling socket
  dropping.

Room ids are random UUIDs. An earlier build used
`room_<patient_code>_<timestamp>`, which was guessable.

### 3.15 Realtime notifications

`backend/src/services/realtimeHub.js`, `notificationService.js`,
`frontend/src/context/RealtimeContext.jsx`

**One** authenticated WebSocket at `/realtime` carries both notifications and
call signalling. Identity always comes from the verified token resolved against
`staff_profiles` — never from the query string. The original signalling server
accepted `role=DOCTOR` in a URL as sufficient to join a live consultation.

Every event is **persisted first, then pushed**. A doctor whose laptop was asleep
still sees what happened. `call:join` re-verifies participation against the
consultation row, so a leaked or replayed token alone cannot put someone into a
call. A reconnect **replaces** the stale socket rather than being rejected as a
third participant.

Ten tests in `backend/tests/realtimeHub.test.js` drive a real `ws` server.

### 3.16 Server-side PDF export

`backend/src/services/reportPdfService.js`, `GET /api/reports/visits/:id/:type.pdf`

Three templates — `summary` (every tier), `prescription` (LOW only), `referral`
(HIGH only, refused with a 409 for any other tier, because printing a referral
sheet for a routine visit would put an "URGENT" banner on it).

Rendered with `pdfkit` rather than `window.print()` for three reasons that matter
in this setting: identical output on the Android tablets a sub-centre actually
uses, where print-CSS support is unreliable; the file can be attached to the
record rather than only sent to a printer; and no headless browser dependency, so
it runs on a small dyno.

The document is **rebuilt** rather than stored — precautions, medication
availability and the nearest hospital can all change between the assessment and
the reprint, and a stale referral distance is worse than a slower render. The PDF
route carries the same district and assignment scoping as every other clinical
read, because a printable document is the easiest kind of record to forward on.

Aadhaar is masked to `XXXX XXXX NNNN` in every PDF.

### 3.17 Case withdrawal

`deleteVisit` in `visit.controller.js`, `database/v2/08_visit_soft_delete.sql`

A soft delete. The row stays, stops being visible, and records who withdrew it
and why. The thing being removed is a clinical record: a mistyped Aadhaar means
the wrong patient's history shows an entry that is not theirs, which is worth
fixing — but a hard DELETE makes an operator error unrecoverable.

Four guards, and each refusal says which one applied: the case must be in the
caller's district, have no assigned doctor, have no consultation, and have no
doctor review. Past those points it is not an accidental entry any more. The
update is a compare-and-set on `deleted_at IS NULL`, so two clicks produce one
delete. Twelve tests in `backend/tests/visitWithdrawal.test.js`.

### 3.18 Administration and analytics

`backend/src/controllers/admin.controller.js`,
`database/v2/10_admin_analytics.sql`, `frontend/src/pages/AdminDashboard.jsx`

Staff CRUD scoped by `req.scope`, derived from the caller's own profile — a query
parameter can narrow the result but never widen it. `CREATABLE_ROLES` is
deliberately asymmetric: a district admin cannot mint a peer or a superior, so a
compromised district account cannot widen its own blast radius.
`DELETE /api/admin/users/:id` **suspends** rather than deletes, and bans the Auth
credential so an existing session cannot outlive the suspension.

Analytics are aggregated by a Postgres function `admin_analytics(scope_state,
scope_district)` returning JSONB. They were computed in Node first, by selecting
rows and counting them — PostgREST caps a response at 1,000 rows whatever limit
is asked for, so the demographics silently described the first thousand of 1,876
patients and every "busiest district" came back as exactly 25. Figures that were
wrong and entirely plausible at the same time. The function returns visit funnel
counts, risk distribution, a 14-day trend **including quiet days** (a line that
skips days with no visits reads a closed Sunday as busy), gender and age-band
demographics, and top districts. Withdrawn visits are excluded throughout.

`GET /api/admin/audit` is the one endpoint the `AUDITOR` role exists for.

### 3.19 Audit logging

`backend/src/middleware/audit.middleware.js`

Nineteen distinct action types are written across the controllers, including
`LOGIN_SUCCESS`, `LOGIN_DENIED_NO_PROFILE`, `LOGIN_DENIED_INACTIVE`,
`PATIENT_REGISTERED`, `PATIENT_LOOKUP_HIT`/`_MISS`, `VISIT_CREATED`,
`VISIT_WITHDRAWN`, `CASE_HANDOFF`, `CASE_OPENED`, `AI_ASSESSMENT_GENERATED`,
`DOCTOR_REVIEW_RECORDED`, `CONSULTATION_*`, `DOCUMENT_UPLOADED`,
`DOCUMENT_EXTRACTION_VERIFIED`, `HEALTH_CARD_SCANNED`,
`REPORT_PDF_GENERATED`, `STAFF_ACCOUNT_CREATED`/`_UPDATED`/`_SUSPENDED`.

`REDACT_KEYS` strips `aadhaar`, `aadhaar_number`, `aadhar`, `password`, `token`
and `abha_number` to `****NNNN` recursively before writing, because the audit
table is the one table the widest set of roles can read — every admin tier plus
auditors, none of whom have clinical access. An audit write failure never breaks
the request it is recording.

`03_rls.sql` gives `audit_logs` **no UPDATE and no DELETE policy for any role**,
so with RLS on, entries cannot be altered or removed through the API at all.

### 3.20 Text-to-speech read-aloud

`frontend/src/components/SpeakButton.jsx`

The browser's own `SpeechSynthesis`, not a cloud TTS service, for three reasons
specific to a village sub-centre: it works offline, which is exactly when a data
link is worst; it costs nothing per play, so an assistant can replay freely; and
the patient's clinical text never leaves the device to be synthesised. Language
follows the patient's recorded preference, with Awadhi, Bhojpuri, Braj and
Bundeli mapped to `hi-IN` because no distinct voice exists.

---

## 4. Scope

### In scope, and built

Patient registration and demographics · emergency bypass registration ·
multilingual speech capture · prescription and lab-report OCR with human
verification · health-card reading · wound-photo observation · deterministic
triage · statistical disease candidates · protocol retrieval · doctor-ready
summary generation · tier-specific workflows · hospital referral routing · case
handoff · doctor queue, case view and review · signed prescriptions ·
consultation scheduling · peer-to-peer video · realtime notifications · PDF
export · case withdrawal · six-role administration · district-scoped analytics ·
audit logging.

### Deliberately out of scope

| Excluded | Why |
|---|---|
| A patient-facing app | The problem statement's operator is a trained health worker. A patient-facing symptom checker is a different product with a different safety profile. |
| Autonomous prescribing | Prohibited under the NMC Telemedicine Practice Guidelines 2020 and structurally impossible here — see §2. |
| Live hospital bed availability | No public real-time feed exists for UP district hospitals. Displaying an invented number would be actively dangerous. |
| Payments and billing | The deployment model in §8 is government-funded, not patient-paid. |
| Native mobile apps | The platform is a responsive web app; a sub-centre tablet runs a browser. |
| Longitudinal population risk detection | Designed in `AI/LLM/MASTER_PLAN.md` §2.5, not built. Not documented as a feature anywhere outside that plan. |

---

## 5. Problem-statement coverage

Every line of the problem statement's "Expected AI solution", mapped to the file
or feature that implements it. Nothing in this table is aspirational.

### 5.1 Information the system must collect and understand

| Required | Status | Implemented by |
|---|---|---|
| Patient symptoms | ✅ Built | `visit_symptoms` table; typed, speech or OCR-sourced (`source` column). `PatientAssessmentVisitPage.jsx` symptoms tab |
| Symptom duration | ✅ Built | `visits.symptom_duration_value` + `symptom_duration_unit` (days/months/years), validated in `createVisit`/`updateVisit`. Structured, not free text, so the rules can reason about it |
| Basic medical history | ✅ Built | `visits.medical_history` (migration `04_visit_history.sql`); merged into `combinedHistory` in `aiOrchestrator.js` and read by the comorbidity rule in `riskEngine.js` |
| Temperature | ✅ Built | `visit_vitals.temperature_f`, CHECK 80–115, Celsius auto-converted in `riskEngine.js` → `toFahrenheit()` |
| Blood pressure | ✅ Built | `visit_vitals.blood_pressure_systolic` / `_diastolic`, with a cross-field check that diastolic < systolic (`validateVitalsRanges`) |
| Pulse | ✅ Built | `visit_vitals.pulse_bpm`, age-banded thresholds in `VITAL_BANDS` |
| Oxygen level | ✅ Built | `visit_vitals.spo2_percent`; < 90 is an immediate-referral red flag; a reading of 0 is treated as a reading |
| Existing prescriptions | ✅ Built | `patient_documents` with `document_type = 'prescription'`; `PRESCRIPTION_SCHEMA` extraction |
| Medical reports | ✅ Built | `document_type = 'lab_report'`; `LAB_REPORT_SCHEMA`, multi-page, native PDF; plus `POST /api/ai/interpret-report` |
| Images of minor injuries / visible symptoms | ✅ Built | `patient_images` + `visionService.js`; private bucket, signed URLs |
| Patient age | ✅ Built | Derived from `patients.date_of_birth` by `ageFromDob()` per request; never stored |
| Other relevant information | ✅ Built | `visits.known_allergies`, `visits.current_medications`, `patients.abha_number`, `patients.registration_mode` |
| Preferred language | ✅ Built | `staff_profiles.preferred_language`; drives `SpeakButton` voice selection. Speech input auto-detects across 7 languages |

### 5.2 Expected AI solution — line by line

| Required capability | Status | Implemented by |
|---|---|---|
| Symptom and patient-information analysis | ✅ Built | `riskEngine.js` (deterministic) + `AI/LLM/service/app.py` `/diagnose` (Bernoulli NB over 244,938 vectors) + `aiOrchestrator.js` (synthesis). Three independent layers, combined as `MAX` |
| Speech-to-text | ✅ Built | `speechService.js`, Groq `whisper-large-v3-turbo`, 7 languages, auto-detect, with hallucination and padding-artefact rejection |
| Text-to-speech | ✅ Built | `SpeakButton.jsx`, browser `SpeechSynthesis`, offline-capable, `hi-IN` and regional mapping |
| Medical-document OCR | ✅ Built | `ocrService.js` — Gemini multimodal (multi-page, native PDF) with Tesseract + Groq fallback; two schemas; magic-byte screening |
| Patient-history summarisation | ✅ Built | `aiOrchestrator.js` produces `patient_summary` combining symptoms, vitals, OCR history and photo observations. `GET /api/patients/detail` returns the visit history; `getDoctorCaseDetails` assembles the full case |
| AI-assisted preliminary medicine recommendation | ✅ Built, and deliberately **not shown to the health worker** | `formularyService.js` — 8 gates over a 5-entry practitioner-signable formulary, every emission stamped `rule_source_id`. Every entry is currently `UNSIGNED_PLACEHOLDER`, so `REQUIRE_SIGNED_FORMULARY` suppresses output in production. See §5.3 |
| First-aid guidance for trained health workers | ✅ Built | `first_aid_steps` on every assessment, sourced from retrieved protocols; `TierResult.jsx` renders it as a numbered list with read-aloud. Wound cleaning and dressing is protocol 101 in `seedQdrant.js` |
| Remote doctor video/audio consultation | ✅ Built | `P2PProvider.js` + `realtimeHub.js` + `CallPage.jsx`. Instant and scheduled paths |
| Digital patient records | ✅ Built | 18 tables; append-only clinical rows; soft delete only, with guards |
| Appointment and queue management | ✅ Built | `schedulingService.js` (7-day strip, 5-minute slots, 15-minute consultations), `getDoctorQueue`, `getQueueDates`, `consultationSweeper.js` |
| Emergency-risk detection | ✅ Built | `riskEngine.js` immediate-referral branch: SpO₂ < 90, systolic < 90 or ≥ 180, seven red-flag phrases, infant fever, severe dehydration (IMNCI Plan C) |
| Hospital referral | ✅ Built | `referralService.js` — 75 real UP district hospitals by coordinates, haversine nearest-facility, four national emergency lines, printable referral PDF |
| Doctor review and approval workflow | ✅ Built | `POST /api/doctor/cases/:id/review` with mandatory diagnosis; `prescriptions` as a separate signed record; `DOCTOR_REVIEW_COMPLETED` notification back to the assistant; `GET /api/visits/:id/review` |
| AI suggestions clearly distinguished from doctor decisions | ✅ Built | `AIDoctorVisualSeparation.jsx`; `disease_candidates` block kept separate from model prose; `generated_by` stamped on every assessment; `legal_disclaimer` on every response; `ClinicalUseNotice.jsx` |
| Medicine restricted to safety-checked situations | ✅ Built, exceeded | Tier gate (LOW only) + signature gate + red-flag exclusions + contraindications + allergies + pregnancy + age band + weight requirement = **8 gates**. Then withheld from the health worker entirely |
| Must not encourage self-medication or replace diagnosis | ✅ Built | No patient-facing surface exists. `requires_doctor` defaults true. The system prompt forbids definitive diagnosis. Every response carries the disclaimer |

### 5.3 Where this project goes beyond the problem statement

These are not required by PS-3. They are the competitive gap, and each is
verifiable in the code.

| Beyond the statement | What it is | Why it matters |
|---|---|---|
| **A trained model, not only an API call** | Bernoulli Naive Bayes over 244,938 labelled symptom vectors, 377 symptoms → 582 diseases, top-1 0.854 / top-5 0.974 on 48,988 held-out cases. Artifact committed at `AI/LLM/data/models/symptom_nb.joblib` | Most teams wire a public LLM to a prompt. This has a measurable, reproducible, held-out accuracy figure that can be audited and re-run |
| **The language model is *bounded* by the trained model** | The LLM may re-rank and reject the classifier's candidates; it may not introduce a disease outside them (`aiOrchestrator.js` §1b) | Output stays traceable to training data rather than to the model's imagination |
| **Deterministic rules override the model, always** | `final = MAX(rule, vision, model)`; a model may raise a tier, never lower one | The most consequential decision in the system is not made by a probabilistic component |
| **Medication withheld from the health worker entirely** | PS-3 permits protocol-based OTC suggestions. This system builds that engine, tests it, and then does not show it to the operator | A health worker acting on a drug name from an automated summary is the specific outcome this boundary prevents |
| **Six roles with region scoping, not three** | `SUPER_ADMIN`, `STATE_ADMIN`, `DISTRICT_ADMIN`, `DOCTOR`, `CLINIC_ASSISTANT`, `AUDITOR` — with `CREATABLE_ROLES` asymmetry | PS-3 implies an admin. A national deployment needs state and district tiers, and compliance review needs a role that can read the log and change nothing |
| **Structural admin lockout from clinical data** | Router-level guard that fails closed for routes added later, plus no admin role in any RLS policy on `patients`/`visits` | Two independent layers stating the same rule |
| **Row-level security in the database, not only in Express** | ~40 policies in `03_rls.sql` | The service-role key bypasses RLS by design, which is why the Express guards remain. Either layer failing alone is not a breach |
| **Hallucination detection on speech input** | Structural padding-artefact detection, not `no_speech_prob` | Whisper returned "Thank you." on pure silence with `no_speech_prob: 0`. A fabricated symptom is worse than a missing one |
| **Age-banded paediatric triage** | 7 bands, PALS/IMNCI-derived, plus IMNCI dehydration as a syndrome | Adult thresholds applied to children are wrong in both directions, and the errors are not symmetric |
| **Deterministic, reproducible symptom matching** | Four documented iterations, sub-span windows, body-site penalty, deterministic tie-break | Python hash randomisation made the same patient text return `skin rash` on one run and `itchy ear(s)` on the next. A clinical record that cannot be reproduced is not a record |
| **Demographic impossibility gates** | `gate_candidate()` removes anatomically or developmentally impossible candidates | The classifier has never seen an age or a sex, and ranked "ovarian cyst" for a five-year-old boy |
| **Honest confidence reporting** | `confident: false` when the top candidate is under 15% across 582 classes | A flat posterior is the model saying it does not know. Rendering that as a ranked five invites the reader to treat 5% as a finding |
| **Unrecognised complaints surfaced, not swallowed** | `unmatched_fragments` returned and shown | The difference between "we found nothing" and "we did not understand the thing you were most worried about" |
| **A "not for clinical use" notice that is true** | `ClinicalUseNotice.jsx` on landing and sign-in | The thresholds are published-source-derived but not practitioner-reviewed for this deployment, and the system says so |
| **Self-hosted video with no vendor** | P2P WebRTC over the app's own authenticated socket | No per-minute cost, and consultation media never traverses a third party |
| **Referral routing with no paid API** | 75 hospitals by coordinates, haversine | Works when the link is bad, which is when it is needed |
| **Live-service check scripts separate from unit tests** | `npm run check`, `npm run check:ai`, `npm run preflight` | Twice caught bugs no unit test could — including a model that was listed by its provider but returned 404 to `generateContent` |
| **135 automated tests organised by safety invariant** | 9 suites | Each negative test is a failure that actually happened |

---

## 6. Feasibility

### 6.1 Technical feasibility — demonstrated, not argued

The system is deployed and answering:

```
$ curl https://ruralai-production-220.up.railway.app/api/health
{"status":"ONLINE","system":"Virtual Village Clinic AI Backend API",...}
```

One container runs the Express API, the built React SPA and the Python inference
service on loopback (`start.sh`, `nixpacks.toml`). One Supabase project holds
Postgres, Auth and Storage. That is two managed services for the whole platform.

The trained model artifact is **committed** (`symptom_nb.joblib`, 3.6 MB), so a
deploy needs no training step and no dataset download. Inference is a
`predict_proba` over a 377-dimensional binary vector — microseconds, no GPU.

### 6.2 Operational feasibility at a sub-centre

| Constraint | How the design handles it |
|---|---|
| Intermittent connectivity | Text-to-speech runs in the browser with no network. Referral routing is a local data file with haversine, no API. Every AI call degrades to a safe answer rather than an error |
| Low-end Android tablets | Server-side PDF rendering, because print-CSS is unreliable on those devices. No 3D inside clinical workflows — only on the public landing page |
| The health worker is not a clinician | Vitals are pre-filled with typical adult values so three boxes are changed, not six — and the form tracks which fields were actually confirmed and warns before running an assessment on defaults alone (`confirmedVitals`, `untouchedVitals`) |
| Handwritten Hindi prescriptions | Ambiguous words are transcribed with a `(unclear)` marker rather than dropped or invented; `1-0-1` frequency notation is preserved as written |
| Photographs are often bad | `FileCaptureInput.jsx` shows a live in-page camera preview so a blurred shot is caught before upload, not after a round trip |
| Cost per assessment | Four pooled Groq keys with round-robin and per-key benching; three-model Gemini fallback chain because free-tier quota is per model |

### 6.3 Clinical feasibility — the honest position

The triage thresholds are derived from published sources (NEWS2, PALS, WHO
IMNCI) and are **not reviewed by a registered medical practitioner for this
deployment**. The formulary is `UNSIGNED_PLACEHOLDER` on all five entries. The
system says both of these on its public pages and suppresses medication output
by default in production.

This is the single longest-lead-time item in the project and it is **blocked on a
registered practitioner, not on code**. Everything technical around it — the
signature field, the gate, the `rule_source_id` stamping, the `assertRuleSourced`
throw — is built and tested.

---

## 7. Scalability

Real numbers from the schema and the deployed architecture.

### 7.1 Current demonstrated shape

| Entity | Count | Source |
|---|---|---|
| States and union territories | 36 | `backend/src/data/regions.js`, seeded |
| Districts (Uttar Pradesh) | 75 | `regions.js`, seeded |
| District hospitals with coordinates | 75 | `AI/LLM/data/up_district_hospitals.json` |
| Doctors | 375 (5 per district) | `seedV2.js` `DOCTORS_PER_DISTRICT` |
| Clinic assistants | 75 (1 per district) | `seedV2.js` `ASSISTANTS_PER_DISTRICT` |
| Patients | 1,875 (5 per doctor) | `seedV2.js` `PATIENTS_PER_DOCTOR` |
| Visits | 1,875, risk-tiered across 7 days | `seedV2.js` |
| Deterministic daily workload | 375 doctors × exactly 5 cases | `seedDailyWorkload.js` — verified in production |
| Disease classes | 582 | `symptom_vocabulary.json` |
| Symptom vocabulary | 377 | same |
| Clinical alias mappings | 280 | `clinical_aliases.json` |
| Precaution sets | 41 diseases | `precautions.json` |
| Indexed medicine molecules | 5 (2,503 paracetamol products alone) | `medicine_index.json` |
| Seeded protocols | 3 | `seedQdrant.js` — a known gap |

### 7.2 What the schema is already sized for

The data model does not need to change to serve a state:

- `states` and `districts` are real rows with foreign keys, not free text. v1
  stored them as text, so "Uttar Pradesh", "UP" and "uttar pradesh" were three
  different regions and no admin scope could be expressed. All 36 states are
  already seeded; adding a state's districts is `INSERT`, not migration.
- `patients` is keyed on Aadhaar, which is already national and already unique.
  A patient registered in Ballia and later seen in Lucknow is one row.
- Tenancy is `clinic_district_id`, separate from the address. A migrant worker
  seen in Ballia who gives a Bihar address stays on Ballia's register.
- `idx_visits_doctor_queue ON visits(assigned_doctor_id, visit_date, risk_level)`
  is exactly the doctor-queue query. It stays a fast index scan whether the table
  holds 1,875 rows or 18 million.
- `visit_date` is a **generated stored column**
  (`(created_at AT TIME ZONE 'Asia/Kolkata')::date`), so day-wise partitioning by
  date is available without a data migration.
- `admin_analytics()` aggregates in Postgres, so dashboard cost is independent of
  patient count — the reason it exists is that the Node version silently
  truncated at PostgREST's 1,000-row cap.

### 7.3 Arithmetic for a full-state deployment

Uttar Pradesh has roughly 20,000 sub-centres and 4,000 PHCs. Taking the seeded
ratio and one assessment per patient visit:

| Quantity | Value | Basis |
|---|---|---|
| Sub-centres in scope (UP) | ~20,000 | Public IPHS figures |
| Assessments per sub-centre per day | 20 | Conservative for a working sub-centre |
| Assessments per day, statewide | 400,000 | 20,000 × 20 |
| Peak assessments per second (8-hour day, 3× peak factor) | ~42/s | 400,000 ÷ 28,800 × 3 |
| Rows added per assessment | ~6 (visit, vitals, symptoms, assessment, audit ×2) | From the insert paths |
| Rows per year | ~875 M | 400,000 × 6 × 365 |
| Rule-engine cost per assessment | pure function, no I/O | `riskEngine.js` |
| Classifier cost per assessment | one `predict_proba` on a 1×377 vector | `app.py` |

The binding constraints are not the schema:

1. **Hosted-model rate limits.** At 42 assessments/second the Groq key pool is
   the ceiling, not Postgres. The pool architecture (`keyPool.js`) already
   round-robins and benches; scaling it is adding keys or moving to an enterprise
   tier — and [Section 12](12-next-generation-model-roadmap.md) is the structural
   answer.
2. **In-memory rate limiting.** `rateLimit.middleware.js` counts per process, so
   behind N instances the real limit is N×. A shared Redis store closes it.
3. **In-memory realtime fan-out.** `userSockets` is a per-process `Map`, so
   multi-replica notification delivery needs either sticky sessions or a Redis
   pub/sub fan-out. Both failure modes are documented in
   [16 — Known Limitations](16-known-limitations-and-risks.md).

### 7.4 The scaling path, in order

| Stage | Change | Unblocks |
|---|---|---|
| 1 — today | Single container, single Postgres | One district demonstrably; 375 doctors and 1,875 patients seeded |
| 2 | Redis for rate limiting and socket fan-out | Horizontal API replicas |
| 3 | Split the Python inference service onto its own private-network host | Independent scaling of model inference from HTTP |
| 4 | Postgres read replica for `admin_analytics` and audit reads | Dashboard load isolated from the clinical write path |
| 5 | Monthly partitioning of `visits`, `audit_logs`, `notifications` on `visit_date` / `created_at` | Multi-year retention with bounded query cost |
| 6 | Move the SFU (`MediasoupProvider`, already written) onto a Linux host with `mediasoup` installed | Consultations with more than two participants — a specialist joining a call |
| 7 | Own model, on-premise per district | Removes the per-call vendor dependency entirely — see [Section 12](12-next-generation-model-roadmap.md) |

---

## 8. Revenue and sustainability

A rural sub-centre patient cannot be the payer, and designing as if they could be
is how this class of product fails. Four routes, in order of realism for this
architecture.

### 8.1 Government per-facility licensing (primary)

State health departments already procure software per facility under NHM
budgets. The unit of deployment here is a **sub-centre**, which is exactly the
unit the schema is scoped to (`staff_profiles.district_id`,
`patients.clinic_district_id`).

At a nominal ₹1,200 per sub-centre per year for 20,000 UP sub-centres, that is
₹2.4 crore annually for one state — set against a marginal infrastructure cost
that is genuinely small, because the expensive components are structurally cheap
here: video is peer-to-peer with no per-minute vendor fee, referral routing needs
no mapping API, text-to-speech runs in the browser, and the disease classifier is
a 3.6 MB artifact that runs on CPU.

### 8.2 Ayushman Bharat teleconsultation reimbursement

Under AB-PMJAY and the eSanjeevani framework, teleconsultations are a
reimbursable service. Every consultation on this platform already produces the
artefacts a claim needs, as durable rows:

- `consultations` — participants, `actual_start_time`, `actual_end_time`,
  computed `duration_seconds`
- `doctor_reviews` — the decision and the clinical note
- `prescriptions` — `prescription_code`, itemised, `signed_at`
- `audit_logs` — an independent, append-only record of the same events

No new capture is required to support reimbursement; the claim export is a query.

### 8.3 CSR and development-sector funding

The three highest-lead-time items are not software: practitioner review of the
formulary, a physician-reviewed MoHFW protocol corpus, and TURN/inference
infrastructure. These are exactly the line items CSR health budgets and
foundation grants fund, and each has a defined completion state in this
repository (`signature.status = 'SIGNED'`, a seeded protocol corpus, a configured
`TURN_URL`).

### 8.4 Anonymised population-health analytics

`admin_analytics()` already returns risk distribution, 14-day trend, gender and
age-band demographics and busiest districts — **with no patient-identifying
field**. That is a district-health-officer product on its own. It is listed last
deliberately: monetising health data is a governance decision that belongs to the
state, not to a vendor, and the platform's role is to make the aggregate
available under the state's own rules.

### 8.5 Why the cost base stays low

| Component | Conventional cost | Here |
|---|---|---|
| Video consultation | ₹1–3 per minute (hosted SDK) | ₹0 — P2P WebRTC over the app's own socket |
| Mapping / referral routing | Per-call mapping API | ₹0 — 75 hospitals as a local data file, haversine |
| Text-to-speech | Per-character cloud TTS | ₹0 — browser `SpeechSynthesis` |
| Disease classification | Per-token LLM call | ₹0 — 3.6 MB scikit-learn artifact on CPU |
| Assessment synthesis | Per-token LLM call | The only genuine per-call cost, pooled across four keys |
| Vision and OCR | Per-image API call | Genuine per-call cost, with a three-model fallback chain to survive free-tier quota |

Two of the six line items are the entire variable cost, and
[Section 12](12-next-generation-model-roadmap.md) is the plan to remove the first
of those two.

---

## 9. Government integration path

Reasoned from how the system is actually built, not from a wish list.

### 9.1 ABHA and Ayushman Bharat Digital Mission

**What already exists in code:**

- `patients.abha_number VARCHAR(17) UNIQUE` — the correct width for a
  14-digit ABHA number with separators.
- `registration_mode` enum carries `'abha_ocr'` as a first-class value.
- `abha_number` is populated **only from card OCR, never typed**
  (`createPatient`: `abha_number: req.body.abha_number || null, // only ever from ABHA OCR`).
- `readHealthCard()` extracts and validates `card_number` from an ABHA card
  photograph today.
- `abha_number` is in `REDACT_KEYS`, so it never reaches the audit table in the
  clear.

**What ABDM federation would add:** replacing the OCR read with an ABDM Health
Information Provider registration, so a consultation on this platform can push a
Health Information Type record into the patient's ABHA-linked longitudinal
record. The receiving structure already matches: a consultation produces a
`DiagnosticReport`-shaped assessment, a `Condition`-shaped diagnosis in
`doctor_reviews`, and a `MedicationRequest`-shaped `prescriptions.items` array.
The change is an adapter, not a data-model migration.

### 9.2 PHC and sub-centre hierarchy

India's public health hierarchy is Sub-centre → PHC → CHC → District Hospital.
The platform maps onto it as built:

| Tier | Role in this system | Where it lives in the schema |
|---|---|---|
| Sub-centre | Where the clinic assistant works; the unit of tenancy for every patient record | `staff_profiles.district_id` (assistant), `patients.clinic_district_id` |
| PHC / CHC | Where the reviewing doctor sits; the doctor is district-scoped and reviews only assigned cases | `staff_profiles` role `doctor` with `district_id`; `visits.assigned_doctor_id` |
| District Hospital | The HIGH-tier referral destination | `up_district_hospitals.json`, `referralService.js` |
| District health administration | `DISTRICT_ADMIN` — manages the roster in one district, cannot create peers or superiors | `roles.js` `CREATABLE_ROLES` |
| State health department | `STATE_ADMIN` — one state, scoped analytics and roster | `attachRegionScope`, `applyScope`, `admin_analytics(scope_state, …)` |
| National / MoHFW | `SUPER_ADMIN`, provisioned out of band only | `npm run seed:root`, never through the API |

The one honest gap: the sub-centre is currently the **district**, not a named
facility row. A `facilities` table keyed to a district, with
`staff_profiles.facility_id`, would make the hierarchy exact. Everything that
would consume it — scoping, RLS helpers, analytics grouping — is already written
against a scope object rather than a hard-coded column, so this is an additive
change.

### 9.3 MoHFW protocol alignment

**What is built:** `ragEngine.js` retrieves protocols filtered on
`approved = true`, and the payload index that makes that filter actually apply is
created explicitly in `seedQdrant.js` — without it Qdrant returns
`400 Index required but not found`, the whole vector block throws, retrieval
falls through to the keyword store, and *the approved-only safety filter never
runs*. The seeded protocols cite MoHFW and IPHS Standard Treatment Guidelines,
and `protocol_matches` carries title, source and version onto every assessment
and into the PDF.

The triage rules themselves are already aligned to national standards: WHO IMNCI
for paediatric respiratory rates, dehydration plans B and C, and the infant-fever
rule; PALS for age-banded pulse.

**What is needed:** the corpus is **3 demo protocols**. A physician-reviewed
MoHFW STG corpus is the substantive gap, and it is a content-and-governance task
rather than an engineering one. The ingestion path, the approval flag, the
version stamping and the citation rendering all exist and are exercised.

### 9.4 State health department deployment

The deployment shape a state department would need is already the shape the code
takes:

1. **Data residency.** One Supabase Postgres project, one container. Both can sit
   in an Indian region or on state-owned infrastructure — nothing in the schema
   or the code assumes a particular host. `AI_SERVICE_URL`, `SUPABASE_URL`,
   `DATABASE_URL` and `CORS_ALLOWED_ORIGINS` are the only location-bearing
   variables.
2. **Provisioning that matches government practice.** There is **no
   self-registration endpoint anywhere** — deliberately, and stated in
   `auth.routes.js`. Doctor and clinic-assistant roles are government-assigned,
   so accounts exist only because an administrator created them through
   `POST /api/admin/users`. A district admin's own scope is a database column,
   not a UI filter.
3. **Auditability.** `audit_logs` is append-only by RLS policy, redacted at write
   time, and readable by an `AUDITOR` role that can change nothing — so
   compliance review never requires issuing an admin account.
4. **Aadhaar handling with a documented migration path.** The current design
   stores the number as specified, accepts it in request bodies only, and redacts
   it in logs. `database/v2/README.md` records the exact change if the legal
   position is revisited: swap the column for `aadhaar_hash` + `aadhaar_last4`
   and update two lookup paths.
5. **Offline resilience at the edge.** Referral routing, text-to-speech and the
   entire rule engine work with no external call.
   [Section 12](12-next-generation-model-roadmap.md) extends that to the model
   itself.

---

## 10. Where to go next

- The exact schema, every constraint and the migration order:
  [06 — Database Schema](06-database-schema.md)
- How a single assessment actually travels through the system:
  [03 — Data Flow](03-data-flow.md)
- What is measured about the trained model:
  [11 — AI Model Training](11-ai-model-training.md)
- What is not built, not proven, or known broken:
  [16 — Known Limitations and Risks](16-known-limitations-and-risks.md)
