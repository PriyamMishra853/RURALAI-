# 03 — Data Flow

> **Navigation:** [Index](README.md) · Previous: [02 — Dependencies](02-dependencies.md) · Next: [04 — Workflow](04-workflow.md)

How data moves from the health worker's input, through validation and storage,
into the AI pipeline, to the doctor, and back. Five paths are traced separately
because they have genuinely different failure modes: **speech**, **OCR**,
**image**, **triage**, and **realtime notification**.

---

## 1. System-level flow

```mermaid
flowchart TB
    subgraph Client["Browser — React SPA"]
        UI["PatientAssessmentVisitPage.jsx"]
        RT["RealtimeContext.jsx<br/>one WebSocket"]
    end

    subgraph API["Express API — backend/src"]
        MW["Middleware chain<br/>authenticateUser → denyAdminClinicalAccess<br/>→ authorizeRoles → rateLimit"]
        CTRL["Controllers"]
        SVC["Services"]
        HUB["realtimeHub.js<br/>/realtime"]
    end

    subgraph Data["Supabase"]
        PG[("Postgres<br/>17 tables + RLS")]
        AUTH["Auth"]
        STORE["Storage<br/>injury-photos private"]
    end

    subgraph Models["Model layer"]
        PY["Python inference service<br/>127.0.0.1:8001"]
        GROQ["Groq<br/>gpt-oss-120b · whisper-large-v3-turbo"]
        GEM["Gemini<br/>gemini-3.6-flash + fallbacks"]
        QD[("Qdrant<br/>clinical_protocols")]
    end

    UI -->|"HTTPS + Bearer"| MW
    MW --> CTRL --> SVC
    SVC --> PG
    SVC --> STORE
    SVC --> PY
    SVC --> GROQ
    SVC --> GEM
    SVC --> QD
    CTRL -->|"notify()"| PG
    CTRL --> HUB
    HUB <-->|"WSS + token"| RT
    MW -.->|"verify identity"| AUTH
```

Two rules hold across every path:

1. **Persist, then push.** Every notification is written to `notifications`
   before it is sent over the socket, so a doctor whose laptop was asleep still
   sees what happened.
2. **Fail visibly, never plausibly.** Every model call has a defined failure
   value, and none of them is a substitute for real data.

---

## 2. The speech path

`POST /api/voice/transcribe` → `ai.controller.js` `transcribeSpeech` →
`speechService.js` `transcribeAndExtractSymptoms`

```mermaid
flowchart TD
    A["MediaRecorder captures audio/webm<br/>PatientAssessmentVisitPage.jsx"] --> B{"multer<br/>≤10 MB, ≤10 files"}
    B -->|"empty buffer"| Z1["ok:false — 'No audio was received.'"]
    B --> C{"Groq key pool<br/>configured?"}
    C -->|no| Z2["ok:false — 'no provider is configured'"]
    C -->|yes| D["groqTranscribe<br/>whisper-large-v3-turbo<br/>verbose_json, NO priming prompt"]
    D -->|"throws"| Z3["ok:false — reason carries the error"]
    D --> E{"isSilence()<br/>every segment no_speech_prob > 0.6"}
    E -->|yes| Z4["ok:false — 'No speech detected'"]
    E --> F{"isPaddingArtifact()<br/>any segment.end > duration + 5s"}
    F -->|yes| Z4
    F --> G{"looksHallucinated()<br/>whole-transcript artefact match"}
    G -->|yes| Z5["ok:false — 'only background artefacts'"]
    G --> H["Second Groq call<br/>gpt-oss-120b, temperature 0<br/>structure the transcript"]
    H -->|"fails"| I["transcript kept<br/>+ warning: 'enter symptoms manually'"]
    H --> J["extracted_symptoms[]"]
    I --> K["ok:true"]
    J --> K
    K --> L["Browser fills the symptom field<br/>+ shows detected_language"]
    L --> M[("visit_symptoms<br/>source = 'speech'")]

    style Z1 fill:#fee2e2,stroke:#b91c1c
    style Z2 fill:#fee2e2,stroke:#b91c1c
    style Z3 fill:#fee2e2,stroke:#b91c1c
    style Z4 fill:#fee2e2,stroke:#b91c1c
    style Z5 fill:#fee2e2,stroke:#b91c1c
```

**Every red terminal returns an empty `transcript` and an empty
`extracted_symptoms`.** The browser leaves the symptom field untouched and shows
the reason instead (`PatientAssessmentVisitPage.jsx:159–172`).

