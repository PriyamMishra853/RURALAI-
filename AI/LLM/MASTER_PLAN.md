# RuralAI — AI/LLM Master Plan

Implementation plan for §3.1, §3.5, §3.6 and §3.9. Written to be executed in
order; each phase names its files, its acceptance test, and what it depends on.

---

## 0. Read this first — five things that block "real data"

These are stated up front because three of them cannot be solved by writing more
code, and a plan that hides them would waste your time later.

| # | Item | Status | What is needed |
| :-- | :-- | :-- | :-- |
| 1 | **Kaggle datasets** | ✅ Done | Credentials supplied and stored in gitignored `backend/.env`. All three datasets downloaded (223 MB). Pipeline 1 is trained; see §10. |
| 2 | **Hospital bed availability** | ⛔ No real source | There is **no public real-time API** for bed/room availability at UP district hospitals. Neither Google Maps nor any open feed carries it. The HIGH-risk screen therefore shows *capacity as last recorded* with an explicit "confirm by phone" instruction and the hospital's real number — not an invented live count. Inventing a bed count on a referral screen is the single most dangerous thing this system could do. |
| 3 | **Hospital location + distance** | ✅ Solvable without a key | All 75 UP district hospitals with real coordinates ship as a data file; nearest-hospital is haversine + road-distance refinement. No Google Maps key required, so this works offline and costs nothing. A `GOOGLE_MAPS_API_KEY` is optional and only upgrades straight-line distance to live driving time. |
| 4 | **"nginx for GPU distribution"** | ⚠️ Reframed | nginx does not schedule GPUs. What you want is: nginx as the TLS/static edge, HAProxy load-balancing the API, and a worker pool for inference. Since all five pipelines call hosted APIs (Groq/Gemini) rather than local GPUs, there is **no GPU to distribute** — the thing that actually needs balancing is your 4 Groq keys. Plan §5 does that properly. |
| 5 | **mediasoup on Windows** | ⚠️ Known | Already documented: the native worker will not build on this host, so the P2P provider is active. Unchanged by this plan. |

---

## 1. Architecture

```
                    ┌──────────────────────────────┐
   Browsers ───────▶│  Vercel — React SPA (edge)   │
   (doctor +        └───────────────┬──────────────┘
    N assistants)                   │ HTTPS + WSS
                    ┌───────────────▼──────────────┐
                    │  Railway — Node API           │
                    │  (N replicas, HAProxy in      │
                    │   front, sticky on /realtime) │
                    └───┬───────────┬───────────┬───┘
                        │           │           │
              ┌─────────▼──┐  ┌─────▼─────┐  ┌──▼──────────┐
              │ Supabase   │  │ AI Router │  │ Qdrant      │
              │ Postgres   │  │ (key pool)│  │ protocols   │
              │ + Realtime │  └─────┬─────┘  └─────────────┘
              └────────────┘        │
                          ┌─────────┴─────────┐
                          │ Groq ×4 keys      │
                          │ Gemini ×1 key     │
                          └───────────────────┘
```

**Why HAProxy and not just nginx.** nginx terminates TLS and serves static
assets well. HAProxy is the better API balancer here because the WebSocket hub
(`/realtime`) needs **sticky sessions** — a doctor's notification socket and
their HTTP calls must reach the same replica or the in-memory `userSockets` map
misses them. HAProxy's `balance source` + `option http-server-close` handles
that cleanly. Config ships in `deploy/haproxy.cfg`.

**The real fix for multi-replica realtime.** Sticky sessions are a stopgap. The
correct answer is a Redis pub/sub fan-out so any replica can push to any user's
socket. Phase 6 does this; without it, "load balanced" and "realtime
notifications" are in direct conflict.

---

## 2. The five pipelines

Each lives in `AI/LLM/pipelines/`, exposes one function, and is called by the
Node backend through a thin HTTP service (`AI/LLM/service/`) so Python stays out
of the Express process.

### 2.1 Symptoms → disease  (`symptom_diagnosis.py`)

Hybrid, because neither half is sufficient alone:

```
assistant's free text
   │
   ├─▶ fuzzy match (fuzzywuzzy) → canonical symptom vocabulary
   │
   ├─▶ KNN classifier over the augmented disease-symptom dataset
   │      (~250 diseases, binary symptom vectors)
   │      → top-5 candidates with distance-derived confidence
   │
   └─▶ Groq llama-3.3-70b re-ranks the 5 against the free text,
          vitals and history, and writes the reasoning
                     │
                     ▼
        { candidates[], top_disease, confidence, reasoning, red_flags[] }
```

