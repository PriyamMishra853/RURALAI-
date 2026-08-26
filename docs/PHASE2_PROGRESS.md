# Phase 2 — Build Progress

Implementation log against [`PHASE1_PRODUCTION_READINESS_PLAN.md`](PHASE1_PRODUCTION_READINESS_PLAN.md).

**Approach:** alter the existing codebase in place. The hackathon `backend/` +
`frontend/` layout is kept; the `RuralAI/`-style scaffold described in the
Phase 2 brief is **not** being created, per the owner's instruction on
2026-08-26. The frontend visual design — palette, spacing, component styling —
is off-limits unless a change is explicitly requested.

**Patient identity:** the codebase never stored Aadhaar. `patients.abha_number`
is optional and stays. No further action needed on §0.3.

---

## Batch 1 — Triage safety core ✅

Plan §D.6. The rule engine already overrode the LLM's tier, but three
invariants were not held.

| Defect | Was | Now |
|---|---|---|
| **Missing data did not escalate** | A visit with no vitals recorded returned **LOW**, with the reasoning "Vitals within standard physiological ranges" — a statement about readings nobody took | Each absent core vital is named, and the tier is floored at **MEDIUM**. LOW now requires SpO₂, temperature, blood pressure, pulse and age all present and in range |
| **A reading of `0` was treated as absent** | `if (spo2 && spo2 < 90)` — an SpO₂ of 0 from a device fault or a peri-arrest patient skipped every red-flag check | `toNumber()` distinguishes absent from zero. `0` triggers immediate referral |
| **Celsius was read as Fahrenheit** | Every threshold is °F. A recorded `39` (°C, a real fever) read as 39 °F and cleared every threshold → **LOW** | Readings below 45 are converted, and the conversion is surfaced in the warnings |
| **Degraded AI did not fail safe** | A Groq outage, timeout or off-schema response kept whatever the rules produced, including LOW | Any degraded path floors the tier at **MEDIUM** and sets `degraded: true` |
| **The model could not raise the tier** | The LLM's `risk_level` was discarded entirely | `final = MAX(rule, vision, model)`. The model may raise and can never lower |

Also added: age-banded IMNCI rule — any fever in an infant under 2 months is an
immediate referral.

**Verification:** 47 tests, all passing. `backend/tests/riskEngine.test.js` is
the golden case suite from §D.7 — treat it as the specification and add a case
before changing any threshold.

```bash
cd backend && npm test
```

## Batch 2 — Authentication and transport security ✅

| Defect | Detail |
|---|---|
| **Public privilege escalation** 🚨 | `POST /api/auth/register` was unauthenticated and accepted a client-supplied `role`. A public `/register` page in the frontend exposed it with a role dropdown. Anyone who could reach the site could issue themselves an **ADMIN** account. Removed at both ends; `POST /api/admin/users` (already admin-gated) is the only provisioning path — plan §C.3 |
| **Forgeable tokens** 🚨 | `JWT_SECRET` fell back to a hardcoded literal, and a second known value sits in the public README. Either signs a token claiming any role. Production now refuses to start on a missing, short, or known-leaked secret; development generates a random one per boot |
| **`cors({ origin: '*' })`** | Any website could drive the API through a signed-in user's browser. Now an allowlist via `CORS_ALLOWED_ORIGINS`, required in production |
| **No rate limiting** | Login was unlimited. Added limiters for login, patient lookup, AI calls and a global ceiling |
| **Unbounded uploads** | `multer.memoryStorage()` with no limit buffers an arbitrary file in heap. Capped at 10 MB / 10 files |
| **50 MB JSON bodies** | Uploads are multipart, so JSON bodies are small. Reduced to 1 MB |
| **Error detail leaked** | 5xx responses returned `err.message`, which carries table names and upstream provider detail. Suppressed in production, still logged in full |
| **No `trust proxy`** | Behind a load balancer every request shared one rate-limit bucket |

**Verification:** `POST /api/auth/register` → 404. Health → 200. Frontend
builds clean with no dangling references.

## Batch 3 — Admin clinical lockout ✅

Plan §C.2. `ADMIN` was permitted on every clinical route: patients, visits,
documents, AI assessment, doctor queue and case views. Verified first that
`AdminDashboard.jsx` only ever calls `/admin/*`, so nothing in the product
depended on it.