### Why three independent rejection gates

`no_speech_prob` alone is not usable. On one second of pure digital silence
Whisper returned *"Thank you."* with `no_speech_prob: 0` — fully confident in
speech that does not exist. The structural detector catches what the probability
misses: Whisper pads short audio to a 30-second window, and when it hallucinates
it labels the whole padded window rather than the real audio. Genuine
one-second speech produces a segment ending at about one second.

The structuring step is explicitly forbidden from adding anything: *"Extract ONLY
symptoms explicitly stated in the transcript… If the transcript mentions no
symptom, return an empty array. An empty array is a correct answer."*

### What this prevents

An earlier version substituted a fixed Hindi sentence describing fever, dry
cough and body pain when transcription produced nothing, and defaulted
`extracted_symptoms` to the same three. *Fever + cough* is a MEDIUM-tier rule in
`riskEngine.js`, so a silent or failed recording produced a triaged case
describing a patient who did not exist. A doctor cannot tell an invented symptom
from a real one.

---

## 3. The OCR path

`POST /api/documents/upload` → `document.controller.js` `uploadDocument` →
`ocrService.js` `processMedicalDocument`

```mermaid
flowchart TD
    A["FileCaptureInput.jsx<br/>camera preview or file picker<br/>N files as ONE document"] --> B{"multer<br/>≤15 MB × 10"}
    B -->|"LIMIT_FILE_SIZE"| Z0["400 — 'Photograph the page again at lower resolution'"]
    B --> C{"Aadhaar valid AND<br/>patient in caller's district?"}
    C -->|no| Z1["404 — 'No such patient at this clinic'"]
    C --> D{"document_type"}
    D -->|prescription| E1["PRESCRIPTION_RULES + PRESCRIPTION_SCHEMA"]
    D -->|lab_report| E2["LAB_RULES + LAB_REPORT_SCHEMA"]
    D -->|other| E3["BASE_RULES + GENERIC_SCHEMA"]
    E1 --> F
    E2 --> F
    E3 --> F["Engine 1 — Gemini multimodal<br/>ALL pages in ONE request<br/>temperature 0.1, JSON mime"]
    F -->|"finishReason MAX_TOKENS"| G["treated as unreadable"]
    F -->|"429/404/503"| H["next model in the chain"]
    H --> F
    F -->|parsed| N["normalize()"]
    G --> I
    F -->|null| I{"Engine 2 — images only"}
    I --> J{"looksLikeDecodableImage()<br/>JPEG/PNG/BMP/TIFF/WEBP magic bytes"}
    J -->|"no images, PDF present"| Z2["extractionFailure —<br/>'re-upload as photographs'"]
    J -->|"not decodable"| Z3["extractionFailure —<br/>'truncated or unsupported'"]
    J -->|ok| K["Tesseract per page<br/>always terminated in finally"]
    K --> L{"rawText ≥ 20 chars<br/>AND Groq available?"}
    L -->|no| Z4["extractionFailure —<br/>'Enter the details manually'"]
    L --> M["Groq structures the OCR text"]
    M --> N
    N --> O[("patient_documents<br/>ocr_text + extracted_data<br/>verified_at = NULL")]
    O --> P["OCRVerificationModal.jsx<br/>side-by-side human review"]
    P --> Q["POST /documents/:id/verify"]
    Q --> R[("verified_by, verified_at SET")]
    R --> S["Now admissible as AI input"]

    style Z0 fill:#fee2e2,stroke:#b91c1c
    style Z1 fill:#fee2e2,stroke:#b91c1c
    style Z2 fill:#fef3c7,stroke:#b45309
    style Z3 fill:#fef3c7,stroke:#b45309
    style Z4 fill:#fef3c7,stroke:#b45309
    style R fill:#dcfce7,stroke:#15803d
```

### The four things this path does that a naive OCR integration would not

**Pages travel together.** One upload may be several files, sent in a single
model call so cross-page context survives. Splitting them loses the header on
page 1 and the reference ranges on page 3 — the things that make a lab report
readable.

**Two schemas, not one.** A prescription carries medicines, strengths,
frequencies and durations; a lab report carries panels, values, units, reference
ranges and flags. A single generic schema read neither well. Indian `1-0-1`
frequency notation is preserved as written, not translated.

**Magic-byte screening before Tesseract.** Tesseract.js reports a failed decode
by throwing from its worker thread on a later tick, which escapes every
`try/catch` around the call and killed the whole Node process — one truncated
upload from one assistant took the backend down for every clinic.

