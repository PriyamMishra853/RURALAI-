# PS 26133 — what is built, what is partial, what is left, and how to finish it

**Problem statement:** Accessibility and quality of public healthcare services, particularly in rural and underserved areas
**Organisation:** Government of Maharashtra — Maharashtra State Innovation Society (MSInS)
**Team:** UNFILTEREDENGINEERS · **Theme:** MedTech / HealthTech · **Category:** Software

This document maps every expected outcome in the problem statement to the running system, and for everything not finished gives a plan precise enough that another engineer — or another AI model — can pick it up cold. It is the handoff document. Read it with [ROADMAP_V3.md](ROADMAP_V3.md) (the phased plan and ground rules) and [13-api-reference.md](13-api-reference.md) (every route).

**Production:** https://ruralai-production-220.up.railway.app · **Repo remote:** `ruralai` (GitHub `PriyamMishra853/RURALAI-`) · a push to `ruralai/main` is a live deploy (Railway).

---

## 0. Status at a glance

| PS asks for | Status | Where it lives |
|---|---|---|
| Assisted teleconsultation | **Built** | consultations, WebRTC call page, doctor queue |
| Appointment and queue management | **Built** | doctor schedules, scheduled/instant consultations, queue by date |
| Digital triage | **Built** | rules engine + AI assessment; rules set the tier, the model may only raise it |
| Longitudinal patient records | **Partial** | per-patient visit history within a district; cross-district needs consent-based access |
| Referral tracking | **Built** | closed-loop hospital referral: slip with QR, hospital acknowledges with no login, follow-up worklist, completion rate |
| Diagnostic coordination | **Not started** | plan in §3.4 |
| Medicine availability | **Partial** | formulary + medicine index; no live stock feed (needs a state inventory API) |
| High-risk patient follow-up | **Built (core)** | follow-up recall from doctor decisions, auto-completed by return visits, adherence measured; SMS/IVR not built |
| Facility dashboards | **Built** | baseline outcomes + outcomes by district, with sample sizes |
| Frontline worker support | **Built** | assistant flow, CHATBOX voice or typed intake, OCR of lab reports and prescriptions |
| Low-connectivity environments | **Partial** | idempotent writes, small bundle, lazy AI; offline capture not built (§3.6) |
| Multilingual interaction | **Built (machine-translated)** | 33 languages in the picker; Marathi, Hindi, Gujarati machine-translated near-complete; native review pending |
| Emergency escalation | **Built** | emergency bypass registration, EMERGENCY tier, 108 on every referral slip |
| Interoperable records on approved standards | **Partial** | FHIR R4 document export, consent-gated; ABHA linkage and FHIR ingest not built |
| Reduced travel and waiting time | **Measured** | intake time, registration→decision, consultation wait, by district |
| Earlier consultation | **Measured** | same |
| Improved referral completion | **Measured** | referral completion rate |
| Better follow-up (maternal, child, chronic) | **Partial** | adherence measured; programme schedules (ANC, immunisation, NCD) not built |
| Medicine/diagnostic visibility | **Partial / not started** | see above |
| Quality monitoring | **Built** | audit log of every clinical and disclosure action; provenance of every intake value; outcome dashboards |

**Our differentiator — the model learns from completed visits.** Built this session and described in §2.1.

---

## 1. What is completely built (and verified)

Every item below is deployed on production, has automated tests, and was checked against the live system.

### 1.1 Frontline intake
- **Registration by Aadhaar** (Aadhaar never in a URL, masked in lists and PDFs), emergency bypass for a patient who cannot wait.
- **Intake form** with vitals range validation, pre-filled defaults that are *marked* until a person confirms them.
- **CHATBOX — speak or type the intake in one conversation.** The assistant talks or types one message at a time in any order and any of the supported languages; the CHATBOX answers with what it understood and what is still missing, reads numbers and questions aloud, and nothing reaches the form until the assistant applies it. Every applied value is marked *heard — tap when checked* and the assessment waits until each is checked. Recording needs a recorded patient consent; typing does not. Proven end to end with real synthesised speech: 10 of 10 fields exact.
- **CHATBOX test set** (`npm run eval:intake`): 28 spoken-style cases in English, Hindi, Marathi, Tamil, Telugu, Bengali, Gujarati; **38/38 vitals exact, 0 fabricated**.
- **Provenance of every intake value** — typed, dictated, voice, chat or untouched default — and whether a person confirmed it. A default nobody confirmed is never exported or learned from.
- **OCR of prescriptions and multi-page lab reports** (Gemini vision with a fallback chain, per-attempt timeout, cool-off for failing models, 120 s job budget).

