# 02 — All Dependencies

> **Navigation:** [Index](README.md) · Previous: [01 — Setup Guide](01-setup-guide.md) · Next: [03 — Data Flow](03-data-flow.md)

Every package in the three dependency trees, with the version range declared in
the manifest and the specific reason it is present. Runtime and development are
separated. Section 4 covers external hosted services and exactly what breaks
without each.

---

## 1. Backend — runtime

Declared in `backend/package.json`. `"type": "module"` — the whole backend is
ESM. `engines.node: ">=22.0.0"`.

| Package | Version | Why it is here |
|---|---|---|
| `express` | `^4.19.2` | HTTP server and router. 13 routers mounted in `src/app.js`. Express 4 rather than 5 because 5 was still release-candidate when this was written and `express-rate-limit`, `helmet` and `multer` all target 4 |
| `@supabase/supabase-js` | `^2.45.0` | Postgres access through PostgREST, Auth (password sign-in and admin user management), and Storage (the private `injury-photos` bucket). Two clients are constructed in `config/supabase.js`: `supabase` (anon, subject to RLS) and `supabaseAdmin` (service role, bypasses RLS) |
| `pg` | `^8.23.0` | Direct Postgres connection. Used **only** by the scripts that run DDL — `applyV2.js`, `seedV2.js`, `seedRootAdmin.js` — because the REST API cannot execute DDL |
| `jsonwebtoken` | `^9.0.2` | Signs and verifies the 12-hour API session token (`auth.controller.js` → `issueToken`), and the 2-hour per-user video join credential (`P2PProvider.js`, `MediasoupProvider.js`) |
| `groq-sdk` | `^0.7.0` | Groq client. Instantiated once per pooled key in `config/keyPool.js`; every call goes through `withGroq()` so rate-limit benching applies uniformly |
| `@google/generative-ai` | `^0.17.0` | **Declared but not imported by any source file.** `config/gemini.js` is a hand-written REST client using `fetch`, written that way for direct control over the fallback chain and `finishReason` handling. See [L11](16-known-limitations-and-risks.md#l11) |
| `@qdrant/js-client-rest` | `^1.11.0` | Vector search over the approved clinical protocol collection (`ragEngine.js`) and collection/payload-index creation (`seedQdrant.js`). Constructed with `checkCompatibility: false` |
| `tesseract.js` | `^5.1.0` | Local OCR fallback when Gemini declines a document. Runs in a worker; `ocrService.js` always terminates it in a `finally` block, because a leaked worker holds a thread and its own memory |
| `ws` | `^8.21.3` | The `/realtime` WebSocket server (`realtimeHub.js`), and a `globalThis.WebSocket` polyfill in `config/supabase.js` for Node runtimes older than 22 |
| `multer` | `^1.4.5-lts.1` | Multipart upload parsing. Always `memoryStorage` with an explicit `fileSize` and `files` limit — memory storage buffers the whole file in heap, so an unbounded upload is a trivial denial of service |
| `helmet` | `^8.3.0` | Security response headers. `contentSecurityPolicy` and `crossOriginEmbedderPolicy` are **disabled** because the default policy blocks the SPA's own bundle, which is served from the same origin. A real per-directive policy is an open gap — [L6](16-known-limitations-and-risks.md#l6) |
| `cors` | `^2.8.5` | Origin allowlist from `CORS_ALLOWED_ORIGINS`. Denial withholds the CORS headers rather than throwing — an error there propagates to the global handler and turns the request into a 500, which took down same-origin stylesheets the moment anything added an `Origin` header |
| `express-rate-limit` | `^8.6.2` | Four limiters: login (10 / 15 min, successful requests skipped), patient lookup (60 / 5 min), AI calls (20 / min), global (300 / min). In-memory store — a known multi-instance gap, [L5](16-known-limitations-and-risks.md#l5) |
| `pdfkit` | `^0.20.1` | Server-side PDF rendering for the three report templates. Chosen over `window.print()` for identical output on low-end Android tablets, attachability to the record, and no headless-browser dependency |
| `dotenv` | `^16.4.5` | Loads `backend/.env`. Called at the top of `config/env.js` and in every standalone script |
| `resend` | `^3.5.0` | **Declared and configured (`config.resend.apiKey`) but not imported by any source file.** Staff invitation email is not wired. See [L11](16-known-limitations-and-risks.md#l11) |
| `zod` | `^3.23.8` | **Declared but not imported by any source file.** Validation is hand-written in `services/patientFields.js` and `validateVitalsRanges`, which return field-keyed error objects the forms render inline. See [L11](16-known-limitations-and-risks.md#l11) |

### Not a dependency, but referenced

| Package | Status |
|---|---|
| `mediasoup` | `MediasoupProvider.js` imports it **dynamically** inside a `try/catch`, precisely so a missing or unbuildable native module means "this provider is not usable here" rather than a crash at startup. It is **not in `package.json`**, so `isAvailable()` always returns false and `P2PProvider` is the active provider on every host. To use the SFU: deploy on Linux, `npm install mediasoup@3`, and set `MEDIASOUP_ANNOUNCED_IP`. Tracked as [L4](16-known-limitations-and-risks.md#l4) |

---

## 2. Backend — development

| Package | Version | Why |
|---|---|---|
| `jest` | `^29.7.0` | Test runner. `jest.config.js` sets `transform: {}` — no Babel — because the backend is ESM and runs through Node's VM modules flag instead |
| `cross-env` | `^7.0.3` | Sets `NODE_OPTIONS=--experimental-vm-modules` portably. Windows `cmd` cannot use the `VAR=value cmd` prefix form, and this project is developed on Windows and deployed on Linux |

`jest.config.js` also declares
`collectCoverageFrom: ['src/services/**/*.js', 'src/middleware/**/*.js']` — the
safety-critical surface — and states in a comment that external APIs are never
called from the suite, so CI stays free, deterministic and spends no AI quota.

---

## 3. Frontend — runtime

Declared in `frontend/package.json`.

| Package | Version | Why it is here |
|---|---|---|
| `react` | `^18.3.1` | UI library |
| `react-dom` | `^18.3.1` | DOM renderer |
| `react-router-dom` | `^6.23.1` | Client routing. 10 routes in `App.jsx`, each clinical one wrapped in `RequireRole` |
| `vite` | `^5.2.11` | Build tool and dev server. Listed as a runtime dependency rather than a devDependency because the deployment build runs `npm install` without dev packages in some paths |
| `@vitejs/plugin-react` | `^4.3.0` | React Fast Refresh and JSX transform |
| `axios` | `^1.7.2` | HTTP client. One shared instance in `services/api.js` with a request interceptor that attaches the bearer token and a response interceptor that clears the session and redirects to `/login` on a 401 or a session-dead 403 |
| `@supabase/supabase-js` | `^2.112.3` | Browser-side realtime subscriptions only. `config/supabase.js` exports a **no-op client** when the project is unconfigured, because dashboards call `supabase.channel(...).on(...).subscribe()` directly and exporting `null` would white-screen them. Losing live updates is a degradation; losing the page is an outage |
| `lucide-react` | `^0.395.0` | Icon set. Tree-shakeable per-icon imports |
| `framer-motion` | `^11.2.10` | Page and tier-reveal transitions. Deliberately restrained — no decorative motion on clinical data |
| `three` | `^0.185.1` | The India district network on the public landing page (`DistrictNetwork3D.jsx`). **Zero 3D inside any clinical workflow** — it costs battery on a rural tablet and adds nothing to reading a vitals table. The component handles resize, honours `prefers-reduced-motion`, stops rendering on tab hide, and fully disposes GPU resources on unmount |
| `clsx` | `^2.1.1` | Conditional class-name composition |
| `tailwind-merge` | `^2.3.0` | Resolves conflicting Tailwind classes. Combined with `clsx` into a single `cn()` helper in `components/ui/index.jsx`, so a variant class can be overridden by a caller without specificity fights |

---

## 4. Frontend — development

| Package | Version | Why |
|---|---|---|
| `tailwindcss` | `^3.4.4` | Utility CSS. `tailwind.config.js` defines the design tokens: `gov-*` navy scale, `tier-*` semantic risk colours, `ink-*` text scale, `surface-*` and `line` |
| `postcss` | `^8.4.38` | Tailwind's build pipeline |
| `autoprefixer` | `^10.4.19` | Vendor prefixes for the Android browsers a sub-centre tablet actually runs |
| `@types/react` | `^18.3.3` | Editor type hints. The project is plain JavaScript, not TypeScript |
| `@types/react-dom` | `^18.3.0` | Same |

`allowScripts: { "esbuild@0.21.5": true }` narrows postinstall script execution
to the one package that genuinely needs it.

---

## 5. Python inference service

Declared in `AI/LLM/requirements.txt`. **Ranges, not exact pins** — and the file
says why: the versions were originally pinned to a development machine's freeze
output and the deploy failed resolving them, because a wheel that exists for one
Python build is not guaranteed for the container's.

| Package | Range | Why it is here |
|---|---|---|
| `fastapi` | `>=0.110,<1` | The four inference endpoints in `service/app.py`. Pydantic request models give validated, typed input with no hand-written parsing |
| `uvicorn[standard]` | `>=0.29,<1` | ASGI server. Bound to `127.0.0.1:8001` by `start.sh` — the service has no authentication of its own, and inside one container "only the backend can reach it" is literally true |
| `pydantic` | `>=2.6,<3` | `DiagnoseRequest` and `MedicineRequest`, with field bounds (`top_k` 1–10, `age_years` 0–130, `min_confidence` 0–1) enforced at the boundary |
| `numpy` | `>=1.26,<3` | Symptom vectorisation (`vectorise()`) and posterior ranking (`np.argsort`) |
| `joblib` | `>=1.3,<2` | Loads the committed `symptom_nb.joblib` estimator |
| `scikit-learn` | `>=1.5,<2` | **Not imported by `app.py` by name**, but required at runtime: `joblib.load` reconstructs the `BernoulliNB` estimator, which pulls it in. Held to a narrow range because the committed artifact is unpickled by it. If it ever fails to load, that is visible rather than silent — `/health` reports `symptom_diagnosis: false` and the backend's `/api/ai/service-status` repeats it |
| `scipy` | `>=1.11,<2` | Same category — a transitive runtime requirement of the unpickled estimator, not a named import |
| `RapidFuzz` | `>=3.6,<4` | Two distinct uses: `fuzz.token_set_ratio` inside the composite `score_candidate()` symptom matcher, and `fuzz_process.extractOne(..., score_cutoff=80)` for precaution lookup by disease name |

Training-only packages (`pandas`, `kaggle`) are deliberately **not** in
`requirements.txt`. The model artifacts are committed, so a deploy needs neither
a training step nor a dataset download, and the runtime image stays smaller.

### Training-only, installed manually

| Package | Used by |
|---|---|
| `pandas` | `train_symptom_diagnosis.py`, `build_medicine_index.py`, `inspect_datasets.py`, `probe_medicines.py` |
| `kaggle` | `download.py`, `check_kaggle.py` |
| `pytest` | `AI/LLM/eval/test_symptom_matching.py` |

---

## 6. External hosted services

What each provides, and **exactly what breaks without it**. This matters because
the system's degradation behaviour is deliberate and specific.

| Service | Provides | Without it |
|---|---|---|
| **Supabase — Postgres** | Every table | **Total outage.** `env.js` refuses to start in production without `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, deliberately: a missing key otherwise means every patient write fails at runtime rather than at boot |
| **Supabase — Auth** | Password storage and verification | Nobody can sign in. The platform holds no password hashes itself |
| **Supabase — Storage** | The private `injury-photos` bucket | Wound photographs are analysed and displayed once, then lost. `ai.controller.js` logs `injury-photos upload FAILED — the doctor will not see this photo` at `error` level rather than `warn`, because a previous `warn` hid this for the lifetime of the feature |
| **Groq** | `openai/gpt-oss-120b` assessment synthesis; `whisper-large-v3-turbo` speech | Speech returns `ok: false` with a reason and an empty transcript — never a substitute. Assessment falls back to the rule engine, sets `degraded: true`, and **floors a LOW case at MEDIUM** with the explicit warning that the case was not assessed by the model |
| **Google Gemini** | Wound vision, document OCR, health-card reading | Vision returns `analysis_possible: false` and the photo is flagged for direct doctor review — no findings are invented. OCR falls back to Tesseract + Groq. Health-card scanning returns a 502 with "Enter the details by hand" |
| **Qdrant Cloud** | Approved clinical protocol vector store | `retrieveClinicalProtocols()` returns `[]`. The assessment prompt renders `- None retrieved`, and `first_aid_steps` falls back to five generic protocol steps hard-coded in `aiOrchestrator.js`. **Note:** the Supabase fallback path in `ragEngine.js` queries `clinical_protocols`, a v1 table that v2 does not create — so Qdrant is effectively the only retrieval source. [L2](16-known-limitations-and-risks.md#l2) |
| **The Python inference service** | Ranked disease candidates, precautions, medicine availability | `aiInferenceClient.js` returns `null`, which callers treat as *"no candidates"* and **never** as *"no disease"*. The assessment states this explicitly: *"Absence of candidates is not evidence of good health."* A 30-second circuit breaker stops a down service turning a degraded feature into a slow page |
| **A TURN provider** | WebRTC relay across NAT | Falls back to Metered's free public Open Relay with a one-time warning. Same-network calls work on STUN alone. Cross-network calls without any relay negotiate and then carry no media — a frozen black screen, not an error |
| **Resend** | Staff invitation email | Nothing — the integration is declared but not wired |
| **Kaggle** | Training dataset download | Nothing at runtime. Artifacts are committed |
| **Google Maps** | Driving distance for referrals | Straight-line haversine distance is computed **first** and stands. `distance_source` reports which was used. Entirely optional by design: a referral must not fail because a billing quota was exceeded |

---

## 7. Dependency posture

Four deliberate positions, each with a cost the project accepts:

**Small runtime tree.** Seventeen backend runtime packages for a platform with
59 endpoints, a WebRTC signalling layer, OCR, PDF generation and vector search.
Validation, the risk engine, the formulary engine, the scheduling engine, the
key pool and the video abstraction are all hand-written. The cost is more code to
maintain; the benefit is that the clinically-critical logic has no upstream that
can change under it.

**Model ids are configuration, not code.** Every model identifier lives in
`config/models.js`, overridable by environment. When Groq decommissioned
`llama-3.3-70b-versatile`, three separate hardcoded call sites started returning
404 and each service quietly fell back to its non-AI path — the assessment
pipeline ran for an unknown period with no model in it at all.
`verifyModelsAvailable()` now turns a decommission into a red line in
`npm run check` instead of silence, and it confirms Gemini with a **real
`generateContent` call with an image**, not a `/models` listing, because
`gemini-2.5-flash` was listed for months after it started returning 404 to new
keys.

**No hosted video SDK.** ZegoCloud and LiveKit were both evaluated and both
removed (`docs/PHASE2_PROGRESS.md` Batch 9). The cost is owning ICE, perfect
negotiation and reconnection logic. The benefit is no per-minute fee, no vendor
credential in the bundle, and consultation media that never traverses a third
party.

**Degradation is designed, not incidental.** Every external dependency has a
defined failure behaviour written into the code, and none of them is *"return
something plausible"*. The rule is stated in `speechService.js` and
`ocrService.js` in almost the same words: an empty result is a valid, safe
answer, and a fabricated one is not.