**Nothing is invented.** Every failure path returns `needs_manual_entry: true`
with an empty `medications`, empty `panels` and an `extraction_error` string.
Ambiguous handwriting is transcribed with a `(unclear)` marker appended rather
than dropped or guessed.

### Health-card OCR — a separate path that stores nothing

`POST /api/documents/health-card` → `readHealthCard()`

```mermaid
flowchart LR
    A["Photo of ABHA / health card"] --> B["Gemini + HEALTH_CARD_RULES"]
    B --> C{"document_type == 'health_card'?"}
    C -->|no| Z["422 — 'not a health or identity card'"]
    C --> D["validateHealthCardFields()"]
    D --> E["full_name: 2–120 chars, not all digits"]
    D --> F["gender ∈ male/female/other"]
    D --> G["date_of_birth: YYYY-MM-DD, ≤ today, ≥ 120 yrs ago"]
    D --> H["year_of_birth kept SEPARATELY —<br/>never turned into a date"]
    E --> I["fields{} + rejected[]"]
    F --> I
    G --> I
    H --> I
    I --> J["PatientRegistrationPage<br/>operator accepts FIELD BY FIELD"]
    J --> K[("patients — only after human acceptance")]
    style Z fill:#fee2e2,stroke:#b91c1c
```

Nothing is persisted by the scan itself. There is no patient record yet, and the
output is a proposal. A rejected field is simply **absent**, and the response
reports which ones were refused — a card whose date of birth failed validation
should say so rather than silently returning three fields when the operator can
see four printed. Most Indian cards print only a year; that is returned as
`year_of_birth` and the form asks the operator for the rest.

---

## 4. The image path

`POST /api/vision/analyze` → `ai.controller.js` `analyzeImageAI` →
`visionService.js` `analyzeInjuryImage`

```mermaid
sequenceDiagram
    autonumber
    participant A as Assistant (browser)
    participant API as ai.controller.js
    participant V as visionService.js
    participant G as Gemini
    participant S as Supabase Storage
    participant DB as Postgres

    A->>API: POST /vision/analyze<br/>{ image, visit_id }
    Note over API: patient_id is derived from the VISIT,<br/>never taken from the body
    API->>DB: SELECT patient_id FROM visits<br/>WHERE id = ? AND district_id = caller<br/>AND deleted_at IS NULL
    DB-->>API: patient_id (or null)

    API->>V: analyzeInjuryImage(buffer, mime)
    V->>G: VISION_SYSTEM_PROMPT + inline image
    alt model answers
        G-->>V: observational JSON
        Note over V: confidence capped at "moderate" IN CODE<br/>severity_impression ∈ LOW/MEDIUM/HIGH
    else unavailable
        G-->>V: null
        Note over V: analysis_possible:false,<br/>severity floored at MEDIUM,<br/>flagged for direct doctor review
    end
    V-->>API: observation

    API->>S: upload → injury-photos/injuries/{patient}/{ts}_{name}
    Note over S: PRIVATE bucket
    alt upload fails
        S-->>API: error
        Note over API: console.error — "the doctor will not see this photo"
    else
        API->>S: createSignedUrl(3600s)
        S-->>API: short-lived URL
    end

    API->>DB: INSERT patient_images<br/>storage_path, observation, severity_impression, engine
    Note over DB: image_url is deliberately NULL —<br/>a stored link that expires is worse than none
    API-->>A: observation + signed URL

    Note over A,DB: Later, the doctor's case view calls withSignedUrls()<br/>to mint a fresh 1-hour URL per request
```

### Design points

- **The patient is derived from the visit.** An earlier version read `patient_id`
  from the request body, which the screen never sent — so the entire storage
  block was skipped, every time. Deriving it also removes the client's ability to
  attach a photograph to a different patient, and the visit lookup is
  district-scoped so a foreign visit id resolves to nothing.
- **The bucket is private and the row stores a path, not a URL.** A permanent
  link to a clinical photograph of an identifiable patient would be viewable by
  anyone who ever saw it — after the case closes, after the staff member leaves,
  after the link is forwarded. Readers mint a one-hour signed URL
  (`imageAccess.js`).
- **The observation is stored with the file.** It is what the doctor actually
  reads, and re-running the model on an old photo would cost money and could
  return something different.
- **Failures are `console.error`, not `console.warn`.** Both the upload failure
  and the insert failure were previously warnings, which is exactly why they went
  unnoticed for the lifetime of the feature: nothing user-facing broke, the
  screen still showed the analysis, and the doctor simply never saw the
  photograph.
