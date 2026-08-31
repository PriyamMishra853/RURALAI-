# Rural AI — Implementation Plan

Living document. Each phase is researched, planned here, approved, then executed.

**Production:** frontend on Vercel, backend on Railway, database on Supabase.
Pushing to `ruralai` (`github.com/PriyamMishra853/RURALAI-`) deploys live — every
push is confirmed with the maintainer first.

---

## Phase 0 — Consultation pipeline (video call + case handoff)

The two features the platform is actually for. Everything in Phases 1–3 assumes
these work, so they come first.

### 0.0 Production schema check — DONE

`doctor.controller.js` selects `patient_images`, but `database/v2/06_patient_images.sql`
was untracked in git, raising the possibility that every doctor case view was
returning a 500 in production.

Probed the production database directly. **`patient_images` exists**, and the
`notification_event` enum already carries `DOCTOR_REVIEW_COMPLETED`. The
migration had been applied by hand; only the file was uncommitted. No outage.

Two facts carried forward:

- `06_patient_images.sql` must eventually be committed. It currently lives only
  in `stash@{0}`, so a rebuild from `apply_all.sql` would silently omit it.
- `CASE_ASSIGNED` is **not** in the enum. Track 2 needs a migration to add it.

### 0.1 Video consultation — root cause

The backend state machine, scheduling, room reuse and participant checks are
correct. The failure is in the browser.

| # | Defect | Location |
|---|--------|----------|
| 1 | `sendMessage()` returns `false` and drops the payload when the socket is not `OPEN`. Nothing retries. | `RealtimeContext.jsx:41` |
| 2 | `call:join` is sent exactly once, mid-`join()`, while the socket may still be handshaking (its auth does a Supabase lookup first). Lost message → permanent "Waiting for the other participant". | `CallPage.jsx:124` |
| 3 | On reconnect the server drops the socket from `callRooms`; the client never re-declares membership. A network blip permanently kills a live consultation. | `realtimeHub.js:241` + `CallPage.jsx` |
| 4 | ICE candidates travel through the same `sendMessage`, so they are dropped by the same race. | `CallPage.jsx:70` |
| 5 | `initiator: peers.length > 0` breaks on rejoin — both peers present, one offers into a `stable` connection. | `realtimeHub.js:204` |
| 6 | `call:peer-left` leaves the old `RTCPeerConnection` in place, so a returning peer renegotiates against stale state. | `CallPage.jsx:187` |
| 7 | A second, dead WebRTC stack (`/signal`, `WebRTCVideoCallModal`, `handleExplicitStartVideoCall`) is still mounted in production. Unreachable — `activeVideoRoom` is never set — and broken anyway (POSTs `/consultations` with no `scheduled_start_time`, a guaranteed 400). | `signalingService.js`, `WebRTCVideoCallModal.jsx`, `PatientAssessmentVisitPage.jsx:400` |
| 8 | `isParticipant` compares `'completed'`/`'cancelled'` against an enum whose values are uppercase, so the check never matches. | `signalingService.js:70` |
| 9 | STUN-only ICE. Fails across carrier-grade NAT, which is the normal case on rural mobile ISPs. | `P2PProvider.js:81` |

### 0.2 Approach

Considered: (A) outbound queue + declarative rejoin, (B) server-authoritative
call presence, (C) a hosted SDK such as LiveKit.

**Chose A.** The infrastructure is already right; the client declares its intent
exactly once into a socket that may not be open. Making that intent declarative,
and the transport buffered, fixes the startup race and mid-call reconnects
together. (B) duplicates state the `consultations` row already holds. (C)
discards working code for a paid dependency.

### 0.3 Changes

1. **Transport buffer** — `RealtimeContext`: queue outbound messages while the
   socket is down, flush on `onopen`, cap the queue so a long outage cannot grow
   it without bound.
2. **Declarative membership** — `CallPage`: separate the HTTP join
   (`POST /join`, once) from the signalling join (`call:join`, re-sent on every
   reconnect). Register the message listener before joining.
3. **Perfect negotiation** — replace the arrival-order initiator election with
   the standard polite/impolite peer pattern, and rebuild the peer connection on
   `call:peer-left`.
4. **Delete the dead stack** — `signalingService.js`, the `/signal` mount,
   `WebRTCVideoCallModal.jsx`, `handleExplicitStartVideoCall`, `activeVideoRoom`,
   and the `/signal` probe in `checkServices.js`. Retires defects 7 and 8.
5. **TURN** — extend `buildIceServers()` to emit the UDP/TCP/443 variants a
   managed provider issues, from env vars so credentials never enter git.
   Surface a missing relay loudly in `npm run check`.

### 0.4 Case handoff — DONE (pending production migration)

