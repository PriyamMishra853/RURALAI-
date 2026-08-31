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

### 0.4 Case handoff — planned, not yet started

6. `POST /api/visits/:id/handoff` replacing the bare PATCH: validates the doctor,
   **normalises `risk_level` server-side** (the current 400 on any unexpected AI
   casing is why the button appears broken), records the verifying assistant,
   audits as `CASE_HANDOFF`, returns a manifest of what was sent.
7. `CASE_ASSIGNED` notification — needs `database/v2/07_case_handoff.sql` to
   extend the enum. The doctor queue already refreshes on realtime events.
8. Readiness check — refuse to hand off an empty case; report what is missing.

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
