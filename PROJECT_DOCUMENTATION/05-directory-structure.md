# 05 — Directory Structure

> **Navigation:** [Index](README.md) · Previous: [04 — Workflow](04-workflow.md) · Next: [06 — Database Schema](06-database-schema.md)

Every significant directory and file, one line each. Generated files
(`node_modules/`, `dist/`, `.venv/`, `__pycache__/`) and gitignored data
(`AI/LLM/data/raw/`, `.env`) are excluded from the tree but noted where relevant.

---

## Root

```
RURALAI-/
├── README.md                    Project front door — what, why, architecture, quick start
├── PROJECT_DOCUMENTATION/       This documentation set
├── implementation_plan.md       Living plan: Phase 0–3, each researched then executed
├── HANDOFF.md                   Session handoff notes (partly stale — see §7)
├── railway.json                 Railway build and deploy configuration
├── nixpacks.toml                Nixpacks image: nodejs_20 + python311 + nixLibs for the C++ runtime
├── start.sh                     Production entrypoint — uvicorn on loopback, then exec node
├── build-ai.sh                  Python dependency build; exits 0 on failure BY DESIGN
├── start-dev.sh                 Local three-service launcher with port cleanup and health polling
├── .gitignore                   Excludes .env, node_modules, dist, AI/LLM/data/raw, DEMO_CREDENTIALS.md
├── .gitattributes               Line-ending and binary-file handling
├── backend/                     Express API
├── frontend/                    React SPA
├── database/                    SQL schema, RLS and migrations
├── AI/                          Python inference service and training
└── docs/                        Historical readiness and progress records
```

---

## `backend/`