Two defects, both of which made the case file useless in production rather than
merely imperfect.

**The handoff rejected most cases.** `/ai/assess` returns `{ ...aiResult }`, so
the browser receives the rule engine's `risk_level` — `MEDIUM` — while the
database enum is `low | moderate | high | emergency`. The assessment screen
lowercased it to `"medium"` and PATCHed it back, and `updateVisit` answered 400.
`medium` is the most common tier, so for most patients the button did nothing
but raise an alert. The tier is no longer sent by the client at all: the visit
already carries the correct value, written by `/ai/assess` (which does its own
`RISK_TO_ENUM` translation before storing), and the server reads it from there.
`normaliseRiskTier` now accepts either vocabulary anywhere a tier arrives.

**Wound photographs never reached the doctor.** `patient_images` is written by
`ai.controller`, the table exists in production, and the doctor's case view
never selected it. The one kind of evidence that cannot be reconstructed from
text was the only kind that never arrived. Both the query and the case screen
now carry it, alongside the vision model's observation and severity — labelled
as an observation, not a diagnosis.

Also landed:

- `POST /api/visits/:id/handoff` — validates the doctor is active and in the
  same district, refuses a visit with nothing in it (422 naming what is
  missing), and returns a manifest the assistant can actually read: assessment
  present, and counts of vitals, symptoms, documents, verified documents and
  photographs. An incomplete case still goes through, with what is thin
  reported back — a clinician escalating an urgent patient must not be blocked
  because the vitals are not typed in yet.
- `CASE_ASSIGNED` notification to the assigned doctor. Persisted then pushed;
  the doctor's queue already refreshes on any notification, so the case appears
  without a reload.
- Verifying assistant's name and email surfaced on the doctor's case view and
  carried in the notification payload (Phase 2 traceability). No new columns —
  `visits.assistant_id` and `assigned_at` already held this.
- `CASE_HANDOFF` audit event.

**Outstanding:** `database/v2/07_case_handoff.sql` adds `CASE_ASSIGNED` to the
`notification_event` enum and has NOT been applied to production. Until it is,
the handoff still succeeds and the case still appears — `notify()` swallows the
insert failure by design — but the doctor gets no push. The migration is one
idempotent `ALTER TYPE ... ADD VALUE IF NOT EXISTS`.

### 0.5 Verification

Backend and frontend running locally, two browser profiles as doctor and
assistant, driving the whole loop: assessment → handoff → doctor notified → case
file renders → consultation → both sides connect → review returns to the
assistant. Plus a forced socket drop mid-call to prove reconnect, and `getStats()`
to confirm the selected ICE candidate type once TURN is configured.

---

## Phase 0 — closing notes

Three production faults sat behind the video call, none of them in the code
that was reviewed first:

1. **Railway built from the wrong repository.** It deployed
   `Ashish42-droid/governor` (17 commits stale, no write access) while Vercel
   built `PriyamMishra853/RURALAI-`. A new frontend spoke `/realtime` to a
   backend that still served the old `/signal`. Resolved by repointing Railway.
2. **`VITE_REALTIME_URL` used `ws://` on an HTTPS page.** The browser blocks
   that as mixed content and the constructor throws before any connection is
   attempted. The scheme is now taken from the page, never from configuration,
   and the constructor call is guarded so a throw cannot kill the reconnect
   loop.
3. **`doctor_schedules` was empty, twice.** A missing row means "not working",
   so every date read Closed and instant had nobody to reserve. Re-seeding
   restored it; note that `seedV2` regenerates `staff_profiles` and the
   schedules cascade away with it, which is how it emptied the second time.

Lesson worth keeping: *verify what is deployed, not what was pushed.* Comparing
`GET /api`'s advertised routes against `app.js`, and probing a deliberately
deleted endpoint (`/signal` still returned `101`), is what exposed all of this.

---

## Phase 1 — Clinical Assistant portal

Discovery against the deployed code. Three items are already done; one is a
clinical-safety boundary that is currently open.

### Already complete — no work needed

- **Structured symptom duration.** `symptom_duration_value` / `_unit` exist on
  `visits`, are validated in `updateVisit`, and the assessment screen collects
  them.
- **English/Hindi read-aloud.** `SpeakButton` maps Hindi, Awadhi and Bhojpuri to
  `hi-IN`. Needs verification that it is bound strictly to assessment text, not
  re-verification of the feature.
- **Doctor handoff.** Repaired in Phase 0.4.

### Status

| Item | State |
|------|-------|
| 1.1 Medication is doctor-only | **Done** |
| 1.2 Patient search hits the database | **Done** |
| 1.3 Withdraw an accidental case | **Done** |
| 1.4 Urgent registration | **Done** |
| 1.5 Unified consultations list | **Done** |
| 1.6 Health card OCR | **Done** |

