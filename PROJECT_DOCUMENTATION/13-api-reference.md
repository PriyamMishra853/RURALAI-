# 13 — API Reference

> **Navigation:** [Index](README.md) · Previous: [12 — Next-Generation Model Roadmap](12-next-generation-model-roadmap.md) · Next: [14 — Testing and Quality](14-testing-and-quality.md)

All **59 HTTP routes** across 13 routers, the WebSocket protocol, and the Python
inference service's 4 endpoints.

**Base URL:** `/api` · **Auth:** `Authorization: Bearer <token>` on everything
except `POST /api/auth/login` and `GET /api/health`.

Role abbreviations: **SA** super_admin · **STA** state_admin · **DA**
district_admin · **DR** doctor · **CA** clinic_assistant · **AU** auditor.

---

## 1. Conventions

### Error shape

```json
{ "error": "Human-readable message" }
```

Some endpoints add detail:

| Field | Used by |
|---|---|
| `fields` | Validation failures — keyed by field name so the form can place each message |
| `details` | Vitals range failures — an array of messages |
| `missing` | `POST /visits/:id/handoff` — what the case is thin on |
| `refresh` | Consultation booking conflicts — the client should re-fetch availability |
| `retryable` | Video provider failures |
| `minutes_until_joinable` | Join attempts outside the window |
| `fallback` | Instant consultation with no doctors available |

### Status codes

| Code | Meaning here |
|---|---|
| 200 / 201 | Success |
| 400 | Validation failure |
| 401 | Not authenticated, or an invalid/expired token |
| 403 | Authenticated but not permitted — including the admin clinical lockout |
| 404 | Not found **or not visible to you**. Used deliberately in place of 403 for scoped resources, so an id's existence is not confirmed |
| 409 | State conflict — already reviewed, slot taken, outside the join window, wrong tier for a report |
| 422 | Semantically empty — a case with nothing in it, an unreadable health card |
| 429 | Rate limited |
| 500 | Server error. In production the message is suppressed |
| 502 / 503 | Upstream model or video provider unavailable |

### Rate limits

| Limiter | Window | Max | Applies to |
|---|---|---|---|
| Global | 1 min | 300 | Everything under `/api` |
| Login | 15 min | 10 | `POST /auth/login` (successes skipped) |
| Patient search | 5 min | 60 | Patient list, lookup, detail |
| AI | 1 min | 20 | `/ai/*` (except `service-status`), `/vision/*`, `/voice/*`, document upload |

---

## 2. Health and index

### `GET /api/health`
No auth.
```json
{ "status": "ONLINE", "system": "Virtual Village Clinic AI Backend API",
  "timestamp": "2026-09-01T...", "version": "1.0.0" }
```

### `GET /api` (or `GET /` when no frontend build is present)
Service index listing the mounted endpoint groups.

---

## 3. `/api/auth`

### `POST /api/auth/login`
No auth · login rate limiter.

**Request** `{ "email": "...", "password": "..." }`

**200**
```json
{
  "token": "<JWT, 12h>",
  "user": {
    "id": "...", "email": "...", "name": "...",
    "role": "CLINIC_ASSISTANT", "phone": "...",
    "state": "Uttar Pradesh", "district": "Ballia",
    "stateId": "...", "districtId": "...",
    "home": "/assistant/dashboard"
  }
}
```

**400** missing field · **401** `"Invalid email or password."` — the same message
for a bad password, a missing account, no staff profile and a suspended account,
so the endpoint cannot be used to enumerate.

### `POST /api/auth/logout`
All roles. Writes a `LOGOUT` audit entry. **The JWT remains valid until it
expires** — there is no revocation list.

### `GET /api/auth/me`
All roles. Re-reads the profile, so a revoked role takes effect immediately.
**403** if the account is no longer active.

---

## 4. `/api/patients`

Router guards: `authenticateUser` → `denyAdminClinicalAccess`. Every read is
filtered on `clinic_district_id = caller.districtId`.