```
backend/
├── package.json                 17 runtime deps, 2 dev deps, 15 npm scripts, engines.node >= 22
├── jest.config.js               ESM via VM modules, no Babel; coverage scoped to services/ and middleware/
├── Procfile                     Heroku-style process declaration
├── eng.traineddata              Tesseract English language data, committed so OCR needs no download
├── .env.example                 Every variable with a comment — names only, no values
│
└── src/
    ├── server.js                HTTP server, realtime hub, video provider resolution at boot,
    │                            consultation sweeper, and last-resort process guards
    ├── app.js                   Express app: helmet, CORS allowlist, body limits, static SPA,
    │                            13 routers, SPA fallback, global error handler
    │
    ├── config/
    │   ├── env.js               Validated configuration. Refuses to start in production on a
    │   │                        missing/short/known-leaked JWT_SECRET or missing CORS allowlist
    │   ├── models.js            EVERY model id, in one place, overridable by env;
    │   │                        verifyModelsAvailable() proves they still exist at the provider
    │   ├── keyPool.js           Groq key pool — round-robin, 429 benching, 401/403 retirement
    │   ├── groq.js              Thin wrapper: groqChat / groqTranscribe over the pool
    │   ├── gemini.js            Hand-written Gemini REST client with a model fallback chain
    │   ├── qdrant.js            Qdrant client, or null when no cluster is configured
    │   ├── supabase.js          Two clients: anon (RLS-bound) and service-role (bypasses RLS)
    │   └── roles.js             The six-role model, DB↔API mapping, CREATABLE_ROLES, HOME_ROUTE
    │
    ├── middleware/
    │   ├── auth.middleware.js   authenticateUser (JWT or Supabase token → staff_profiles),
    │   │                        authorizeRoles, attachRegionScope, applyScope
    │   ├── clinicalAccess.middleware.js  Structural admin/auditor lockout from clinical routers
    │   ├── rateLimit.middleware.js       Login, patient-search, AI and global limiters
    │   └── audit.middleware.js  logAuditEvent with recursive redaction of Aadhaar, ABHA, tokens
    │
    ├── routes/                  13 routers; every one mounts authenticateUser first
    │   ├── auth.routes.js       login / logout / me. Deliberately NO register route
    │   ├── patient.routes.js    Aadhaar-keyed reads are POSTs so the number never enters a URL
    │   ├── regions.routes.js    States and districts for the registration dropdowns
    │   ├── visit.routes.js      Visit CRUD, handoff, review read-back, soft delete
    │   ├── document.routes.js   Multi-file upload, health-card scan, extraction verification
    │   ├── ai.routes.js         Assessment, transcription, document/image analysis, service status
    │   ├── vision.routes.js     Alias for image analysis — carries the same three guards
    │   ├── voice.routes.js      Alias for transcription — carries the same three guards
    │   ├── doctor.routes.js     Directory, queue, queue dates, case detail, review
    │   ├── consultation.routes.js  Availability, booking, join/end/cancel, listing
    │   ├── notification.routes.js Inbox and mark-read, always scoped to the caller's own id
    │   ├── report.routes.js     Streaming PDF endpoint with the same clinical scoping
    │   └── admin.routes.js      Regions, staff CRUD, analytics, audit
    │
    ├── controllers/
    │   ├── auth.controller.js         Sign-in via Supabase Auth; role always from staff_profiles
    │   ├── patient.controller.js      Registration, urgent bypass, lookup, detail, update
    │   ├── visit.controller.js        Visit lifecycle, vitals range validation, handoff, withdrawal
    │   ├── document.controller.js     Upload, verification, listing, health-card scan
    │   ├── ai.controller.js           Assessment orchestration, storage, transcription, vision, lab interpretation
    │   ├── doctor.controller.js       Queue, queue dates, case detail, review, doctor directory
    │   ├── consultation.controller.js Scheduling surface and the full state machine
    │   └── admin.controller.js        Region-scoped staff CRUD, analytics, audit reads
    │
    ├── services/
    │   ├── riskEngine.js              DETERMINISTIC TRIAGE. Age bands, IMNCI dehydration, red flags
    │   ├── aiOrchestrator.js          The 8-stage assessment pipeline and the tier-combination rule
    │   ├── aiInferenceClient.js       Fail-soft client for the Python service, 30s circuit breaker
    │   ├── ragEngine.js               Qdrant retrieval filtered on approved = true
    │   ├── formularyService.js        8-gate medication rules engine + assertRuleSourced
    │   ├── ocrService.js              Two-engine document OCR, two schemas, health-card reading
    │   ├── visionService.js           Wound-photo observation, confidence capped in code
    │   ├── speechService.js           Whisper + three independent hallucination rejection gates
    │   ├── labInterpretationService.js Second-stage reasoning over transcribed lab values
    │   ├── tierWorkflowService.js     What each tier PRODUCES; medication withheld at every tier
    │   ├── referralService.js         75 UP district hospitals, haversine nearest-facility
    │   ├── schedulingService.js       IST slot grid, availability, join window
    │   ├── consultationSweeper.js     60s sweep: MISSED marking and reminders
    │   ├── notificationService.js     Persist-then-push, 8 event types
    │   ├── realtimeHub.js             The single authenticated WebSocket: notifications + signalling
    │   ├── reportPdfService.js        Three pdfkit templates: summary, prescription, referral
    │   ├── imageAccess.js             Short-lived signed URLs for the private photo bucket
    │   ├── patientFields.js           Validation regexes and derived age — the authority
    │   └── video/
    │       ├── VideoProvider.js       The abstraction the state machine talks to
    │       ├── P2PProvider.js         Active provider: P2P WebRTC + ICE/TURN construction
    │       ├── MediasoupProvider.js   SFU implementation; unavailable without the native worker
    │       └── index.js               Provider selection at boot, not at call time
    │
    ├── data/
    │   ├── formulary.js               5 OTC entries, all UNSIGNED_PLACEHOLDER, with dose bands
    │   ├── regions.js                 36 states/UTs and 75 UP districts
    │   └── indianNames.js             Name, specialisation and complaint pools for the demo seed
    │
    ├── scripts/
    │   ├── applyV2.js                 Destructive schema apply — runs files 01–06 only
    │   ├── seedV2.js                  Deterministic demo seed: 36/75/375/75/1,875
    │   ├── seedRootAdmin.js           Provisions the super_admin from environment credentials
    │   ├── seedSchedules.js           Doctor working hours — without these every date reads "Closed"
    │   ├── seedDailyWorkload.js       Exactly 5 cases per doctor, reproducible per date
    │   ├── seedQdrant.js              3 protocols + the payload index the approved filter needs
    │   ├── rotateDemoPassword.js      Rotates the shared demo password; demo domain only
    │   ├── checkServices.js           Live reachability for 8 services, plus model existence
    │   ├── checkAiPipelines.js        Real input through the OCR, lab and vision pipelines
    │   ├── preflight.js               Six checks that otherwise fail silently
    │   ├── inspectState.js            Row counts and demo-flag warnings for a target database
    │   ├── testGroqLlm.js             Minimal Groq smoke test
    │   └── lib/
    │       ├── db.js                  pg client factory and SQL file runner
    │       └── testImage.js           Generates bitmap-text fixtures so no clinical data is carried
    │
    └── tests/                   9 suites, 135 tests. Fakes injected — no network, no AI spend
        ├── riskEngine.test.js          28 tests, organised by safety invariant
        ├── aiOrchestrator.test.js      15 tests: degradation, tier combination, medication discard
        ├── formularyService.test.js    22 tests: all 8 gates, rule sourcing, rendered line
        ├── medicationBoundary.test.js   6 tests: no drug name reaches the assistant at any tier
        ├── healthCardOcr.test.js       14 tests: values that must never reach the form
        ├── realtimeHub.test.js         10 tests against a real ws server
        ├── speechService.test.js        7 tests: hallucination and padding-artifact detection
        ├── visitRiskTier.test.js        8 tests: the MEDIUM → moderate translation
        └── visitWithdrawal.test.js     12 tests: every refusal guard
```