### 1.2 Triage and the doctor
- **Rules-first triage**: the rules engine sets the tier; the language model may raise it, never lower it; missing data escalates. Medication is never model-authored — only from a signed formulary.
- **Disease-candidate ranking** from a Bernoulli Naive Bayes model (582 diseases, 377 symptoms), always presented as candidates for a doctor, never a diagnosis.
- **Doctor queue, case view, review and prescription**; the case view names vitals nobody measured.
- **Doctor-to-doctor referral** (second opinion, specialist, transfer of care).
- **Teleconsultation** (instant and scheduled), queue by date.

### 1.3 Continuity and accountability
- **Closed-loop hospital referral**: referral slip with code and QR; the hospital desk confirms arrival and outcome with no account; the clinic gets notified; overdue referrals rise to the top of a worklist; **referral completion is measured**.
- **Follow-up recall**: a doctor's "follow up in N days" becomes a scheduled follow-up; the patient's next visit completes it automatically; assistants get a call list with phone numbers; **adherence is measured**.
- **Patient consent**, three purposes kept apart (treatment · sharing outside the clinic · training use), with language, method (spoken / written / thumb impression), wording version and who recorded it. Withdrawal is a state, never a delete.
- **FHIR R4 document export** of a visit, keyed on an internal patient identifier (never Aadhaar), refused without sharing consent, audited as a disclosure.
- **Audit log** of every clinical action and every disclosure.

### 1.4 Dashboards and quality monitoring
- **Baseline outcomes**: intake time (manual vs CHATBOX), registration→decision, handoff→decision, consultation wait, referral completion, follow-up adherence, consent uptake, CHATBOX correction and abandonment rates.
- **Outcomes by district**, one row per district, each figure with its sample size; a dash, never a zero, where nothing was measured.

### 1.5 Platform
- **Feature flags defaulting to released** — a push is the release; `FEATURE_FLAGS=` turns everything off.
- **Idempotent writes** (a retried registration never creates a duplicate), **request IDs** on every response, **content security policy** (report-only), rate limits per user and per clinic, graceful shutdown, health probe, database backup script.
- **Maharashtra seeded**: 36 districts, 216 staff, 900 patients, district hospitals — alongside Uttar Pradesh's 75 districts. 111 districts in all.
- **Landing page** reads its figures from the database and shows the care pathway rather than a single-state map.

---

## 2. The differentiator: a model that learns from the clinics

### 2.1 How it works (built)

```
doctor signs a diagnosis ──► patient has training consent? ──no──► nothing is learned
                                   │ yes
                                   ▼
            de-identified learning example (complaint, diagnosis, age band, gender)
                                   │   the doctor's signed review IS the label confirmation
                                   ▼
        candidate model rebuilt automatically (30 s later, debounced)
        = shipped base model + every approved example   (Naive Bayes partial_fit)
                                   │
                                   ▼
        scored on a FROZEN BENCHMARK (2,910 held-out cases, never trained on)
        beside the live model
                                   │
              not worse? ──no──► cannot be promoted, by anyone
                                   │ yes
                                   ▼
        super admin promotes (or LEARN_AUTO_PROMOTE=true) ──► live model
```

- **Files:** `backend/src/services/learningService.js`, `backend/src/controllers/learning.controller.js`, `backend/src/routes/learning.routes.js`, `AI/LLM/service/learner.py`, `AI/LLM/data/models/frozen_benchmark.json`, `database/v2/25_model_learning.sql`, `frontend/src/components/admin/ModelLearningCard.jsx`.
- **Measured behaviour:** shipped model top-1 76.9 %, top-3 87.3 %, top-5 90.7 % on the frozen benchmark. After learning from four doctor-confirmed clinic cases, "urinary tract infection" rose from outside the top three to second for a local phrasing of the symptoms, with the benchmark unchanged.
- **It surfaces gaps.** A doctor's diagnosis that names no class the model has is reported, not guessed: the first test run showed the model has **no malaria class** — a real gap for rural India.
- **State lives in the database.** A model is always "the shipped base plus this list of examples", rebuilt exactly on every start, so a redeploy loses nothing and rollback is re-activating an earlier version.
- **Why promotion is gated:** a model that silently changes in production is a model nobody can vouch for. The model retrains itself automatically; the frozen benchmark makes getting worse impossible to hide; a person (or, if you choose, the benchmark gate alone) decides when it goes live.

