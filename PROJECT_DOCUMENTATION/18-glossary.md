# 18 — Glossary

> **Navigation:** [Index](README.md) · Previous: [17 — Architecture Decision Record](17-architecture-decision-record.md) · Next: [19 — Contributing and Conventions](19-contributing-and-conventions.md)

Clinical, Indian health-system and project-specific terms used throughout this
documentation and the source code.

---

## Clinical

**ABHA (Ayushman Bharat Health Account)** — India's national digital health id
under ABDM. A 14-digit number linking a person's health records. Stored as
`patients.abha_number VARCHAR(17)` and populated **only** by card OCR, never
typed.

**Antipyretic** — a fever-reducing medicine. Paracetamol is the formulary's
antipyretic, and it is **blocked entirely for infants under 3 months**, because
fever at that age requires medical assessment rather than treatment.

**Chief complaint** — the patient's own stated main problem, in their words.
`visits.chief_complaint`.

**Comorbidity** — a coexisting chronic condition. `riskEngine.js` escalates to
MEDIUM on `diabetes|hypertension|heart|copd|asthma` in the recorded history,
because these raise the baseline risk of an acute presentation.

**Contraindication** — a reason a medicine must **not** be given to this patient.
Formulary gate 4, checked against recorded history.

**Dehydration, IMNCI plans** — WHO's three-plan classification:
- **Plan A** — no dehydration, home fluids.
- **Plan B** — *some* dehydration; supervised ORS. Triggered here by fluid loss
  plus **two** dehydration signs → MEDIUM.
- **Plan C** — *severe* dehydration; immediate referral and IV fluids. Triggered
  by fluid loss plus a severe sign (lethargy, unable to drink, no urine, sunken
  fontanelle) → HIGH with immediate referral.

**Diastolic / Systolic** — the two blood-pressure numbers. Systolic is pressure
during a heartbeat, diastolic between beats, written `120/80 mmHg`. The system
enforces diastolic < systolic as a cross-field check, and treats systolic < 90
(shock) or ≥ 180 (hypertensive crisis) as immediate-referral red flags.

**First aid** — immediate care a trained non-clinician may give: positioning,
wound cleaning and dressing, cold sponging, encouraging fluids, monitoring
intervals. In this system, first-aid steps **never name a medicine**.

**Hypoxaemia** — low blood oxygen. SpO₂ below 90% is an immediate-referral red
flag.

**IMNCI (Integrated Management of Neonatal and Childhood Illness)** — WHO/UNICEF
protocols for under-fives, adapted for India. Source of the paediatric
respiratory-rate bands, the dehydration plans, and the rule that **any** fever in
an infant under 2 months requires immediate referral.

**Mastitis** — breast infection. Appears in this documentation because the
classifier ranked it for a five-year-old boy before the demographic gates existed.