### `POST /api/patients/lookup` — CA, DR
Rate limited. **A POST because the Aadhaar travels in the body** — a URL path
would put it into access logs, proxy logs and browser history.

**Request** `{ "aadhaar_number": "123456789012" }`
**200** the patient record with derived `age_years` and `age_display`
**400** not 12 digits · **404** not registered at this clinic

### `POST /api/patients/detail` — CA, DR
As above, plus up to 100 visits (`deleted_at IS NULL`), newest first.

### `GET /api/patients` — CA, DR
Query: `query`, `page` (default 0), `pageSize` (default 50).

A 12-digit `query` is matched **exactly**, not as a substring, so partial digits
cannot walk the keyspace. Anything else searches name, phone and village.

**200** `{ total, page, pageSize, patients[] }`

### `POST /api/patients` — CA only
Six required fields: `aadhaar_number`, `full_name`, `gender`, `date_of_birth`,
`village_line1` (+ optional `village_line2`), `address_district`,
`address_state_id`, `pin_code`, `phone`. Optional `abha_number` (**only ever from
ABHA OCR**) and `registration_mode`.

District and state are taken from the caller's profile, never the body.

**201** the created patient · **400** `{ error, fields: { … } }` ·
**403** the account has no district · **409** already registered — the **same
message** whether it is this district or another

### `POST /api/patients/urgent` — CA only
Emergency bypass. `{ gender, age_years, full_name?, phone? }`.

Allocates a guest identifier beginning `1` (UIDAI allocates real numbers from
2–9), retrying up to 10 times on a primary-key collision. Identity fields are left
**null**, not invented. **Age is required** — triage thresholds depend on it.

**201** `{ …patient, guest_label: "Guest 001", provisional: true, next: "/assistant/assessment/<id>" }`

### `PATCH /api/patients` — CA only
Re-validates the **whole** payload. `aadhaar_number` is stripped from the patch —
the primary key never changes.

---

## 5. `/api/regions`

| Endpoint | Roles | Returns |
|---|---|---|
| `GET /states` | any active staff | 36 states and union territories |
| `GET /districts?stateId=` | any active staff | Districts for that state — seeded for UP only |

---

## 6. `/api/visits`

Router guards: `authenticateUser` → `denyAdminClinicalAccess`.

### `POST /api/visits` — CA only
```json
{ "aadhaar_number": "…", "chief_complaint": "…",
  "symptom_duration_value": 3, "symptom_duration_unit": "days",
  "medical_history": "…", "known_allergies": "…", "current_medications": "…",
  "vitals": { … }, "symptoms": ["…"], "assigned_doctor_id": "…" }
```
Vitals are range-checked before insert. A named doctor must be active and in the
caller's district.

**201** the visit · **400** vitals failed validation, with `details[]` ·
**404** no such patient in your district

### `GET /api/visits/:id` — CA, DR
Doctor → `assigned_doctor_id = me`; assistant → `district_id`. Excludes withdrawn
visits. Returns the visit with patient, vitals, symptoms and assessments.

### `GET /api/visits/:id/review` — CA, DR
The doctor's decision, for the assistant.

**200 (referred / emergency)**
```json
{ "visit_id": "...", "closed": true,
  "reason": "This case was referred to hospital and is closed on this platform…",
  "review": null, "prescription": null }
```
**200 (otherwise)** `{ status, patient_name, doctor_name, closed: false, pending, review, prescription }`

### `PATCH /api/visits/:id` — CA, DR
Accepts `status`, `risk_level`, `assigned_doctor_id`, `chief_complaint`,
`symptom_duration_value`/`_unit`, `medical_history`, `known_allergies`,
`current_medications`. `risk_level` accepts **either vocabulary** via
`normaliseRiskTier()`.

### `POST /api/visits/:id/handoff` — CA only
**Request** `{ "doctor_id": "…" }`

The tier is read from the visit, not accepted from the client. Refuses only a
completely empty case.