### 2.2 What it needs before it learns anything real
1. **Training consent from patients** — recorded on the assessment screen's consent panel. With none recorded, it learns nothing. That is the design, not a fault.
2. **Ethics committee approval** before real patient data trains a model used in care. The dataset export records an approval reference; it does not grant one.

### 2.3 Next steps for the learning system (plan)
| Step | How |
|---|---|
| Map unmatched diagnoses | Admin screen: pick the model class for a doctor's wording ("P. vivax malaria" → new class). Store in a `diagnosis_label_map` table; `learner.map_diagnosis` consults it before fuzzy matching. |
| Add new classes (e.g. malaria) | Naive Bayes needs a class known up front. Add classes by rebuilding the base with the new label and seeded examples (`training/train_symptom_diagnosis.py` with an extra CSV of clinic examples); the frozen benchmark still guards the old classes. |
| Shadow scoring | Run the candidate beside the live model on every `/diagnose` for a week; store both rankings; promote only if the candidate agreed with doctors' final diagnoses at least as often. |
| Clinician QA sampling | A doctor queue showing 1 in 10 learned examples for a second opinion; rejected ones leave the next candidate. The reject endpoint exists (`POST /api/learning/examples/:id/reject`); it needs a doctor-facing screen. |
| Learn the CHATBOX too | Store confirmed (transcript, fields) pairs under their own consent and fine-tune extraction prompts or a small model; `npm run eval:intake` is the gate. |

---

## 3. Partial and not started — with a plan for each

Each plan names the files to touch, the data to add, and how to know it works. Ground rules in ROADMAP_V3 §1 apply to all of them: additive migrations, a feature flag, the manual path never removed, nothing fabricated, a machine's output is a draft until a person confirms it.

### 3.1 Longitudinal records across districts (partial)
- **Now:** a patient's history is visible within the district that registered them.
- **Plan:** (1) consent-based cross-district read: when a patient with an active `share_with_facility` consent is looked up in another district, show their past visits read-only; record every such read as a disclosure in the audit log. Touch `patient.controller.js` (`getPatientDetail`), `consentRules.refusalForSharing`. (2) Re-key foreign keys from `aadhaar_number` to `patient_uid` once the demo checkpoint is retired (contraction migration).
- **Done when:** a patient referred to another district arrives with their history visible to the receiving doctor, under recorded consent, and the read is in the audit log.

### 3.2 ABHA (ABDM) linkage (not started)
- **Needs:** ABDM sandbox registration (Health Information Provider) — an organisational step, not code.
- **Plan:** add `patients.abha_number` (nullable, consented attribute); implement ABHA verification via the sandbox's Aadhaar/mobile OTP flow; register as an HIP; serve the FHIR document export (§1.3) in response to ABDM consent artefacts. The FHIR export already uses an internal identifier, which is what ABDM expects.

### 3.3 FHIR ingest (not started)
- **Plan:** `POST /api/fhir/import` accepting a Bundle of type `document`; validate structure with the same checks as `bundleProblems`; map Patient/Encounter/Observation/Condition/MedicationRequest to our tables as a *read-only external visit*; never overwrite local records. Run the official HL7 validator in CI on exported bundles first.

### 3.4 Diagnostic coordination (not started)
- **Plan:** a `diagnostic_orders` table (visit, test code — LOINC —, ordered_by, status requested → sample_collected → resulted, facility); a doctor orders a test from the case view; the assistant marks sample collected; results come back via the lab-report OCR (already built) linked to the order; overdue results appear on the assistant worklist like referrals. Metric: order-to-result time by district on the outcomes dashboard.