**NEWS2 (National Early Warning Score 2)** — a UK-derived deterioration score.
One of the published sources for the triage thresholds. **Not validated for this
deployment** — see [16 §C2](16-known-limitations-and-risks.md#c2-triage-thresholds-are-unvalidated-for-this-deployment).

**NLEM (National List of Essential Medicines)** — India's essential-medicines
list. With the WHO Model List, the source of the formulary's dose figures.

**NMC (National Medical Commission)** — India's medical regulator, successor to
the MCI. `doctor_profiles.registration_number` holds the NMC or state council
number. Its **Telemedicine Practice Guidelines 2020** restrict prescribing to
registered practitioners.

**ORS (Oral Rehydration Solution)** — the WHO low-osmolarity salt-and-sugar
solution for dehydration. Formulary entry `FORM-ORS-001`.

**OTC (Over-the-counter)** — a medicine legally sold without prescription. Every
formulary entry is OTC; Schedule H/H1/X drugs (antibiotics, steroids, opioids)
are explicitly forbidden by the system prompt.

**PALS (Pediatric Advanced Life Support)** — source of the age-banded pulse
thresholds in `VITAL_BANDS`.

**Peri-arrest** — the period immediately before or after cardiac arrest. Cited in
the code as the reason an SpO₂ reading of **0** must be treated as a reading
rather than as "not recorded".

**Red flag** — a sign requiring immediate escalation. Seven phrases in
`RED_FLAG_SYMPTOMS`: chest pain, unconscious, severe shortness of breath, heavy
bleeding, seizure, stiff neck, altered sensorium.

**Referral** — sending a patient to a higher facility. HIGH-tier cases are
referred to the nearest district hospital and the case **closes on this
platform**.

**SpO₂** — peripheral oxygen saturation, measured by pulse oximeter. Normal
95–100%; 90–93% is HIGH tier; below 90% is immediate referral.

**STG (Standard Treatment Guidelines)** — condition-specific protocols published
by MoHFW and IPHS. The corpus `ragEngine.js` retrieves from — currently **3 demo
protocols**.

**Tachycardia / Tachypnoea** — abnormally fast heart rate / breathing. Both are
assessed against **age-banded** ranges, because adult thresholds applied to a
child are wrong in both directions.

**Triage** — sorting patients by urgency. Here: LOW / MEDIUM / HIGH in the rule
engine; `low` / `moderate` / `high` / `emergency` in the database.

**Vitals** — objective measurements: temperature, blood pressure, pulse, SpO₂,
respiratory rate, blood glucose. `visit_vitals`.

---

## Indian health system

**AB-PMJAY (Ayushman Bharat Pradhan Mantri Jan Arogya Yojana)** — India's
publicly funded health insurance scheme.

**ABDM (Ayushman Bharat Digital Mission)** — the national digital health
infrastructure programme: ABHA ids, health-facility and professional registries,
and consent-based record exchange.

**ASHA (Accredited Social Health Activist)** — a community health worker. The
`CLINIC_ASSISTANT` role corresponds to a trained health worker at this level or
above.

**CHC (Community Health Centre)** — serves roughly 80,000–120,000 people, with
specialists. Between PHC and District Hospital.

**District Hospital** — the referral destination for HIGH-tier cases. All **75**
UP district hospitals ship with coordinates in `up_district_hospitals.json`.

**eSanjeevani** — India's national teleconsultation platform. The reimbursement
framework referenced in the sustainability model.

**IPHS (Indian Public Health Standards)** — MoHFW's facility standards. Cited as
the source of seeded protocol 102.

**MoHFW (Ministry of Health and Family Welfare)** — the union health ministry.
The protocol corpus is aligned to its Standard Treatment Guidelines.

**NHM (National Health Mission)** — the umbrella programme funding rural health
infrastructure. The budget line a per-facility licence would sit under.

**PHC (Primary Health Centre)** — serves roughly 20,000–30,000 people, with a
medical officer. In this platform the reviewing doctor's tier, and the target
host for the edge model in
[Section 12](12-next-generation-model-roadmap.md).

**Sub-centre** — the most peripheral public health facility, serving roughly
3,000–5,000 people, staffed by health workers with **no resident doctor**. This
is the deployment target: `patients.clinic_district_id` is its tenancy key.

**UIDAI (Unique Identification Authority of India)** — issues Aadhaar. Allocates
real numbers from **2–9**, which is why demo Aadhaars begin with `0` and
emergency guest identifiers begin with `1` — both satisfy the 12-digit constraint
while being structurally incapable of colliding with a real person's number.

---

## Project-specific

**Assessment** — one run of the AI pipeline over a visit. Stored in
`ai_assessments`.

**Assistant** — shorthand for the `CLINIC_ASSISTANT` role: the trained health
worker who operates the system.

**Bounded candidates** — the rule that the LLM may re-rank and reject the
classifier's disease candidates but may **not** introduce one outside the list.
What keeps output traceable to training data.

**Case** — a visit as the doctor sees it: patient, vitals, symptoms, documents,
photographs and the AI assessment together.

**Circuit breaker** — the 30-second cooldown in `aiInferenceClient.js` that stops
a down service turning a degraded feature into a slow page.

**Danger zone** — the HIGH-tier UI state. Red wash, other navigation suppressed,
a single forward action. *"When a case is an emergency the interface should not
offer six equally-weighted options."*

**Degraded** — `degraded: true` on an assessment, meaning the model did not
successfully contribute. Always accompanied by a tier floor at MEDIUM.

**Emergency bypass** — `registration_mode = 'emergency_bypass'`. A provisional
record for a patient who needs care before their documents exist. Identity fields
are left **null**, not invented.

**Formulary** — `backend/src/data/formulary.js`. Five practitioner-signable OTC
entries with dose bands, contraindications, allergy keys and red-flag exclusions.
**The only source of medication in the system.** Currently all
`UNSIGNED_PLACEHOLDER`.

**Guest identifier** — a 12-digit id beginning `1`, allocated by emergency
registration.

**Handoff** — the assistant sending a case to a named doctor. Returns a
**manifest** of exactly what the doctor will receive.

**Key pool** — `config/keyPool.js`. Round-robin across four Groq keys with
per-key benching and retirement.

**Manifest** — the `sent` object returned by handoff: assessment present, vitals,
symptoms, documents, verified documents, images. *"'Case sent' with no statement
of what was sent is what let empty cases through unnoticed."*

**Padding artifact** — Whisper's hallucination on silence. Detected structurally:
Whisper pads short audio to a 30-second window and labels the whole window, so a
segment ending more than 5 s past the reported duration is the artefact.
`no_speech_prob` is not usable — on pure silence Whisper returned *"Thank you."*
with `no_speech_prob: 0`.

**Perfect negotiation** — the WebRTC pattern where each peer has a fixed
politeness so an offer collision resolves itself. `DOCTOR` is the polite peer,
because election by arrival order cannot survive a rejoin.

**Preflight** — `npm run preflight`. Six checks on the state that fails silently
between demonstrations.

**Recency stack** — the assistant dashboard's 8 most recent patients. *"Making
the assistant search for someone they saw an hour ago is the wrong default."*

**Rule source id** — `rule_source_id`, stamped on every emitted medication
naming the formulary entry it came from. `assertRuleSourced()` throws without it.

**Rule tier** — the tier from the deterministic engine alone, preserved as
`rule_tier` on every assessment so the model's contribution is separable.

**Scope** — `req.scope`, derived from the caller's own profile. National, state or
district. A request may narrow it, never widen it.

**Soft delete** — withdrawal via `visits.deleted_at`. The row stays and records
who withdrew it and why.

**Tenancy** — `clinic_district_id`: which sub-centre holds the record. Distinct
from `address_district`, where the patient lives.

**Tier** — the triage level, and what it **produces**. See `tierWorkflowService.js`.

**Tier workflow** — the tier-specific output bundle: LOW = complete plan, MEDIUM
= consultation required, HIGH = referral. The differences change who is
accountable for the patient next.

**Verified extraction** — an OCR result a human has confirmed
(`verified_at IS NOT NULL`). Until then it is a **draft** and is not clinical
input.

**Withdrawal** — an assistant removing an accidental entry, refused once a doctor
is involved.

---

## Technical

**Bernoulli Naive Bayes** — the classifier. The textbook fit for binary
presence/absence features, and the only candidate that returns calibrated
per-class probabilities — which is what makes *"I do not know"* expressible.

**Compare-and-set** — updating with a `WHERE` clause on the expected current
state, so a race produces one winner and a clean loss.

**Containment** — `|shared| / |term|`: what fraction of a vocabulary term's
meaning is present in the input. Used instead of Jaccard, which punished long
inputs.

**DPO (Direct Preference Optimisation)** — the preference-tuning method planned
in [Section 12](12-next-generation-model-roadmap.md), consuming
`doctor_reviews.agreed_with_ai`.

**Fail soft** — returning a safe degraded value rather than an error. Contrasted
with *fail plausibly*, which this system treats as the primary hazard.

**LoRA / QLoRA** — low-rank adaptation: fine-tuning a small set of added
parameters while the base weights stay frozen. Planned for §12.

**Partial index** — an index with a `WHERE` clause. Used for live visits, unread
notifications, unreconciled emergency records, and — critically — the two
**partial unique** indexes enforcing one ACTIVE consultation per doctor and per
patient.

**PostgREST** — the REST layer Supabase exposes over Postgres. Its **1,000-row
response cap** caused one wrong-but-plausible dashboard and is why
`admin_analytics()` aggregates in SQL.

**RLS (Row-Level Security)** — Postgres per-row access policies. ~40 defined in
`03_rls.sql`. A table with RLS on and no policy denies all access.

**Service-role key** — the Supabase key that **bypasses RLS**. Server-only, and
the reason the Express guards remain.

**SFU (Selective Forwarding Unit)** — a media server routing streams between more
than two peers. `MediasoupProvider` implements one; it is not installed.

**Signed URL** — a time-limited link to a private storage object. Wound
photographs use 1-hour signed URLs, minted per request.

**STUN / TURN** — WebRTC NAT traversal. STUN discovers your public address; TURN
**relays** media when a direct path is impossible. TURN is required across
carrier-grade NAT, which is the normal case on a rural mobile ISP.

**Top-k accuracy** — whether the correct label appears in the model's top *k*
predictions. Top-5 is the operative figure here, because the orchestrator consumes
a top-5 list.

**Vector store** — Qdrant, holding the clinical protocol collection with an
`approved` payload index. **Without that index the safety filter silently never
runs.**