**200**
```json
{ "visit_id": "...", "visit_code": "VIS-2026-000123",
  "status": "awaiting_doctor", "risk_level": "moderate",
  "doctor": { "id": "...", "full_name": "..." },
  "verified_by": { "id": "...", "name": "...", "email": "..." },
  "sent": { "ai_assessment": true, "vitals": 1, "symptoms": 3,
            "documents": 2, "verified_documents": 2, "images": 1 },
  "missing": [] }
```
**404** doctor not in this district · **422** `{ error, missing[] }`

Fires `CASE_ASSIGNED`, persisted before it is pushed.

### `DELETE /api/visits/:id` — CA only
**Request** `{ "reason": "…" }` (optional). Soft delete.

**200** `{ visit_id, visit_code, deleted: true }` — or
`{ already_deleted: true }`, because withdrawing twice is not an error.
**409** with the specific guard that applied: a doctor is assigned, a consultation
exists, or a review exists.

---

## 7. `/api/documents`

Router guards: `authenticateUser` → `denyAdminClinicalAccess`. Uploads:
15 MB × 10.

### `GET /api/documents?visit_id=` — CA, DR
### `POST /api/documents/upload` — CA only
Multipart. Any field name, any count — all files are read as **one document** in
a single model call.

Fields: `files[]`, `aadhaar_number`, `visit_id`, `document_type`
(`prescription` | `lab_report` | `abha_card` | `discharge_summary` | `other`).

**201**
```json
{ "document": { … }, "extraction": { … }, "raw_ocr": "…",
  "engine": "gemini-3.6-flash", "files_read": 3, "confidence": 0.9,
  "needs_manual_entry": false }
```
`needs_manual_entry: true` means every engine failed. The extraction is then
empty — never invented.

### `POST /api/documents/health-card` — CA only
Stores nothing. Returns a proposal.

**200** `{ fields: { full_name?, gender?, date_of_birth?, year_of_birth?, card_number? }, confidence, rejected[], raw_text }`
**422** not a health card, or unreadable · **502** the model could not be reached

### `POST /api/documents/:id/verify` — CA, DR
`{ "corrected_data": { … } }`. Sets `verified_by` and `verified_at`. **Until this
runs, the extraction is a draft and is not clinical input.**

---

## 8. `/api/ai`

Router: `authenticateUser` → *(service-status)* → `denyAdminClinicalAccess` →
`aiRateLimiter`.

### `GET /api/ai/service-status` — SA, STA, DA only
**Above** the AI limiter and the clinical block, deliberately.

**200**
```json
{ "reachable": true, "url": "http://127.0.0.1:8001", "latency_ms": 12,
  "status": "ok", "models": { "symptom_diagnosis": true, "medicine_index": 5,
  "precautions": 41, "clinical_aliases": 280 },
  "model_meta": { "model": "bernoulli_nb", "trained_at": "…", "diseases": 582 },
  "retrieval": "Symptom retrieval and precautions are active." }
```

When unreachable it adds a `diagnosis` block distinguishing *"the virtualenv is
absent, so the build could not install the dependencies"* from *"dependencies
installed but the service failed at startup"* — those need opposite fixes, and
`fetch failed` is the same message for both. It also returns the tail of the
service's own log.

### `POST /api/ai/assess` — CA, DR
Alias: `POST /api/ai/analyze-patient`.

```json
{ "visit_id": "…", "patient_id": "…", "symptoms": "…",
  "symptom_duration": "3 days", "medical_history": "…", "known_allergies": "…",
  "vitals": { … }, "verified_ocr_data": { … }, "vision_observation": { … } }
```