**Why not LLM alone.** An LLM asked "what disease is this" will name something
plausible for any input, with no notion of how well the symptom vector actually
matched. The KNN gives a real distance metric, so "we do not have a good match"
is expressible. **Why not KNN alone.** It ignores duration, vitals and history
entirely, and cannot read "chest pain since morning, worse on stairs".

The LLM may **re-rank and reject**, never introduce a disease outside the KNN
candidate set. That bound is what keeps the output traceable to the dataset.

### 2.2 Disease → medication  (`medication_recommender.py`)

Lookup, not generation. Retrieval from the medicines dataset keyed on the
disease from 2.1, then filtered through the **existing signed-formulary gate**
(`backend/src/services/formularyService.js`).

> **Safety invariant, unchanged:** no medication reaches a patient-facing screen
> unless it came from a formulary entry signed by a registered practitioner.
> The LLM never names a drug. It only formats what the rules engine selected.
> This is already enforced in the codebase and this pipeline must not weaken it.

### 2.3 Wound image → injury extent  (`wound_vision.py`)

Already built and working: `backend/src/services/visionService.js` on
`gemini-3.6-flash`. This phase only **moves the prompt into the versioned
pipeline folder** and adds an eval set, so prompt changes are reviewable.
Output already includes body region, extent, depth impression, and
`possible_conditions` capped at "moderate" confidence.

### 2.4 Report/test image → disease detection  (`report_analysis.py`)

Two stages, already partly built:
1. **Transcribe** — `ocrService.js`, multi-page, PDFs read natively.
2. **Interpret** — `labInterpretationService.js`, patterns across values.

This phase adds the third stage you asked for: map the interpreted pattern onto
the same disease vocabulary as 2.1, so a lab report and a symptom set produce
comparable candidates rather than two unrelated vocabularies.

### 2.5 Longitudinal risk detector  (`risk_detector.py`)

The only pipeline that is **not** per-visit. Runs as a nightly batch over visit
history and flags patients whose pattern over time suggests one of the ten
high-burden conditions:

```
Ischaemic heart disease · Stroke · COPD · Lower respiratory infections
Trachea/bronchus/lung cancers · Alzheimer's & other dementias
Diabetes mellitus · Kidney diseases · Tuberculosis
```

**Trigger:** ≥3 visits in 180 days **and** a recurring symptom/vital signature.
**Visibility:** `state_admin` only — never the assistant, never the patient.
A longitudinal flag is a population-health signal, not a diagnosis, and putting
"possible lung cancer" on a village terminal would be both wrong and cruel.
**Output:** a `risk_flags` row with the evidence chain, reviewed by a human.

---

## 3. The three-tier workflow

The tier is decided by the **existing rule engine** (`riskEngine.js`), which the
LLM may raise but never lower. That invariant already holds and is the reason
this is safe to build on.

### LOW — complete solution, no call

| Output | Source |
| :-- | :-- |
| First aid for the assistant | MoHFW protocol via Qdrant RAG |
| Patient details | record |
| **Medication** | signed formulary only (2.2) |
| Precautions, point-wise | protocol |
| Diet guidance (skippable) | LLM, non-clinical |

Queued for **daily doctor review** with a notification. The doctor sees it as a
batch, not an interruption.

### MEDIUM — video consultation

Everything from LOW except medication, plus **instant call scheduling
load-balanced across doctors by disease category**:

```
category = specialityFor(top_disease)      // cardiology, paediatrics, …
pool     = doctors free now, that speciality, that district
pick     = least-recently-active           // spreads load, not first-match
```

After the call ends, the doctor's review is pushed back to the **assistant's**
portal in real time — closing the loop the current build leaves open.

### HIGH — danger zone

- Full-screen red treatment, cleared only after the referral is issued.
- **Nearest district hospital** by real coordinates (75 UP districts).
- Hospital contact number, address, and **last-recorded** capacity with a
  "confirm by phone before transporting" instruction (see §0.2).
- Printable referral + bill PDF, generated instantly.
- **Nothing queued to the doctor portal** — a referral message only. The case
  closes and is reviewed offline.

---

## 4. PDF export

Every assessment gets a **Download PDF** button. Server-side render (not
`window.print()`) so the output is identical on every device and can be attached
to the record. Ships as `backend/src/services/reportPdfService.js`.

Three templates: clinical summary (all tiers), prescription (LOW/MEDIUM),
referral + bill (HIGH).

---

## 5. AI key pool and load balancing

Four Groq keys are supplied. They are a **capacity pool**, and the thing that
actually needs balancing:

```
AI/LLM/service/keyPool.js
  - round-robin across GROQ_API_KEY, Groq_API_Key1..3
  - per-key rate-limit tracking; a 429 benches that key for its cooldown
  - if every key is benched → queue, never silently degrade
```