- **Severity can only raise the tier.** In `aiOrchestrator.js` §1,
  `RISK_RANK[sev] > RISK_RANK[finalRiskLevel]` — never the reverse.

---

## 5. The triage path

`POST /api/ai/assess` → `ai.controller.js` `analyzePatientCase` →
`aiOrchestrator.js` `runFullPatientAssessment`

This is the central pipeline. Eight ordered stages; the order **is** the safety
argument.

```mermaid
flowchart TD
    IN["POST /api/ai/assess<br/>{ visit_id, symptoms, vitals,<br/>verified_ocr_data, vision_observation }"] --> HY["Hydrate from Postgres:<br/>visit · patient · latest vitals<br/>· documents · stored images"]

    HY --> S1["① calculateRiskLevel()<br/>DETERMINISTIC"]
    S1 --> RT["ruleTier — the FLOOR"]

    RT --> S2["② vision severity"]
    S2 --> M1{"sev > current?"}
    M1 -->|yes| UP1["raise tier"]
    M1 -->|no| KEEP1["unchanged"]
    UP1 --> S3
    KEEP1 --> S3

    S3["③ POST /diagnose<br/>Bernoulli NB · 244,938 vectors"] --> CAND{"service up?"}
    CAND -->|no| NC["candidates = []<br/>'Absence is NOT evidence of good health'"]
    CAND -->|yes| YC["top-5 ranked, demographically gated"]
    NC --> S4
    YC --> S4

    S4["④ retrieveClinicalProtocols()<br/>Qdrant, filter approved = true"] --> S5

    S5["⑤ Groq gpt-oss-120b synthesis<br/>SYSTEM_PROMPT: 7 non-negotiable rules"] --> OK{"parsed AND<br/>patient_summary present?"}
    OK -->|no| DEG["degradedReason set"]
    OK -->|yes| MOD{"model tier > current?"}
    MOD -->|yes| UP2["raise — logged as a warning"]
    MOD -->|no| KEEP2["model CANNOT lower"]

    DEG --> FLOOR{"tier == LOW?"}
    FLOOR -->|yes| MED["→ MEDIUM<br/>'This case was not assessed by the model'"]
    FLOOR -->|no| KEEP3["unchanged"]

    UP2 --> S6
    KEEP2 --> S6
    MED --> S6
    KEEP3 --> S6

    S6["⑥ re-derive everything tier-dependent<br/>requires_doctor · recommended_next_action"] --> S7

    S7["⑦ delete medications<br/>delete supportive_medication_guidance<br/>medication_withheld = true"] --> S8

    S8["⑧ attach immutable safety metadata<br/>rule_tier · degraded · missing_data<br/>· immediate_referral · legal_disclaimer"] --> PERSIST

    PERSIST["map HIGH/MEDIUM/LOW → enum<br/>immediate_referral ⇒ 'emergency'"] --> DB[("ai_assessments INSERT<br/>visits.risk_level UPDATE<br/>status = awaiting_doctor")]
    DB --> GUARD["assertRuleSourced()<br/>throws on any orphan medication"]
    GUARD --> WF["buildTierWorkflow()"]
    WF --> OUT["response: assessment + workflow"]

    style RT fill:#e0e7ff,stroke:#4338ca
    style MED fill:#fef3c7,stroke:#b45309
    style S7 fill:#dcfce7,stroke:#15803d
    style GUARD fill:#dcfce7,stroke:#15803d
```

### The tier combination rule

```
final_tier = MAX(rule_tier, vision_tier, model_tier)
```

Implemented by `higherTier()` in `riskEngine.js` and by explicit `RISK_RANK`
comparisons in `aiOrchestrator.js`. The single most consequential decision in the
system is made by deterministic code, and every probabilistic component can only
push it upward.

Three sub-rules follow from it:

| Rule | Where |
|---|---|
| Missing data escalates — each absent core vital is named and the tier floors at MEDIUM | `riskEngine.js`, missing-data block |
| Degraded AI fails safe to MEDIUM, never LOW | `aiOrchestrator.js` §5 `degradedReason` |
| A reading of `0` is a reading, not an absence | `riskEngine.js` `toNumber()` |

### Inside `calculateRiskLevel()`