**200** — the assessment plus the tier workflow:
```json
{
  "assessment_id": "…", "persisted": true, "visit_id": "…",
  "risk_level": "MEDIUM", "rule_tier": "MEDIUM", "degraded": false,
  "immediate_referral": false, "requires_doctor": true,
  "recommended_next_action": "DOCTOR_REVIEW",
  "patient_summary": "…", "key_symptoms": [], "duration": "3 days",
  "important_history": [], "missing_information": [], "observations": [],
  "first_aid_steps": ["Step 1: …"],
  "protocol_matches": [{ "title": "…", "source": "…", "version": "…", "guidance": "…" }],
  "warnings": [], "missing_data": [], "risk_reasoning": "…",
  "disease_candidates": {
    "source": "bernoulli_nb over 244,938 labelled symptom vectors",
    "top5_accuracy": 0.9743, "recognised_symptoms": [], "candidates": [],
    "confident": true, "confidence_note": null,
    "unrecognised_text": [], "excluded_for_demographics": [],
    "note": "Ranked candidates from a statistical model. Not a diagnosis."
  },
  "medication_withheld": true,
  "medication_withheld_reason": "Medication is prescribed by the doctor after review…",
  "medication_source": null,
  "generated_by": "groq:openai/gpt-oss-120b",
  "legal_disclaimer": "…",
  "workflow": { "tier": "MEDIUM", "headline": "…", "first_aid": [],
                "patient": {}, "precautions": {}, "diet": [],
                "medication": { "emitted": false, "reason": "…", "items": [] },
                "doctor_action": {}, "consultation": {}, "referral": null }
}
```

**There is no medication field carrying a drug name, at any tier.**

### `POST /api/ai/transcribe` — CA, DR
Multipart `audio` + optional `language`. Always **200**:

```json
{ "ok": true, "detected_language": "Hindi (हिंदी)", "transcript": "…",
  "extracted_symptoms": [{ "symptom": "…", "duration": "…", "severity": "…", "location": "…" }],
  "warnings": [] }
```
or
```json
{ "ok": false, "reason": "No speech detected in the recording…",
  "detected_language": null, "transcript": "", "extracted_symptoms": [],
  "warnings": ["…"] }
```

`ok: false` is a **200**, not an error, because the assistant needs to see why and
retry — but the payload never carries a substitute transcript.

### `POST /api/ai/analyze-document` — CA, DR
Single-file variant of the document OCR path.

### `POST /api/ai/risk-assessment` — CA, DR
`{ vitals, symptoms, history }` → the rule-engine result alone, with no model
involved. Useful for demonstrating the deterministic layer in isolation.

### `POST /api/ai/analyze-image` — CA, DR
Multipart `image` + `visit_id`. The patient is derived from the **visit**, never
from the body.

**200** — `analysis_possible`, `body_region`, `computer_vision_analysis`,
`extent`, `possible_conditions` (confidence capped at `moderate`),
`observable_features`, `recommended_first_aid`, `escalate_if`,
`cautious_summary`, `severity_impression`, `warnings`, `engine`, `image_url`
(a one-hour signed URL).

### `POST /api/ai/interpret-report` — CA, DR
`{ document_id, visit_id, lab_data }` → second-stage reasoning over already
transcribed lab values.

**200** — `interpretation_possible`, `overall_impression`, `possible_conditions`
(capped at `moderate`), `urgency_flags`, `recommended_next_step`, `engine`.

---

## 9. `/api/vision` and `/api/voice`

Aliases reaching the same controllers, each carrying
`denyAdminClinicalAccess` + `authorizeRoles(CA, DR)` + `aiRateLimiter` at the
router level.

| Endpoint | Same as |
|---|---|
| `POST /api/vision/analyze` | `POST /api/ai/analyze-image` |
| `POST /api/vision/analyze-image` | same |
| `POST /api/voice/transcribe` | `POST /api/ai/transcribe` |

### `POST /api/voice/translate` — CA, DR

Translates already-generated clinical text for the read-aloud button, so a health
worker can play an assessment back to a patient in Hindi.

**Request** `{ "text": "…", "target": "Hindi" | "English" }`

**200** `{ ok, text, reason? }` — **returns the original text on failure** rather
than an error, so the read-aloud button always has something usable.

Deliberately narrow. The prompt forbids adding, removing, summarising or
"improving" anything, and forbids introducing a medicine, dose or diagnosis:
*"a translation that helpfully adds a dose is a fabricated instruction that
nobody proofread."* Source text over 6,000 characters and unsupported languages
are refused. Carries the AI rate limiter — it is a model call and costs money per
request.

