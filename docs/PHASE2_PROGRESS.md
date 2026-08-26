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

## Batch 7 — RAG restored, and the safety filter that never ran ✅

New Qdrant cluster supplied. It was set as `QDRANT_CLUSTER_ENDPOINT` while
`QDRANT_URL` still held the decommissioned cluster, so config now prefers the
former and falls back to the latter.

**Two bugs behind the empty retrieval:**

1. **The `approved = true` filter has never worked. 🚨** Qdrant refuses to
   filter on a payload field with no index: `400 Index required but not found
   for "approved"`. That threw inside the vector-search block, which was caught
   and silently fell through to the keyword store — so the filter restricting
   retrieval to approved protocols (plan §D.1) was never applied. The seed
   script now creates the payload index.
2. **The query never asked for the payload.** Points came back as bare ids and
   scores, so every protocol rendered with the generic default title and empty
   content — the model was being handed nothing. Added `with_payload: true`.

Also removed a **hardcoded Qdrant cluster URL and API key** that sat as
defaults in `seedQdrant.js`, in a public repository.

**All 7 pipelines now pass**, 87 tests green.

---

## Batch 8 — Database live, full flow verified end to end ✅

Schema applied via the SQL Editor. All 28 tables present, migration 001 landed.

- **Staff accounts provisioned.** 7 demo accounts plus an admin. The admin
  password was generated locally into `backend/.env` as `SEED_ADMIN_PASSWORD`
  and never had a default.
- **`npm run check:flow`** drives the real HTTP API the way the frontend does
  and asserts the safety invariants on the way through.

```
✓ Login — all three roles                    assistant + doctor + admin
✓ Unauthenticated request is rejected        401
✓ Admin is blocked from clinical routes      2 routes → 403
✓ Assistant registers a patient
✓ Assistant opens a visit with vitals
✓ AI assessment runs and persists            tier=MEDIUM via groq:openai/gpt-oss-120b
✓ Assessment cites retrieved protocols
✓ Every medication carries a formulary rule id
✓ Doctor can see the case in their queue
✓ Database rejects medication with no rule source   23514 check_violation
```

### Three more bugs found while verifying

**1. My own CORS handler broke every static asset. 🚨**
Rejecting a disallowed origin by `callback(new Error(...))` sends that error to
the global handler, which returns **500 with `application/json`** — so
stylesheets and scripts failed with a MIME-type error the moment anything
attached an `Origin` header. A rejected origin must be denied by *withholding*
the CORS headers, not by throwing; the browser is what enforces it. The
allowlist also now includes the API's own origin, since it serves the frontend.

**2. The frontend pointed at the decommissioned hackathon project.**
`frontend/src/config/supabase.js` hardcoded `ucivhqksbbwhdwetrkbd.supabase.co`
with a literal `"dummy"` anon key as fallbacks, and there was no `frontend/.env`
at all — so those fallbacks were what shipped. Every page load opened realtime
WebSockets to a dead host in a retry loop. **Realtime has never worked.** Now
configured from `frontend/.env`, with no fallbacks.

**3. A null client would have white-screened the dashboards.**
Three pages call `supabase.channel(...)` directly. Removing the fallbacks made
the export null when unconfigured, which turns a missing `.env` into a blank
page. Exports a no-op channel shim instead — losing live updates is a
degradation, losing the page is an outage.

### And one false pass in my own test

The constraint probe reported success on error `23502` — `not_null_violation`.
The insert was dying on a NOT NULL column before ever reaching the medication
CHECK, so it proved nothing. Now it attaches a real assessment id, requires
`23514 check_violation` specifically, and additionally confirms a properly
sourced row *is* accepted.

That is the second false-positive check I have written and caught. Both had the
same shape: an assertion that passes when the thing it tests never runs.

---

## Batch 9 — Video evaluation: Zego vs LiveKit vs custom WebRTC

Isolated 1:1 call harness at `frontend/public/video-lab.html`
(`?impl=webrtc|livekit&role=a|b&room=…`), driven from two browser tabs.

Media is **synthetic** — a canvas video track plus an oscillator audio track —
so the test needs no camera or microphone permission and feeds every
implementation byte-identical input. Real devices would make the comparison
depend on hardware rather than on the SDK.

### Results

| | Connects | Remote A/V | Console errors | Survives refresh |
|---|---|---|---|---|
| **ZegoCloud** | Room join only | ❌ **unprovable** | 0 | not reached |
| **LiveKit** | ✅ both directions | ✅ live audio + video | 0 (1 transient warning) | ✅ |
| **Custom WebRTC** | ✅ both directions | ✅ live audio + video | 0 errors, 0 warnings | ✅ |

### ZegoCloud — removed

Rejected on four counts, none of which needed a media test:

1. **Already dead code.** `VideoConsultationModal.jsx` was imported by nothing.
   All four call sites use `WebRTCVideoCallModal`.