```mermaid
flowchart TD
    V["vitals + symptoms + history + patient.age"] --> N["toNumber() — 0 ≠ absent<br/>toFahrenheit() — auto-convert below 45<br/>resolveAgeYears() — accepts months"]
    N --> B["bandForAge() — 7 PALS/IMNCI bands"]

    B --> R1{"IMMEDIATE REFERRAL"}
    R1 --> C1["SpO₂ < 90"]
    R1 --> C2["systolic < 90 or ≥ 180"]
    R1 --> C3["7 red-flag phrases"]
    R1 --> C4["any fever, infant < 2 months"]
    R1 --> C5["fluid loss + severe dehydration sign<br/>IMNCI Plan C"]
    C1 --> HIGHREF["HIGH + immediateReferral<br/>returns immediately"]
    C2 --> HIGHREF
    C3 --> HIGHREF
    C4 --> HIGHREF
    C5 --> HIGHREF

    R1 -->|none| R2{"HIGH, not immediate"}
    R2 --> D1["SpO₂ 90–93"]
    R2 --> D2["RR outside band severe limits"]
    R2 --> D3["temp ≥ 103.5 °F"]

    R2 --> R3{"MEDIUM"}
    R3 --> E1["temp > 101.5 °F"]
    R3 --> E2["pulse outside age band"]
    R3 --> E3["RR outside age band"]
    R3 --> E4["fluid loss + 2 signs — Plan B"]
    R3 --> E5["fluid loss, child < 5"]
    R3 --> E6["fever + cough/vomiting"]
    R3 --> E7["chronic comorbidity in history"]

    R3 --> MISS{"any core vital absent?<br/>SpO₂ · temp · BP · pulse · age"}
    MISS -->|yes| FLOOR["floor at MEDIUM<br/>+ name each missing item"]
    MISS -->|no| LOWOK["LOW is EARNED"]

    style HIGHREF fill:#fecaca,stroke:#b91c1c
    style FLOOR fill:#fef3c7,stroke:#b45309
    style LOWOK fill:#dcfce7,stroke:#15803d
```

### Vocabulary translation at the storage boundary

The rule engine speaks `LOW / MEDIUM / HIGH`. The `risk_level` database enum is
`low / moderate / high / emergency`. **`medium` is not a value the enum accepts**,
and writing it was a silent insert failure for the most common tier there is.
Two translators exist:

- `ai.controller.js` → `RISK_TO_ENUM`, plus `immediate_referral ⇒ 'emergency'`
- `visit.controller.js` → `normaliseRiskTier()`, which accepts either vocabulary
  and returns `null` rather than guessing for anything unrecognised

Eight tests in `backend/tests/visitRiskTier.test.js` assert that it only ever
returns a value the enum accepts.

### The disease-candidate bound

The Python service returns ranked candidates. The prompt gives them to the model
as **evidence to reason over, not as an answer**: the model may re-rank and
reject, but may not introduce a disease outside the list. That bound is what
keeps the final output traceable to 244,938 labelled training rows rather than to
the language model's imagination.

Because the system prompt also forbids naming a definitive diagnosis, the model
never writes the candidates into its prose — which is correct, and would also
mean a doctor could not see what the trained model contributed. So
`disease_candidates` is attached to the response as a **separate, labelled
block**, carrying `confident`, `confidence_note`, `unrecognised_text` and
`excluded_for_demographics`. That separation is the product's core principle
rendered as a data structure.

---

## 6. The realtime notification path

`notificationService.js` `notify()` → `realtimeHub.js` `pushToUser()` →
`RealtimeContext.jsx`

```mermaid
sequenceDiagram
    autonumber
    participant C as Controller
    participant N as notificationService
    participant DB as notifications table
    participant H as realtimeHub
    participant WS as Browser socket
    participant UI as NotificationBell / DoctorQueue

    Note over C: e.g. handOffVisit completes
    C->>N: notify({ recipients, event, payload })
    N->>DB: INSERT one row per recipient
    Note over DB: PERSIST FIRST — an offline<br/>doctor still finds the case waiting
    DB-->>N: inserted rows
    loop each row
        N->>H: pushToUser(recipient_id, payload)
        H->>WS: send to every open tab
    end
    WS->>UI: setNotifications + unread++
    UI->>UI: queue refetches on any notification

    alt socket was closed
        Note over H: pushToUser returns 0 — no error
        Note over UI: GET /api/notifications on next load<br/>recovers everything
    end
```

### Socket lifecycle and authentication