---

## 10. `/api/doctor`

Router guards: `authenticateUser` → `denyAdminClinicalAccess`.

### `GET /api/doctor/directory` — CA, DR
Doctors in the caller's district. A roster, not clinical data.
`{ doctors: [{ id, name, specialization, qualification, years_of_experience, languages, available }] }`

### `GET /api/doctor/queue?date=YYYY-MM-DD&includeCompleted=` — DR only
Defaults to today in IST. Sorted worst-first, then oldest-first.

```json
{ "date": "2026-09-01", "is_past": false, "read_only": false,
  "total": 5, "counts": { "emergency": 1, "high": 1, "moderate": 2, "low": 1 },
  "cases": [ { …visit, patients: { …, age_years, age_display }, ai_assessments: [], assistant: {} } ] }
```

### `GET /api/doctor/queue/dates` — DR only
Uses **exactly** the same filter as the queue. When these disagreed, the picker
advertised "Aug 26: 1" and then showed an empty list.

### `GET /api/doctor/cases/:id` — DR only
Ownership checked **inside** the query. Returns the full case: vitals, symptoms,
documents, `patient_images` with **freshly signed URLs**, reviews, prescriptions.
Writes a `CASE_OPENED` audit entry.

**404** `"That case is not assigned to you."`

### `POST /api/doctor/cases/:id/review` — DR only
```json
{ "decision": "prescribe", "diagnosis": "…", "clinical_notes": "…",
  "agreed_with_ai": true,
  "prescriptions": [{ "name": "…", "strength": "…", "frequency": "…",
                      "duration": "…", "instructions": "…" }],
  "referral_hospital": "…", "follow_up_days": 3 }
```

`decision` ∈ `treat_locally` | `prescribe` | `refer_hospital` | `follow_up` |
`no_action_needed`.

**201** `{ review, prescription_id, visit_status }`
**400** decision invalid · no diagnosis · `prescribe` with no medicine ·
`refer_hospital` with no hospital
**409** the case is from a previous day, or already reviewed

Fires `DOCTOR_REVIEW_COMPLETED` back to the assistant.

---

## 11. `/api/consultations`

Router guards: `authenticateUser` → `denyAdminClinicalAccess`.

### `GET /api/consultations/availability/dates` — CA, DR
7-day strip. Per date: `doctors_working`, `available_doctors`,
`available_slots`, `unavailable`. *"No doctor works this day"* and *"every slot is
taken"* are different things, labelled differently.

### `GET /api/consultations/availability/slots?date=` — CA, DR
5-minute grid across the union of working windows; each slot lists the doctors
free at that exact moment. Today's lower bound is the next 5-minute boundary from
now. **400** for a past date.

### `GET /api/consultations/availability/doctors?at=<ISO>` — CA, DR
Doctors free at one instant, each labelled `Available` or
`Currently in consultation`.

### `POST /api/consultations` — CA only
`{ visit_id, doctor_id, scheduled_start_time }`. Re-runs the **entire**
availability check at booking time. 15-minute consultations.

**201** the decorated consultation · **409** `{ error, refresh: true }` ·
**400** past or invalid time · **404** no such visit at this clinic

### `POST /api/consultations/instant` — CA only
`{ visit_id }`. Inserts straight to `ACTIVE`, walking the candidate list and
treating a unique violation as "someone took this doctor".

**201** `{ …consultation, doctor_name }` · **404** `{ error, fallback: "schedule" }` ·
**409** every candidate taken · **503** the video session could not be created —
the reservation is rolled back

### `GET /api/consultations?scope=today|upcoming|all&status=` — CA, DR
Scoped to the caller as doctor **or** assistant. Each row is decorated with
`join_action` (`JOIN` | `REJOIN` | `WAIT` | `DISABLED`), `join_label`,
`minutes_until_joinable` and `can_cancel`, computed server-side **so the button
can never disagree with what the join endpoint will allow**.