---

## `frontend/`

```
frontend/
├── package.json                 11 runtime deps, 5 dev deps
├── vite.config.js               Dev server on :3000; /api and /realtime proxies
├── tailwind.config.js           Design tokens: gov-* navy, tier-* semantic risk, ink-*, surface-*
├── postcss.config.js            Tailwind + autoprefixer
├── vercel.json                  Alternative split deployment (see Setup Guide §10)
├── index.html                   SPA shell
├── .env.example                 Every VITE_ variable with a comment
├── public/
│   └── video-lab.html           Standalone WebRTC test harness used during the video evaluation
│
└── src/
    ├── main.jsx                 React root and router mount
    ├── index.css                Tailwind layers, the tricolour rule, theme CSS variables
    ├── App.jsx                  10 routes; NO admin role appears on any clinical route
    │
    ├── config/
    │   ├── roles.js             Mirrors backend roles.js — navigation only, never a security boundary
    │   ├── patientFields.js     Mirrors backend validation so the form validates as the user types
    │   ├── vitals.js            7 vital fields with typical defaults, hard limits and alert ranges
    │   └── supabase.js          Realtime client, or a no-op chain when unconfigured
    │
    ├── context/
    │   ├── AuthContext.jsx      Session state; revalidates the cached user against GET /auth/me
    │   ├── RealtimeContext.jsx  ONE socket for the app: backoff, outbox with TTL, scheme from the page
    │   └── ThemeContext.jsx     Light/dark with system preference and persistence
    │
    ├── pages/
    │   ├── LandingPage.jsx              Public page: the gap, how it works, the clinical-use notice
    │   ├── LoginPage.jsx                One sign-in form for every role; no sign-up route exists
    │   ├── AssistantDashboard.jsx       Recency stack of 8, server-side search, consultations, urgent entry
    │   ├── PatientRegistrationPage.jsx  Two-step registration with optional health-card pre-fill
    │   ├── PatientAssessmentVisitPage.jsx  The main workspace — 4 tabs, 1,377 lines
    │   ├── DoctorQueueDashboard.jsx     Day picker, worst-first queue, consultation list
    │   ├── DoctorCaseViewPage.jsx       Full case evidence and the review form
    │   ├── AdminDashboard.jsx           Metrics, staff accounts, audit log; auditOnly variant
    │   └── CallPage.jsx                 P2P WebRTC with perfect negotiation and declarative rejoin
    │
    └── components/
        ├── AppShell.jsx                 Header, role badge, notification bell, theme toggle
        ├── RequireRole.jsx              Route guard — renders, never authorises
        ├── ErrorBoundary.jsx            A crash in one page must not blank the whole app
        ├── ClinicalUseNotice.jsx        The single source of the "not for clinical use" wording
        ├── AIDoctorVisualSeparation.jsx AI assistance and doctor decision as distinct regions
        ├── TierSystem.jsx               TierBadge, TierBanner, DangerZone, TierLegend
        ├── TierResult.jsx               One component, three genuinely different tier screens
        ├── RiskBadge.jsx                Compact tier chip
        ├── DemoBadge.jsx                Marks is_demo rows so nobody mistakes them for clinical data
        ├── SpeakButton.jsx              Browser SpeechSynthesis read-aloud, offline-capable
        ├── FileCaptureInput.jsx         In-page camera preview + file picker, multi-page batches
        ├── OCRVerificationModal.jsx     Mandatory side-by-side human confirmation
        ├── HealthCardScanner.jsx        Card scan producing a field-by-field proposal
        ├── UrgentRegistrationModal.jsx  Emergency bypass registration
        ├── DoctorSelectGrid.jsx         District doctor roster for handoff
        ├── ScheduleConsultationModal.jsx  Date strip, slot grid, instant path
        ├── DoctorReviewPanel.jsx        The doctor's decision, on the assistant's screen
        ├── CaseEvidence.jsx             Documents and photographs as the doctor sees them
        ├── NotificationBell.jsx         Unread count and the notification list
        ├── DistrictNetwork3D.jsx        Three.js landing visual; disposes GPU resources on unmount
        ├── admin/Charts.jsx             TrendChart, RiskChart, BarList, VisitFunnel — each with a data table
        ├── landing/Interactive.jsx      Landing page interactive sections
        └── ui/index.jsx                 cn, Button, Card, Stat, Input, Select, Alert, Badge,
                                         EmptyState, Skeleton, Spinner
```

