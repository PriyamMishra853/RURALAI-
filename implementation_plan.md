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

## Phases 1–3 — planned

Deferred until Phase 0 is verified in production. Full requirements are captured
in the project brief; each phase gets its own section here before any code.

- **Phase 1 — Clinical Assistant portal.** Case delete, urgent guest
  registration, whole-database patient search, unified consultation list, health
  card OCR, structured symptom duration, AI first-aid/precaution/diet guidance
  with medication recommendations disabled, English/Hindi read-aloud.
- **Phase 2 — Doctor portal.** Deterministic daily workload, controlled severity
  distribution, clinical AI and OCR reaching the doctor, doctor's decision as
  final authority, verifying-assistant traceability.
- **Phase 3 — Admin platform.** Operational metrics, staff CRUD with role
  authorisation, responsive 3D element, deterministic seed generator
  (75 districts → 375 doctors → 1,875 patients) and a demo mode.