### `GET /api/consultations/:id` — CA, DR
### `POST /api/consultations/:id/join` — CA, DR
Checks terminal state, then the ±5-minute window, then that neither party is in a
different `ACTIVE` consultation, then transitions with a compare-and-set.

**200** `{ consultation, credentials: { provider, token, roomId, iceServers }, reconnect }`
**409** completed / cancelled / missed / outside the window / already in a call
**503** provider failure — **the row is rolled back to `SCHEDULED`** and a
`CONSULTATION_FAILED` notification is sent

### `POST /api/consultations/:id/end` — CA, DR
**200** `{ consultation, duration_seconds }`. Drops the signalling room, sets the
visit back to `awaiting_doctor`. Teardown failure does not block the transition.

### `POST /api/consultations/:id/cancel` — CA, DR
Only while `SCHEDULED`. **409** otherwise.

---

## 12. `/api/notifications`

| Endpoint | Roles | Notes |
|---|---|---|
| `GET /?unread=true&limit=50` | any active staff | Scoped to `recipient_id = caller.id` **inside the service**; a recipient id can never be supplied |
| `POST /read` | any active staff | `{ ids?: [] }` — omit to mark all read |

`GET` returns `{ notifications: [], unread: N }`.

---

## 13. `/api/reports`

### `GET /api/reports/visits/:id/:type.pdf` — CA, DR
`type` ∈ `summary` | `prescription` | `referral`.

Streams `application/pdf` rather than buffering — a referral sheet is wanted in an
emergency and the first byte should leave as soon as the header is drawn. Aadhaar
is masked. The workflow is **rebuilt** rather than stored, because precautions,
availability and the nearest hospital can all change between the assessment and
the reprint.

**400** unknown type · **404** not visible to you · **409** no assessment yet, or
`referral` requested for a non-HIGH visit

The client fetches with the bearer token and opens the blob — a plain `<a href>`
would arrive unauthenticated.

---

## 14. `/api/admin`

Router guards: `authenticateUser` → `authorizeRoles(SA, STA, DA, AU)` →
`attachRegionScope`. Mutating routes additionally carry `ADMINS_ONLY`.

### `GET /api/admin/regions` — SA, STA, DA, AU
Scoped: a state admin sees only their state; a district admin only their district.
**403** for a state outside the caller's region.

### `GET /api/admin/users` — SA, STA, DA, AU
Query: `role`, `districtId`, `stateId`, `query`, `page`, `pageSize`.
A parameter can **narrow** but never widen — **403** for anything outside scope.

### `POST /api/admin/users` — SA, STA, DA
```json
{ "full_name": "…", "email": "…", "phone": "…", "role": "DOCTOR",
  "state_id": "…", "district_id": "…", "password": "…",
  "preferred_language": "Hindi" }
```
Role must be in `CREATABLE_ROLES[caller.role]`. Password ≥ 12 characters. Region
is **forced** to the caller's scope. Creates the Auth user and the profile
together, and **deletes the Auth user** if the profile insert fails.

**403** `"Your role may create: … super_admin is provisioned out of band and never through this API."`

### `PATCH /api/admin/users/:id` — SA, STA, DA
`full_name`, `phone`, `status`, `role`, `preferred_language`.
**403** for a `super_admin` target, or a role outside `CREATABLE_ROLES`.

### `DELETE /api/admin/users/:id` — SA, STA, DA
**Suspends**, and bans the Auth credential so an existing session cannot outlive
the suspension. Never a hard delete — clinical rows reference who recorded them.
**400** deactivating yourself · **403** the super admin.

### `GET /api/admin/analytics` — SA, STA, DA, AU
```json
{ "scope": "district", "generated_at": "…",
  "doctors": 5, "clinic_assistants": 1, "patients": 25,
  "states_total": 36, "districts_total": 75,
  "visits": { "total": 25, "today": 5, "treated": 12,
              "awaiting_doctor": 8, "in_consultation": 1, "referred": 4 },
  "risk_distribution": { "low": 5, "moderate": 10, "high": 5, "emergency": 5 },
  "trend": [{ "date": "2026-08-19", "visits": 3, "urgent": 1 }],
  "demographics": { "gender": { "female": 12, "male": 13, "other": 0 },
                    "age_bands": [{ "label": "0-5", "count": 2 }] },
  "top_districts": [{ "name": "Ballia", "count": 25 }] }
```
**No patient-identifying field appears anywhere.** Aggregated by
`admin_analytics()` in Postgres. **500** if that function is missing — apply
`10_admin_analytics.sql`.