Phase 1 complete. Backend suite 135/135. Migrations `08_visit_soft_delete.sql`
and `09_emergency_registration.sql` applied to production; existing rows
unaffected.

Two findings worth recording, because both were schema or scoping problems
rather than the missing UI they looked like:

- **Emergency registration could not be stored.** `registration_mode` has
  carried `emergency_bypass` since v2, but `phone` and `pin_code` were NOT NULL
  *and* had to match real Indian formats. Registering a patient with no
  documents therefore required inventing a mobile number and a PIN that would
  pass those checks — fabricated values indistinguishable from real ones, in a
  clinical record. Migration 09 makes the identity columns nullable and adds a
  conditional constraint so standard and ABHA registrations still require all
  of them.
- **Doctor-scheduled consultations were invisible to assistants.** A
  consultation created by a doctor stored `assistant_id: null`, and the
  assistant's list filters on `assistant_id = me`. The unified list the brief
  asks for was not a UI problem: the row simply did not name the assistant. It
  is now inherited from the visit.

### 1.1 Disable AI medication recommendations — CRITICAL, do first — DONE

`aiOrchestrator` sets `finalAssessment.medications` and
`supportive_medication_guidance` from the formulary engine, and the assistant's
screen renders them. Medication is a clinical boundary reserved for the doctor,
so nothing medicinal may reach the assistant's portal.

The rules engine itself stays. It is rule-sourced and `assertRuleSourced`
already guards it, and the doctor's prescribing flow depends on the formulary —
so this is about **who is shown what**, not deleting the capability. Medication
output is withheld from the assistant-facing assessment while remaining
available to the doctor.

Smallest, highest-consequence change in the phase, so it goes first.

### 1.2 Patient search hits the database

`getPatients` already supports `?query=` and searches the whole district table
with pagination. The assistant dashboard never sends it: it fetches `/patients`
unfiltered and then does `patients.filter(...)` over the loaded page. Anyone
past the first 50 records is unfindable.

Fix: send the query to the server, debounced, and render server results with
their total. **District scope is kept.** Every read in this codebase is
constrained to the caller's district, and widening patient search to the whole
country would be a privacy regression, not a feature — "entire database" is
read as "the whole patient table rather than the loaded page".

### 1.3 Delete a patient case

No delete endpoint exists. Needs: assistant-only, own-district, soft-delete or
hard-delete decision, refusal once a case has reached a doctor or has a
consultation attached, confirmation in the UI, and an audit entry. Deleting
clinical records is the one irreversible action in the portal, so the guards
matter more than the button.

### 1.4 Urgent registration with guest credentials

Not built. Generates a provisional identity (`guest001`-style) and jumps
straight to Symptoms & Feed, bypassing full registration. Open questions:
whether the guest record is later reconciled to a real Aadhaar, and what
`registration_mode` it carries — `patients.registration_mode` already exists.

### 1.5 Open consultations — one unified list

Rework the assistant's consultation panel to show scheduled and active calls
from both portals. The data is already unified server-side: `GET /consultations`
scopes by participant and returns `join_action` / `join_label`. This is mostly a
UI consolidation.

### 1.6 Health card OCR

Largest and least certain. `ocrService` handles `prescription`, `lab_report`,
`medical_report`, `discharge_summary`, `other` — all clinical documents. A
health card is an **identity** document, needing a new type and a different
extraction (name, gender, DOB).

The requirement's own emphasis is validation: extracted values must never
silently overwrite something typed by hand. Proposed as a proposal/confirm step
reusing `OCRVerificationModal`, with manual entries always winning unless the
operator explicitly accepts the OCR value.

Sequenced last: OCR accuracy on Indian health cards is unpredictable, and it is
the only item whose scope could grow once real cards are tested.

---

## Phase 2 — Doctor portal & clinical workflows

Discovery against the deployed system. Half the phase is already done, and the
half that remains has two concrete root causes rather than vague quality work.

### Already complete

- **Video consultation pipeline** — Phase 0.
- **Doctor's decision reaches the patient** — Phase 0.4: `GET /visits/:id/review`,
  the `DOCTOR_REVIEW_COMPLETED` notification, and `DoctorReviewPanel` on the
  assistant's screen.
- **Traceability** — the verifying assistant's name and email are on the case
  view and in the handoff notification.
- **OCR and wound images reaching the doctor** — the query and the case screen
  now carry `patient_images`. **Unproven:** the table still holds 0 rows, so
  the capture-and-store half has never been exercised. See 2.4.

### 2.1 The AI inference service is unreachable in production — root cause