This matters under the demo condition in §3.1: multiple assistants running
assessments simultaneously will hit a single key's rate limit almost
immediately.

---

## 6. Phases, in dependency order

| Phase | Delivers | Depends on | Acceptance |
| :-- | :-- | :-- | :-- |
| **P1** | Key pool + Python AI service + Node client | — | 4 keys round-robin under concurrent load; a benched key recovers |
| **P2** | Pipelines 1 & 2 trained | Kaggle creds (§0.1) | Held-out accuracy reported; medication still formulary-gated |
| **P3** | Tier workflow: LOW/MEDIUM/HIGH branching | P2 | Each tier produces its exact §3.6 output set |
| **P4** | HIGH danger zone + hospital data + PDF | P3 | Nearest hospital correct for all 75 districts; PDF renders |
| **P5** | Pipelines 3 & 4 moved into versioned folder + evals | — | Existing behaviour unchanged, now testable |
| **P6** | Redis fan-out for realtime; HAProxy + nginx config | — | Notification delivered with 2+ API replicas |
| **P7** | Pipeline 5 nightly batch + state-admin review screen | P2 | Flags appear only for state_admin |
| **P8** | Full UI redesign (§3.5, §3.9) | P3 | Responsive mobile/tablet/desktop; dark+light; a11y pass |
| **P9** | Full-site test sweep | all | Every route, every button, both themes, three viewports |

---

## 7. UI direction (§3.5, §3.9)

**Theme: Indian government medical, done well.** The reference points are
NHA/ABDM and MoHFW digital services — not a startup landing page. What that
means concretely:

- **Palette.** India-government navy `#0B2E5B` and saffron-adjacent accent, with
  clinical white space. Risk tiers keep their own semantic colours and are never
  reused for anything decorative — green/amber/orange/red mean exactly one thing
  in this product.
- **Typography.** One humanist sans with real Devanagari coverage (Noto Sans /
  Noto Sans Devanagari). Village-facing text must render Hindi correctly, which
  most "modern" display fonts do not.
- **Density.** Government medical is information-dense and formal. Resist the
  large-hero, low-content look — an assistant needs the whole visit on one
  screen, not scrolling through whitespace.
- **Motion.** Framer Motion, but restrained: page transitions, tier reveal, the
  danger-zone entrance. No decorative motion on clinical data. Everything
  respects `prefers-reduced-motion`.
- **3D.** Three.js on the landing page only (India telemedicine grid). Zero 3D
  inside clinical workflows — it costs battery on a rural tablet and adds
  nothing to reading a vitals table.
- **Dark mode.** Genuine dark palette, not inverted greys. Risk colours
  re-tuned for dark backgrounds so red stays alarming without vibrating.

### Tier as a visual system

| Tier | Treatment |
| :-- | :-- |
| LOW | Calm green accent, standard layout, "complete plan" card |
| MEDIUM | Amber accent, call-scheduling panel promoted to top |
| HIGH | **Danger zone** — red wash over the shell, other navigation suppressed, single forward action (issue referral), cleared only on completion |

The HIGH state deliberately removes choices. When a case is an emergency the
interface should not offer six equally-weighted options.

---

## 8. What ships where

```
AI/LLM/
  MASTER_PLAN.md          this file
  pipelines/              the five pipelines
  training/               dataset download + train + export
  data/                   hospital master data, symptom vocabulary
  eval/                   held-out sets and scoring
  service/                FastAPI app + key pool
backend/src/services/     Node clients, PDF, tier workflow
frontend/src/             redesign
deploy/                   nginx.conf, haproxy.cfg, Dockerfiles
```

---

## 9. Honest scope note

Phases P1–P9 are roughly **three to four weeks of full-time work**, not a single
session. The order above is chosen so that each phase leaves the system working
— you can stop after any phase and still have something demonstrable.

**Recommended order if the demo is near:** P1 → P3 → P4 → P8. That gives the
tiered workflow, the danger zone, and the redesigned UI — the parts an audience
sees — while P2/P5/P7 (model training and longitudinal risk) continue behind
them.

---

## 10. Build log — what is actually running

Updated as phases land. Everything below was verified on this machine, not
assumed.

### P1 ✅ Python service + Node client

```
AI/LLM/.venv              Python 3.14 · scikit-learn 1.9 · pandas 3.0 · rapidfuzz 3.14
AI/LLM/service/app.py     FastAPI on 127.0.0.1:8001
backend/.../aiInferenceClient.js   fail-soft client with a 30s circuit breaker
start-dev.sh              starts all three services and reports each one
```