### `GET /api/admin/audit` — SA, STA, DA, **AU**
Query: `page`, `pageSize` (default 100), `action`. Already redacted at write time.
The reason the `AUDITOR` role exists.

---

## 15. WebSocket — `/realtime`

**Connect:** `wss://<host>/realtime?token=<bearer>`

The scheme is derived from the page, never from configuration. Rejections:

| Code | Cause |
|---|---|
| 404 | Path is not `/realtime` |
| 403 | `Origin` not in `CORS_ALLOWED_ORIGINS` — browsers do not apply CORS to WebSockets |
| 401 | Invalid token, or no active staff profile |

### Server → client

| Type | Payload |
|---|---|
| `connected` | `{ role, name }` |
| `notification` | `{ id, event, consultation_id, payload, created_at }` |
| `pong` | — |
| `call:joined` | `{ peers: [{ name, role }] }` |
| `call:peer-joined` | `{ name, role }` |
| `call:peer-left` | `{ role }` |
| `call:error` | `{ message }` |
| `call:ended` | — |
| `call:offer` / `call:answer` / `call:ice` | Relayed, with `from` stamped from the **verified** identity |

### Client → server

| Type | Payload | Guard |
|---|---|---|
| `ping` | — | — |
| `call:join` | `{ consultationId }` | Participation re-verified against the consultation row |
| `call:offer` / `call:answer` / `call:ice` | SDP / candidate | Requires `ws.callId`; `roomId` is **never** read from the body |
| `call:leave` | — | — |

Liveness: a 25-second ping/pong sweep terminates unresponsive sockets.

### The eight notification events

`CONSULTATION_SCHEDULED` · `CONSULTATION_REMINDER` · `CONSULTATION_STARTED` ·
`CONSULTATION_CANCELLED` · `CONSULTATION_COMPLETED` · `CONSULTATION_FAILED` ·
`CASE_ASSIGNED` · `DOCTOR_REVIEW_COMPLETED`

Every one is **persisted before it is pushed**.

---

## 16. Python inference service

Internal only — `http://127.0.0.1:8001`. No authentication of its own; it is
bound to loopback inside the API container, where *"only the backend can reach
it"* is literally true. **It must not be given a public domain.**

### `GET /health`
```json
{ "status": "ok", "error": null,
  "models": { "symptom_diagnosis": true, "medicine_index": 5,
              "precautions": 41, "clinical_aliases": 280 },
  "alias_errors": [],
  "meta": { "model": "bernoulli_nb", "trained_at": "…",
            "rows_used": 244938, "diseases_kept": 582, "metrics": { … } } }
```

### `POST /diagnose`
```json
{ "text": "high fever with chills, loose motion since 2 days",
  "symptoms": [], "top_k": 5, "min_confidence": 0.02,
  "age_years": 34, "sex": "female" }
```

**200**
```json
{ "ok": true, "confident": true, "confidence_note": null,
  "matched_symptoms": [{ "input": "loose motion", "symptom": "diarrhea",
                         "score": 100.0, "via": "alias" }],
  "unmatched_fragments": [], "excluded_candidates": [],
  "sparse_input": false, "symptoms_used": ["fever", "chills", "diarrhea"],
  "candidates": [{ "disease": "…", "confidence": 0.46 }],
  "model": "centroid", "model_top5_accuracy": 0.9743,
  "disclaimer": "Ranked candidates from a statistical model. Not a diagnosis…" }
```

**`ok: false`** when nothing matched the vocabulary — *"An empty vector would make
the model return its prior… Refusing is the only safe answer."*