Two files intentionally duplicate backend logic — `config/roles.js` and
`config/patientFields.js` — so the form can validate as the user types instead of
waiting for a round trip. Both carry a header comment naming the backend file as
the authority.

---

## `database/`

```
database/
├── v2/                          THE CURRENT SCHEMA. Apply these, in order.
│   ├── README.md                Why v2 exists, the role model, Aadhaar storage rationale, RLS properties
│   ├── 01_reset.sql             Drops every v1 table and enum type
│   ├── 02_schema.sql            14 core tables, 9 enums, indexes, touch_updated_at() triggers
│   ├── 03_rls.sql               RLS on 14 tables, ~40 policies, 6 SECURITY DEFINER helpers
│   ├── 04_visit_history.sql     medical_history, known_allergies, structured symptom duration
│   ├── 05_consultations.sql     doctor_schedules, the rebuilt consultations table, notifications,
│   │                            and the two partial unique indexes that are the real race guard
│   ├── 06_patient_images.sql    patient_images; DOCTOR_REVIEW_COMPLETED; assistant read policies
│   ├── 07_case_handoff.sql      Adds CASE_ASSIGNED — must run OUTSIDE a transaction
│   ├── 08_visit_soft_delete.sql deleted_at / deleted_by / deletion_reason + partial live index
│   ├── 09_emergency_registration.sql  Nullable identity columns + conditional CHECK
│   ├── 10_admin_analytics.sql   admin_analytics() — aggregates in Postgres, not in Node
│   └── DEMO_CREDENTIALS.md      Generated by the seed. GITIGNORED — not in the repository
│
├── schema.sql                   ── v1, SUPERSEDED. Historical reference only ──
├── apply_all.sql                ── v1, SUPERSEDED ──
├── seed.sql                     ── v1, SUPERSEDED ──
└── migrations/
    ├── 001_medication_rule_source.sql  ── DEAD: targets ai_recommendations, dropped in v2 ──
    └── 002_patient_is_demo_flag.sql    ── DEAD: superseded by 02_schema.sql; keys on patients.id ──
```