```mermaid
stateDiagram-v2
    [*] --> Upgrade: WSS /realtime?token=...
    Upgrade --> Refused404: path ≠ /realtime
    Upgrade --> Refused403: Origin not in allowlist
    Upgrade --> Refused401: token invalid / no active staff_profile
    Upgrade --> Connected: identity resolved from staff_profiles

    Connected --> Connected: ping / pong every 25s
    Connected --> InCall: call:join — re-verified<br/>against the consultation row
    InCall --> InCall: offer / answer / ice relayed to peers only
    InCall --> Connected: call:leave
    Connected --> [*]: close → cleanup()
    InCall --> [*]: close → peer-left + cleanup()

    note right of Refused403
        Browsers do not apply CORS to
        WebSockets. This origin check is
        the only thing standing in for it.
    end note

    note right of InCall
        A reconnect REPLACES the stale
        socket rather than being rejected
        as a third participant.
    end note
```

**Identity never comes from the query string except as an opaque token.** The
token is verified, then resolved against `staff_profiles`, and the socket's role
is whatever that row says. The original signalling server accepted `role=DOCTOR`
in a URL as sufficient to join a live consultation.

**Membership is re-verified per call.** `isParticipant()` queries the
`consultations` row: the caller must be `doctor_id` or `assistant_id`, and the
consultation must not be `COMPLETED` or `CANCELLED`. A leaked or replayed token
alone does not admit anyone.

### Client resilience

`RealtimeContext.jsx` maintains one socket for the whole app:

- **Exponential backoff** from 1 s to a 15 s ceiling, so a server restart does not
  become a reconnect storm from every open tab.
- **Outbound buffering**, 50 messages, **10-second TTL**. The socket
  authenticates via a database lookup, so it is still opening for a few hundred
  milliseconds after the page starts working; a `call:join` sent into a
  `CONNECTING` socket is silently dropped. The TTL is what keeps the buffer safe
  across a genuine outage — the startup race resolves in well under a second, so
  real messages survive, while stale SDP and ICE are dropped rather than replayed.
- **The scheme is derived from the page**, never from configuration. An HTTPS
  document may not open a `ws://` socket; the browser blocks it as mixed content
  and throws synchronously from the constructor, which — uncaught — would escape
  the effect and take the reconnect loop with it. Only host and path come from
  config.
- **Sign-out clears the outbox**, so the previous user's queued messages are never
  replayed onto the next session's socket.

### The eight notification events

| Event | Fired by | Recipients |
|---|---|---|
| `CONSULTATION_SCHEDULED` | `createConsultation` | doctor + assistant |
| `CONSULTATION_REMINDER` | `consultationSweeper` (~10 min before) | doctor + assistant |
| `CONSULTATION_STARTED` | `joinConsultation` / `createInstantConsultation` | doctor + assistant |
| `CONSULTATION_CANCELLED` | `cancelConsultation`, and `sweepMissed` with `status: MISSED` | doctor + assistant |
| `CONSULTATION_COMPLETED` | `endConsultation` | doctor + assistant |
| `CONSULTATION_FAILED` | `joinConsultation` when the video provider fails | doctor + assistant |
| `CASE_ASSIGNED` | `handOffVisit` | the named doctor |
| `DOCTOR_REVIEW_COMPLETED` | `recordDoctorReview` | the assistant who opened the visit |

The last two carry no consultation, so `consultation_id` is `NULL` — which the
column already allows.

---

## 7. The write path and its invariants

```mermaid
flowchart LR
    subgraph Every clinical write
        A["Aadhaar / vitals validation<br/>patientFields.js · validateVitalsRanges"]
        B["District from req.user.districtId<br/>NEVER from the request body"]
        C["INSERT / UPDATE via supabaseAdmin"]
        D["logAuditEvent — redacted"]
    end
    A --> B --> C --> D
```

| Invariant | Enforced by |
|---|---|
| Tenancy comes from the caller's profile, never the request | `createPatient`, `createVisit`, `uploadDocument`, `analyzeImageAI` all read `req.user.districtId` |
| Vitals are range-checked before they reach the rule engine | `validateVitalsRanges` — a transposed digit produces a physiologically impossible value, and the triage rules would treat it as a genuine red flag |
| Diastolic must be lower than systolic | Cross-field check in the same function |
| Clinical records are append-only | Only soft delete exists (`visits.deleted_at`), guarded four ways |
| The primary key never changes | `updatePatient` strips `aadhaar_number` from the patch — a wrong Aadhaar means a new record, not an edited one, or the visit history follows the wrong person |
| An audit failure never breaks the request it records | `logAuditEvent` catches everything |
| Aadhaar travels in request bodies, never in a URL | `POST /patients/lookup`, `POST /patients/detail` — URLs reach access logs, proxy logs and browser history |