- `ADMIN` removed from every clinical route. It keeps `/doctor/directory`,
  which is a staff roster, not clinical data.
- Added `denyAdminClinicalAccess`, mounted on the whole clinical router rather
  than per-route. A route added later that forgets its own role list still
  fails closed. This is defence in depth, **not** a substitute for the RLS
  policies that are still outstanding.

## Batch 4 — Formulary rules engine ✅

Plan §D.2, the largest clinical gap in the build. Medication was previously
authored by the LLM prompt plus a hardcoded paracetamol/ORS list in
`aiOrchestrator.js`.

- `src/data/formulary.js` — 5 OTC entries (ORS, paracetamol, zinc, saline nasal
  drops, povidone-iodine), every one stamped `UNSIGNED_PLACEHOLDER`, each
  carrying dose bands by age, contraindications, allergy keys, pregnancy
  safety, red-flag exclusions and a source reference.
- `src/services/formularyService.js` — eight sequential gates: tier, signature,
  red flags, contraindications, allergies, pregnancy, age band, weight. An
  empty result is a valid answer and callers must render it as "no medication",
  never fall back to something else.
- The model is now instructed never to name a medicine, and
  `supportive_medication_guidance` is **deleted and overwritten** after the LLM
  returns rather than merged — a model that ignores its instructions still
  cannot reach a health worker with a dose.
- Persistence rebuilt from the structured output so `rule_source_id` travels
  with each record. `assertRuleSourced()` throws rather than storing an orphan.
- `database/migrations/001_medication_rule_source.sql` adds the real database
  constraint. **Not yet applied** — needs a reachable database.

Two behaviours worth knowing before the demo:

1. **Unsigned entries are suppressed entirely when `REQUIRE_SIGNED_FORMULARY`
   is on, which is the default in production.** A production deployment emits
   no medication at all until a clinician signs the formulary. Set it to
   `false` to demo the mechanism against placeholder data, where every line is
   prefixed with an unsigned warning.
2. **Unknown age suppresses medication** rather than defaulting to an adult
   dose. Guessing an adult dose for a child is how a paediatric overdose
   happens.

---

## Batch 5 — Live credentials wired ✅

Credentials supplied 2026-08-26. They arrived in `.env.example`, which is
tracked by git, so they were moved to `backend/.env` (gitignored, verified with
`git check-ignore`) and the template was restored to placeholders before any
commit. **Nothing leaked into git.**

`npm run check` added — a live connectivity script, deliberately outside the
Jest suite so CI stays free and deterministic. Current state:

| Service | Status |
|---|---|
| Supabase Auth | ✅ reachable |
| Supabase schema | ❌ **0 of 28 tables exist — the project is empty** |
| Groq (assessment + Whisper) | ✅ 14 models |
| Gemini (wound vision) | ✅ 50 models |
| Qdrant (protocol corpus) | ❌ HTTP 404 — the hackathon cluster is gone |
| LiveKit | ✅ endpoint reachable |

Two findings worth recording:

1. **The check script initially reported the empty database as healthy.** A
   Supabase `select('*', { head: true, count: 'exact' })` against a table that
   does not exist returns **no error**. Replaced with a real row select. Do not
   simplify it back — the comment in the script says so too.
2. **Migration 001 had a live loophole.** Its grandfather clause exempted rows
   created before a cutoff date, which on a fresh database exempts everything
   inserted today. Removed; the constraint is now unconditional.

`database/apply_all.sql` combines the schema and migration 001 into one file to
paste into the Supabase SQL Editor.

Qdrant being down is not blocking: `ragEngine.js` already falls back to the
Supabase-hosted `clinical_protocols` tables, which the schema defines.

---

## Batch 6 — Every pipeline exercised against live providers ✅

`npm run check:pipelines` pushes real input through each pipeline and inspects
the output — separate from `npm run check`, which only proves reachability.

| Pipeline | Status |
|---|---|
| Triage rule engine | ✅ empty→MEDIUM, SpO₂ 0→HIGH + referral |
| Formulary rules engine | ✅ HIGH→0 meds, LOW→1, all rule-sourced |
| RAG protocol retrieval | ❌ 0 protocols — needs the database |
| Assessment (Groq) | ✅ `groq:openai/gpt-oss-120b` |
| OCR (Tesseract) | ✅ plumbing verified on a synthetic fixture |
| Vision (Gemini) | ✅ correctly refused a featureless image, floored at MEDIUM |
| Speech (Whisper) | ✅ silence correctly rejected |