The client fails soft on purpose: if the service is down the clinical pipeline
still runs on the rules engine and the LLM, and the assessment says candidates
were unavailable. What it must never do is substitute a guess.

### P2 ✅ Pipelines 1 and 2

**Datasets downloaded** (gitignored, re-fetch with `training/download.py`):

| Dataset | Rows | Use |
| :-- | --: | :-- |
| `dhivyeshrk/diseases-and-symptoms-dataset` | 246,945 × 378 | pipeline 1 training |
| `choongqianzheng/disease-and-symptoms-dataset` | 41 | precautions |
| `shudhanshusingh/az-medicine-dataset-of-india` | 253,973 | medicine index |

**Pipeline 1 — symptoms → disease. Trained, measured on 48,988 held-out cases:**

| Model | top-1 | top-3 | top-5 |
| :-- | --: | --: | --: |
| Bernoulli NB *(selected)* | 0.854 | 0.952 | 0.974 |
| Centroid cosine baseline | 0.844 | — | 0.978 |

582 of 773 disease labels kept (≥30 examples each). The other 191 were dropped:
a class seen once cannot be learned or evaluated, and keeping it inflates
apparent coverage while producing predictions nobody should trust.

Two engineering notes, because both cost real time:
- The 190 MB matrix is 1.4% non-zero. Dense `int8` → CSR was necessary; the
  dense path asked for 564 MB inside scikit-learn's internals.
- `fit()` builds a dense one-hot label matrix — 582 classes × 196k rows = 870 MB.
  `partial_fit` in 15k chunks produces the same model within the memory budget.

**Pipeline 2 — reframed, and this matters.**

The Kaggle medicines dataset has **no disease, indication or condition column**.
It maps *brand → composition*. Nothing in it could teach "which drug treats this
disease", and that is the right outcome — a drug-choice model trained on an
uncurated retail catalogue would be unsafe to put in front of a patient.

So the split follows the line safety already draws:

```
disease  -> molecule   backend/src/data/formulary.js   clinician-signed, LLM never touches it
molecule -> product    AI/LLM/data/models/medicine_index.json   availability + real prices
```

The index answers a question the formulary cannot: *the formulary chose
paracetamol 500 mg — what can this patient actually buy, and for how much.*
2,503 paracetamol products across 40 strengths; 500 mg ranges ₹2.50–₹15.

### Symptom matching — four iterations, and why

The fuzzy matcher was wrong three times before it was right, each failure caught
by testing real clinical phrasing rather than the happy path:

| | Approach | Failure |
| :-- | :-- | :-- |
| v1 | rapidfuzz WRatio | `"body ache"` → *foreign body sensation in eye*; `"itchy rash"` → *itchy ear(s)* → ear diagnoses for a skin case |
| v2 | + Jaccard, top-2 per fragment | **Invented symptoms.** `"vomiting"` also emitted *vomiting blood*; `"no urine"` emitted *pus in urine*. Pushed a dehydration case to 70% *hyperemesis gravidarum* |
| v3 | containment, strict top-1 | Long sentences diluted the score — `"itchy rash spreading on both forearms"` matched nothing |
| v4 | + sub-span windows, body-site penalty, deterministic tie-break | current |

The v4 tie-break exists because **five terms scored exactly 70.0** and `windows`
was a `set` — so Python's per-process hash randomisation decided the winner. The
same patient text returned *skin rash* on one run and *itchy ear(s)* on the next.
Non-determinism in a clinical matcher is not a rough edge; it means the record
cannot be reproduced.

`AI/LLM/eval/test_symptom_matching.py` — **10/10 passing.** The negative cases
matter more than the positive ones: a missed match is recoverable by re-wording,
a fabricated red flag silently corrupts the whole assessment.

### Verified end to end

```
"sharp chest pain, shortness of breath, sweating"  +  SpO2 93, pulse 112, BP 146/94

  model      mitral valve disease 46% | angina 18% | pulmonary embolism 17% | heart attack 17%
  assessment HIGH risk, groq:openai/gpt-oss-120b
```

The candidates are attached to the response as `disease_candidates`, labelled
and separate from the LLM's prose. The system prompt forbids naming a diagnosis,
so without this a doctor could not see what the trained model contributed —
which would break the product's core separation between AI assistance and the
doctor's decision.

### Still to build

P3 (tier workflow) · P4 (danger zone + hospital routing + PDF) · P5 (vision
pipelines into versioned folders) · P6 (Redis fan-out, HAProxy) · P7 (pipeline 5,
longitudinal risk) · P9 (full-site test sweep).

P8 (UI redesign) is done — see the landing page, design tokens and `AppShell`.