Full column-by-column detail and applied status: [06 — Database Schema](06-database-schema.md).

---

## `AI/LLM/`

```
AI/LLM/
├── MASTER_PLAN.md               The five-pipeline plan and the build log of what actually landed
├── DEPLOYMENT.md                Why the inference service was silently never running, and how it starts now
├── requirements.txt             8 packages as RANGES, with the reason ranges beat pins
│
├── service/
│   ├── app.py                   FastAPI: /health, /diagnose, /medicine-availability, /precautions/{d}
│   │                            plus the symptom matcher and the demographic impossibility gates
│   └── run.sh                   Local launcher on 127.0.0.1:8001, venv-aware across platforms
│
├── training/
│   ├── _env.py                  Loads Kaggle credentials from the gitignored backend/.env
│   ├── check_kaggle.py          Confirms authentication before anything tries to download
│   ├── download.py              Fetches the three Kaggle datasets into the gitignored raw/ tree
│   ├── inspect_datasets.py      Prints shape, columns and value ranges for each dataset
│   ├── probe_medicines.py       Proves the medicines dataset has NO disease/indication column
│   ├── train_symptom_diagnosis.py  Trains Bernoulli NB + a centroid baseline; exports artifacts
│   └── build_medicine_index.py  Builds the molecule → product availability index and precautions
│
├── eval/
│   └── test_symptom_matching.py Regression tests; every case is a failure that actually happened
│
└── data/
    ├── clinical_aliases.json    280 Indian-English / Hindi transliteration → vocabulary mappings
    ├── up_district_hospitals.json  75 UP district hospitals with coordinates and a _meta rationale
    ├── models/                  COMMITTED artifacts — a deploy needs no training step
    │   ├── symptom_nb.joblib          3.6 MB Bernoulli NB estimator
    │   ├── symptom_vocabulary.json    377 symptoms, 582 disease labels
    │   ├── symptom_model_meta.json    Training date, row counts, held-out metrics
    │   ├── centroids.npy              1.8 MB centroid baseline
    │   ├── medicine_index.json        5 molecules, strengths, prices, real Indian products
    │   └── precautions.json           41 diseases → precaution lists
    └── raw/                     GITIGNORED — 223 MB of Kaggle CSVs, re-fetch with download.py
```

---

## `docs/`

```
docs/
├── PHASE1_PRODUCTION_READINESS_PLAN.md   1,192 lines. The plan whose section numbers
│                                         (§A.4, §B.1, §C.3, §D.2, §D.6, §J.5) are cited
│                                         throughout the source comments
└── PHASE2_PROGRESS.md                    396 lines. Nine batches of remediation, with the
                                          bugs found, the false passes caught, and the gap list
```

These are historical engineering records, not user documentation. They are the
reason so many source files carry a comment explaining what a line prevents —
each one is a defect that actually occurred.

---

## Files worth opening first

| Question | File |
|---|---|
| How is a case triaged? | `backend/src/services/riskEngine.js` |
| How is the AI bounded? | `backend/src/services/aiOrchestrator.js` — system prompt, then §7 |
| What is the data model? | `database/v2/02_schema.sql` |
| Who can do what? | `backend/src/config/roles.js` + `database/v2/03_rls.sql` |
| What does the trained model actually do? | `AI/LLM/service/app.py` → `match_symptoms`, `diagnose` |
| How accurate is it? | `AI/LLM/data/models/symptom_model_meta.json` |
| What is the medication boundary? | `backend/src/services/formularyService.js` + `tierWorkflowService.js` |
| What is not built? | [16 — Known Limitations](16-known-limitations-and-risks.md) |