### Three real bugs this found

**1. The assessment model was decommissioned. 🚨**
`llama-3.3-70b-versatile` no longer exists at Groq — every call returned 404 and
each service silently fell back to its non-AI path. The model name was hardcoded
in three separate files, so nothing failed loudly. Now centralised in
`config/models.js` (env-overridable), running `openai/gpt-oss-120b`, and
`npm run check` verifies each configured model still exists at its provider.

`ai.controller.js` also string-matched the dead model name to decide
`model_provider`, so every assessment was being recorded as `RuleEngine`.

Worth noting: the degraded-fails-safe rule from Batch 1 caught this in the
wild. With the model dead the pipeline returned MEDIUM rather than LOW.

**2. The speech service fabricated clinical data in three places. 🚨**
`speechService.js` substituted a fixed Hindi sentence — *"patient has high
fever, dry cough and body pain for 3 days"* — whenever transcription produced
nothing, defaulted `extracted_symptoms` to fever + cough + body pain, and
returned those same invented symptoms from its outer catch.

"fever" plus "cough" is a MEDIUM-tier rule in `riskEngine.js`, so **a silent or
failed recording could produce a fully triaged case describing a patient who
does not exist.** Rewritten: nothing is invented, and an unusable recording
returns `ok: false` with a reason the assistant sees.

**3. Whisper hallucinates on silence.**
One second of digital silence transcribed as `"www.pengali.com"`, then
`"Thank you."` on a later run — with `no_speech_prob: 0`, i.e. fully confident
in speech that does not exist. `no_speech_prob` is therefore unusable here. The
reliable signal is structural: Whisper pads short audio to a 30-second window
and labels the whole window when hallucinating, so a segment ending far past the
reported duration is the artifact. Genuine one-second speech ends at about one
second, so real short utterances survive.

### Not bugs, checked and cleared

- **OCR** reads `"FHRHCE THMOL SEE MiG"` from the test fixture. That is the
  fixture's fault, not the pipeline's — it is a hand-drawn 5×7 bitmap font,
  since sharp's native binary will not install on this machine. The pipeline
  produces text and structured output correctly. Real accuracy still needs real
  document samples (§J.3 #8).
- **Vision** returned `analysis_possible=false, engine=none` for a featureless
  image — it correctly declined to score it and floored at MEDIUM, which is the
  intended fail-safe.

---

## Known gaps

| Gap | Detail |
|---|---|
| **Rate limit store is in-memory** | Per-process, so behind N instances the real limit is N×. Needs a shared Redis store — plan §A.4. Blocked on a Redis URL |
| **Helmet CSP disabled** | The default policy blocks the SPA's own bundle. Needs a real per-directive policy, not left off |
| **Access control is app-layer only** | There are no RLS policies yet. Every check lives in `authorizeRoles`, so one missing guard is a breach. Plan §B.5 |
| **Formulary is unsigned** | The mechanism is built and enforced, but every entry is `UNSIGNED_PLACEHOLDER`. **Blocked on a registered medical practitioner, not on code** — plan §J.5 #15 |
| **Database has no schema** 🚨 | 0 of 28 tables exist, and 0 auth users had existed. Run `database/apply_all.sql` in the Supabase SQL Editor, then `npm run seed:staff`. This blocks login, RAG retrieval, and every clinical route |
| **Qdrant cluster dead** | The URL in the public README 404s. RAG falls back to Supabase protocol tables, which need seeding |
| **Video still on ZegoCloud** | LiveKit credentials are configured and reachable, but the video path still runs on ZegoCloud plus the custom WebRTC signaling service. Plan §E.2 recommends LiveKit; migrating is a separate, unmade decision |
| **LOW-tier dispensing policy undecided** | Plan §D.2 flags the conflict with the NMC Telemedicine Practice Guidelines 2020: may an assistant dispense before the doctor's daily review, or must approval come first? Still open |
| **Thresholds unvalidated** | NEWS2/IMNCI-derived but not reviewed for this deployment. The app carries no "not for clinical use" notice yet — plan §J.5 item 22 |
| **Leaked credentials** | `README.md` commits `ZEGOCLOUD_SERVER_SECRET` in plaintext. Rotate before any public demonstration |