### 3.5 Medicine stock visibility (partial)
- **Now:** a formulary and a medicine index; no live stock.
- **Plan:** integrate the state drug inventory system (Maharashtra: the state's e-Aushadhi / DVDMS feed, if MSInS can provide access). Until then, let a pharmacist at each centre mark items in/out of stock daily (`facility_stock` table); show "last confirmed in stock on …" — never "available" without a date.

### 3.6 Offline-first capture (groundwork built)
- **Built:** idempotent `POST /api/patients` and `POST /api/visits` (a replayed request returns the original answer).
- **Plan:** (1) make the frontend an installable PWA (Vite PWA plugin, network-first for pages, never cache `/api`); (2) an IndexedDB outbox for registrations and visits, each with an `Idempotency-Key` generated when the form is submitted; (3) replay the outbox when `navigator.onLine` returns, showing "saved on this device — will send when online"; (4) conflict rule: server wins, the device copy is shown beside it for the assistant to reconcile. Test with Chrome DevTools offline mode.

### 3.7 Programme follow-up — maternal, child, chronic (partial)
- **Now:** follow-ups from doctor decisions, adherence measured.
- **Plan:** programme templates (`follow_up_programmes`: ANC visits at weeks 12/20/28/36, immunisation schedule by age, NCD monthly review) that generate follow-ups automatically when a pregnancy (now recorded per visit) or a chronic diagnosis is recorded. Reuse `followUpRules.buildFollowUp` with a programme source.

### 3.8 SMS and IVR reminders (not started)
- **Needs:** a messaging provider account (DLT-registered templates are mandatory in India for SMS).
- **Plan:** a `messages` outbox table; a sender job that sends due follow-up and referral reminders in the patient's language using approved templates; delivery status stored; patients can reply STOP. Never send clinical detail in an SMS — only "please visit the sub-centre on …".

### 3.9 Scaling to 10–20 centres (analysis)
Measured on production (Sept 2026): database 24 MB for ~2,800 visits (~9 KB per visit all-in); warm API latency 0.2–0.7 s; `max_connections` 60 on the Supabase plan; per-user rate limits so a whole clinic behind one IP is not throttled.

| Load (20 centres) | Daily | Headroom |
|---|---|---|
| Visits | 20 × 40 = 800 | Database grows ~7 MB/day → years on the current plan |
| API requests | ~40,000 | Global limit 1,200/min per clinic address; one Railway instance handles this comfortably |
| AI assessments | ~800 | **The binding constraint.** Free-tier Groq allows 8,000 tokens/min per key; an assessment uses ~3–4 k. Four keys ≈ 8–10 assessments/min at peak |
| OCR / vision | ~200 | Gemini free tier refuses in runs (503/429); the fallback chain and cool-off absorb it |

**Plan for 20 centres:** move Groq and Gemini to paid tiers (the single biggest lever — tens of dollars a month at this volume); add a second Railway instance behind the same domain once realtime runs over a shared pub/sub (Redis) and rate limits move to a shared store (both listed in ROADMAP Phase 6); add a `facilities` table so each centre is its own unit on the dashboards (today the unit is the district).

### 3.10 Native-speaker review of translations
- **Now:** Marathi, Hindi and Gujarati machine-translated to near-full coverage; placeholders validated; marked *unreviewed* in the language picker, which is honest.
- **Plan:** export each locale to a spreadsheet (`key · English · Marathi`), have a Marathi-speaking health worker correct it, import, and set `reviewed: true` in `frontend/src/i18n/languages.js`. Clinical terms first: triage tiers, referral instructions, consent wording.

### 3.11 Enforcing the content security policy
- Watch Railway logs for `CSP would block` during the pilot; when quiet for a week, set `CSP_ENFORCE=true`.

---

## 4. For whoever picks this up next

- **Never start `backend/src/server.js` locally** — `backend/.env` points at the production database and its background sweeper writes to it. Test with `npm test` (Supabase mocked), `node -e "import('./src/app.js')"`, and validate migrations on production only inside a transaction that is rolled back.
- **Migrations** live in `database/v2/` (numbered, additive). Apply with `npm run db:migrate <file>` from `backend/`. Current head: `25_model_learning.sql`.
- **Every push to `ruralai/main` deploys.** Watch the service build with `gh api repos/PriyamMishra853/RURALAI-/deployments` — the environment called `perpetual-eagerness / production` is the real one; a "Production" success alone does not mean the site changed. `/api/health` reports the running commit.
- **Tests:** `cd backend && npm test` (≈ 560 tests). One suite (`languageContract`) makes live translation calls and can time out under load; it passes alone.
- **Evaluation gates:** `npm run eval:intake` (CHATBOX extraction) and the frozen benchmark in `/learn/status` (diagnosis model).
- **Ground rules** (ROADMAP_V3 §1) are the contract: AI prepares, a doctor decides; a machine's output is a draft until a person confirms it; nothing is fabricated; manual paths are never removed; database changes are additive; new capability ships behind a flag; measure before changing.