2. **Requires the server secret in the browser.**
   `ZegoUIKitPrebuilt.generateKitTokenForTest` takes the app ID *and the server
   secret* client-side. Anyone loading the page could mint tokens for any room
   on the account. This is what `generateKitTokenForTest` is named for.
3. **Those credentials are published** in `README.md` and have never been
   rotated — app ID `1586356449`.
4. **Not testable.** The prebuilt UIKit insists on real capture devices and
   will not accept synthetic tracks, so its media path cannot be exercised in
   CI or in any headless environment. It joined the room and reported the peer,
   but no media was ever proven to flow.

Removed: the component, the `@zegocloud/zego-uikit-prebuilt` dependency, the
config block, the `.env.example` vars and the dev-only `/api/calls/zego-config`
endpoint. Verified: 0 occurrences in the built bundle, endpoint returns 404.

### What the WebRTC result does NOT prove

Both tabs ran on one machine. `getStats()` reports the nominated candidate pair
as **`host` ↔ `host` over UDP** — 147 KB received, so real media flowed, but
**no NAT traversal was exercised at all**. Across two networks, peer-to-peer
WebRTC commonly needs TURN, and no TURN server is configured (`VITE_TURN_URL`
is read but unset). That risk is invisible in this test and is exactly the
condition a venue network imposes.

### Harness bugs found and fixed (mine, not the app's)

- Read `msg.offer`/`msg.answer`; the wire field is `sdp`. The app was right.
- Both peers offered on `peer-joined`. The server already elects exactly one
  initiator (the second joiner) to prevent glare — the app respects it.
- Applied ICE candidates before the remote description existed. The real modal
  buffers them; the harness now does too.

The signaling service and `WebRTCVideoCallModal` were correct on all three.

### Decision: custom WebRTC kept, LiveKit removed

Both passed, so the stated rule did not separate them. Decided on:

- It is **already integrated** in all four call sites; LiveKit was wired
  nowhere, so choosing it meant rewriting the call flow before a demo.
- It scored **0 errors and 0 warnings**; LiveKit had one transient
  "subscribed quality update for unknown track".
- No SDK in the runtime path, no per-minute cost, and no third party carrying
  patient video.

Removed: `videoToken.controller.js`, the token route, the `livekit-server-sdk`
dependency, the config block, the `.env.example` vars, the service check, and
the LiveKit branch of the harness. `LIVEKIT_*` values were left in the local
`.env` — inert now, and not this tool's file to edit.

`npm run check` gained a **signaling ping/pong probe** in LiveKit's place, since
`/signal` is now the piece a call cannot happen without.

### 🚨 The open risk this decision carries

**No TURN server is configured.** STUN alone works when both parties can reach
each other directly, which is why the loopback test passed. It is not enough
across carrier-grade NAT, most mobile networks, or restrictive venue wifi —
there the call negotiates and then carries no media, which looks like a frozen
black screen rather than an error.

`VITE_TURN_URL` / `VITE_TURN_USERNAME` / `VITE_TURN_CREDENTIAL` are read by
`WebRTCVideoCallModal` and are documented in `frontend/.env.example`. A TURN
credential is needed before any demo spanning two networks. `npm run check`
now reports its absence as a warning rather than staying silent.

---

## Known gaps

| Gap | Detail |
|---|---|
| **Rate limit store is in-memory** | Per-process, so behind N instances the real limit is N×. Needs a shared Redis store — plan §A.4. Blocked on a Redis URL |
| **Helmet CSP disabled** | The default policy blocks the SPA's own bundle. Needs a real per-directive policy, not left off |
| **Access control is app-layer only** | There are no RLS policies yet. Every check lives in `authorizeRoles`, so one missing guard is a breach. Plan §B.5 |
| **Formulary is unsigned** | The mechanism is built and enforced, but every entry is `UNSIGNED_PLACEHOLDER`. **Blocked on a registered medical practitioner, not on code** — plan §J.5 #15 |

| **Only 3 protocols seeded** | The corpus holds 3 demo protocols from `seedQdrant.js`. A real MoHFW STG corpus, physician-reviewed, is still needed — plan §D.1 and §J.5 #17 |
| **Video still on ZegoCloud** | LiveKit credentials are configured and reachable, but the video path still runs on ZegoCloud plus the custom WebRTC signaling service. Plan §E.2 recommends LiveKit; migrating is a separate, unmade decision |
| **LOW-tier dispensing policy undecided** | Plan §D.2 flags the conflict with the NMC Telemedicine Practice Guidelines 2020: may an assistant dispense before the doctor's daily review, or must approval come first? Still open |
| **Thresholds unvalidated** | NEWS2/IMNCI-derived but not reviewed for this deployment. The app carries no "not for clinical use" notice yet — plan §J.5 item 22 |
| **Leaked credentials** | `README.md` commits `ZEGOCLOUD_SERVER_SECRET` in plaintext. Rotate before any public demonstration |