`aiInferenceClient` reads `AI_SERVICE_URL` and falls back to
`http://127.0.0.1:8001`. That variable is not set anywhere, and Railway's start
command runs only `cd backend && npm start` — the Python service in `AI/LLM/`
is never started and has no host. In production every call to it fails.

It fails *quietly*, which is why this looks like model quality rather than a
deployment gap: a circuit breaker opens after the first failure, each call
returns `null`, and the callers correctly treat `null` as "no candidates". The
assessment still renders, so nothing appears broken.

Two features are running degraded as a result:

- `getDiseaseCandidates` — the retrieval step feeding the assessment. This is
  the "preprocessing, retrieval, parsing" the brief asks to debug.
- `getPrecautions` — precaution guidance, a Phase 1 requirement.

The fix is deployment, not code: the service needs a host and
`AI_SERVICE_URL` set. Only then is it worth judging the model's output.

### 2.2 Deterministic daily workload

`getDoctorQueue` already filters `visit_date = today` and orders worst-first,
so the *query* is deterministic. The data is not: today has 263 visits spread
across 201 doctors, so a typical doctor has one or two cases rather than a
day's work, and the severity mix is whatever the seed produced
(low 113, moderate 77, emergency 41, high 32).

This is a data-shape problem, and it is the same generator Phase 3 asks for. It
should be built once, in Phase 3, rather than twice.

### 2.3 Five patients per doctor, controlled severity

The brief wants each doctor to see exactly five cases spanning easy, medium,
hard, referral and emergency. This needs a decision before any code: whether
that distribution is a **seeding property** for demonstration, or a **runtime
assignment rule** the platform enforces when an assistant hands a case over.

They are different systems. A runtime rule would mean refusing a handoff to a
doctor who already has five, or auto-balancing across doctors — which changes
who treats a patient, and is a clinical governance decision rather than a
display one.

### 2.4 Wound images: prove the capture path

`patient_images` is empty. The read path is fixed and rendering, but nothing
has ever been written. Either no photograph has been captured since the table
existed, or the write is still failing — `ai.controller` catches and warns on
that insert, which is exactly how it went unnoticed before. Needs one real
capture to tell the two apart.

### 2.5 Assessment quality, once 2.1 is deployed

Only meaningful after the service is reachable. The maintainer's own in-progress
work on this sits in `stash@{0}`: `AI/LLM/service/app.py` (+250 lines),
`riskEngine.js` (+137), `aiInferenceClient.js`, `aiOrchestrator.js`, and a new
`clinical_aliases.json`. That work should be reviewed and landed before any
fresh attempt at the same problem, rather than duplicated.

---

### 2.2 / 2.3 Deterministic daily workload — DONE

`npm run seed:daily` (optionally with a `YYYY-MM-DD`) gives every doctor exactly
five cases spanning the whole severity ladder, and the same date always
produces the same five.

Verified against production: 375 doctors with exactly 5 cases each, severity
`moderate=750, low=375, high=375, emergency=375` — two moderates per doctor
because it is the commonest presentation, and a queue implying emergencies are
as frequent as routine cases would misrepresent the work. Every doctor's day
reads `emergency, high, moderate, moderate, low`. Re-running against the same
date reproduces an identical doctor→patient→severity assignment, confirmed by
fingerprint.

Patients are reused, not created: each district already holds 25 demo patients
and 5 doctors, which divides exactly. Generating fresh ones daily would add
1,875 rows a day to a table meant to represent a fixed population.

The delete that makes it re-runnable is filtered on `is_demo`, so a real case an
assistant handed over is never removed by a reseed. The one doctor beyond
75×5 is reported rather than silently given a short queue.

---

## Phase 3 — Admin platform

Discovery found most of it already built.

| Item | State |
|------|-------|
| Staff CRUD with role authorisation | **Already complete** — `GET/POST/PATCH/DELETE /api/admin/users`, behind `authorizeRoles` and a region scope |
| Responsive 3D element | **Already complete** — resize handling, `prefers-reduced-motion`, rendering stops on tab hide, full GPU disposal on unmount |
| Deterministic seed + demo mode | **Done above** — 75 districts, 375 doctors, 1,875 patients, 5 cases per doctor per day, stable per date |
| Admin dashboard metrics | Endpoints exist (`/api/admin/analytics`, `/api/admin/audit`). Whether the figures they return are the operational ones wanted — visits, treated patients, demographics — was not assessed. |

---

## Phase 3 — original notes
- **Phase 2 — Doctor portal.** Deterministic daily workload, controlled severity
  distribution, clinical AI and OCR reaching the doctor, doctor's decision as
  final authority, verifying-assistant traceability.
- **Phase 3 — Admin platform.** Operational metrics, staff CRUD with role
  authorisation, responsive 3D element, deterministic seed generator
  (75 districts → 375 doctors → 1,875 patients) and a demo mode.