> ⚠️ `model` reports `META['selected']`, which is `"centroid"`, while the service
> actually serves Bernoulli NB. The accuracy figure is correct for what runs.
> [L7](16-known-limitations-and-risks.md#l7).

**503** if the model failed to load.

### `POST /medicine-availability`
`{ molecule, strength? }` → products, strengths and price ranges. Currently
**no production code path calls it**.

### `GET /precautions/{disease}`
Exact match, then fuzzy at score ≥ 80.

---

## 17. Endpoint index

| Method | Path | Roles |
|---|---|---|
| GET | `/api/health` | public |
| GET | `/api` | public |
| POST | `/api/auth/login` | public |
| POST | `/api/auth/logout` | all |
| GET | `/api/auth/me` | all |
| POST | `/api/patients/lookup` | CA, DR |
| POST | `/api/patients/detail` | CA, DR |
| GET | `/api/patients` | CA, DR |
| POST | `/api/patients` | CA |
| POST | `/api/patients/urgent` | CA |
| PATCH | `/api/patients` | CA |
| GET | `/api/regions/states` | all staff |
| GET | `/api/regions/districts` | all staff |
| POST | `/api/visits` | CA |
| GET | `/api/visits/:id` | CA, DR |
| GET | `/api/visits/:id/review` | CA, DR |
| PATCH | `/api/visits/:id` | CA, DR |
| POST | `/api/visits/:id/handoff` | CA |
| DELETE | `/api/visits/:id` | CA |
| GET | `/api/documents` | CA, DR |
| POST | `/api/documents/upload` | CA |
| POST | `/api/documents/health-card` | CA |
| POST | `/api/documents/:id/verify` | CA, DR |
| GET | `/api/ai/service-status` | SA, STA, DA |
| POST | `/api/ai/assess` | CA, DR |
| POST | `/api/ai/analyze-patient` | CA, DR |
| POST | `/api/ai/transcribe` | CA, DR |
| POST | `/api/ai/analyze-document` | CA, DR |
| POST | `/api/ai/risk-assessment` | CA, DR |
| POST | `/api/ai/analyze-image` | CA, DR |
| POST | `/api/ai/interpret-report` | CA, DR |
| POST | `/api/vision/analyze` | CA, DR |
| POST | `/api/vision/analyze-image` | CA, DR |
| POST | `/api/voice/transcribe` | CA, DR |
| POST | `/api/voice/translate` | CA, DR |
| GET | `/api/doctor/directory` | CA, DR |
| GET | `/api/doctor/queue` | DR |
| GET | `/api/doctor/queue/dates` | DR |
| GET | `/api/doctor/cases/:id` | DR |
| POST | `/api/doctor/cases/:id/review` | DR |
| GET | `/api/consultations/availability/dates` | CA, DR |
| GET | `/api/consultations/availability/slots` | CA, DR |
| GET | `/api/consultations/availability/doctors` | CA, DR |
| POST | `/api/consultations` | CA |
| POST | `/api/consultations/instant` | CA |
| GET | `/api/consultations` | CA, DR |
| GET | `/api/consultations/:id` | CA, DR |
| POST | `/api/consultations/:id/join` | CA, DR |
| POST | `/api/consultations/:id/end` | CA, DR |
| POST | `/api/consultations/:id/cancel` | CA, DR |
| GET | `/api/notifications` | all staff |
| POST | `/api/notifications/read` | all staff |
| GET | `/api/reports/visits/:id/:type.pdf` | CA, DR |
| GET | `/api/admin/regions` | SA, STA, DA, AU |
| GET | `/api/admin/users` | SA, STA, DA, AU |
| POST | `/api/admin/users` | SA, STA, DA |
| PATCH | `/api/admin/users/:id` | SA, STA, DA |
| DELETE | `/api/admin/users/:id` | SA, STA, DA |
| GET | `/api/admin/analytics` | SA, STA, DA, AU |
| GET | `/api/admin/audit` | SA, STA, DA, AU |
| WS | `/realtime` | all staff |
