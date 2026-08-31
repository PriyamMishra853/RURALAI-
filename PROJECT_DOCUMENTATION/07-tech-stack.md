# 07 — Tech Stack

> **Navigation:** [Index](README.md) · Previous: [06 — Database Schema](06-database-schema.md) · Next: [08 — Security](08-security.md)

Every technology in use, the version, and the alternative it was chosen over.
This is a record of judged decisions, not an inventory. Where a choice was later
proved right or wrong by an incident, that is stated.

---

## 1. At a glance

| Layer | Choice | Version |
|---|---|---|
| Runtime | Node.js | ≥ 22 |
| Language (server) | JavaScript, ESM | ES2022 |
| HTTP framework | Express | 4.19 |
| Database | PostgreSQL via Supabase | 15+ managed |
| Auth | Supabase Auth + own JWT | — |
| Object storage | Supabase Storage | — |
| Vector store | Qdrant Cloud | client 1.11 |
| Frontend | React + Vite | 18.3 / 5.2 |
| Styling | Tailwind CSS | 3.4 |
| Realtime | `ws` — one authenticated socket | 8.21 |
| Video | Peer-to-peer WebRTC (native) | — |
| Inference service | Python + FastAPI + scikit-learn | 3.11 / 0.110 / 1.5 |
| Assessment model | Groq `openai/gpt-oss-120b` | hosted |
| Speech | Groq `whisper-large-v3-turbo` | hosted |
| Vision / OCR | Gemini `gemini-3.6-flash` + chain | hosted |
| Local OCR fallback | Tesseract.js | 5.1 |
| PDF | pdfkit | 0.20 |
| Tests | Jest (JS) + pytest (Python) | 29.7 |
| Deployment | Railway / Nixpacks | — |

---

## 2. Runtime and language

### Node.js ≥ 22, over Python or Go for the API

`backend/package.json` → `engines.node: ">=22.0.0"`.

**Alternative considered: a single Python backend.** The AI work is Python's home
turf, so putting the whole API there is the obvious unification.

**Why Node instead.** The two hardest real-time problems in this product are
WebRTC signalling and a long-lived notification socket, and Node's event loop
plus `ws` is the shortest path to both. FastAPI would need an ASGI WebSocket
layer *and* separate handling for the video signalling relay. The AI work is
isolated behind one HTTP boundary instead (`aiInferenceClient.js` → the FastAPI
service), which keeps scikit-learn out of the request path entirely and lets the
model load **once at service start** rather than per request.

Node 22 specifically because it provides a native `WebSocket` global; `ws` is
still polyfilled into `globalThis` in `config/supabase.js` for older runtimes,
because Railway's default has been Node 20.

### ESM over CommonJS

`"type": "module"` throughout. The cost is real: Jest needs
`NODE_OPTIONS=--experimental-vm-modules` and `cross-env` to set it portably. The
benefit is `import`/`export` matching the frontend, and top-level `await` — which
`checkServices.js` uses to run eight live probes sequentially without a wrapper
function.

### JavaScript over TypeScript

**The honest reason:** speed of iteration against a hackathon deadline, with the
type-safety budget spent instead on runtime validation where it actually protects
a patient — `patientFields.js`, `validateVitalsRanges()`,
`validateHealthCardFields()`, `normaliseRiskTier()`, and database CHECK
constraints. A type system would not have caught any of the defects that actually
occurred: writing `medium` into an enum that has no such value, reading
`image_type` from a table without that column, or a Gemini model that was listed
but returned 404.

`@types/react` is still installed for editor hints.

---

## 3. HTTP layer

### Express 4.19, over Fastify or Express 5

**Alternative: Fastify** — genuinely faster, with schema-based validation built
in.

**Why Express.** Every middleware this project needs — `helmet`, `cors`,
`express-rate-limit`, `multer` — targets Express 4 first. The security posture
depends on those four being correct and well-trodden, and being an early adopter
of a plugin port is the wrong risk to take on the layer that enforces
authentication. Throughput is not the constraint here: a sub-centre generates
tens of requests per minute, and the expensive work happens at hosted model
providers.

**Why not Express 5.** It was still release-candidate when this was written.

### `multer` with `memoryStorage`, always with limits

**Alternative: `diskStorage`**, which avoids buffering the file in heap.

**Why memory.** Every uploaded file is immediately base64-encoded and sent to a
model provider, or handed to a Tesseract worker. Writing it to disk first only to
read it back adds latency and leaves clinical images in a container filesystem
that nothing cleans up.

**The cost, handled explicitly.** Memory storage means an unbounded upload is a
trivial denial of service, so every `multer` instance declares
`limits: { fileSize, files }` — 10 MB × 10 on the AI routes, 15 MB × 10 on
documents. `document.routes.js` additionally wraps `upload.any()` so a
`LIMIT_FILE_SIZE` error becomes *"A file is larger than 15 MB. Photograph the
page again at a lower resolution."* rather than a stack trace.

### Hand-written validation, over `zod` or `joi`

`zod` is in `package.json` and **is not imported anywhere**. Validation lives in
`services/patientFields.js` and `validateVitalsRanges()`.

**Why.** These validators do not just accept or reject — they return a
**field-keyed error object** that the form renders next to each individual input,
and they perform derivation (`ageFromDob`, `ageDisplay`, `digitsOnly`) and
cross-field checks (diastolic must be below systolic) in the same pass. Building
that shape on top of a schema library is more code than writing it directly, and
`patientFields.js` is deliberately mirrored by
`frontend/src/config/patientFields.js` so the form validates as the user types.

The `zod` dependency should be removed — [L11](16-known-limitations-and-risks.md#l11).

---

## 4. Data layer

### Supabase (managed PostgreSQL), over self-hosted Postgres or Firebase

**Alternative: Firebase / Firestore.** Rejected outright. This data is
relational and the integrity rules are the product: a `CHECK` that a diastolic
reading is below a systolic one, a partial unique index enforcing one active
consultation per doctor, a conditional constraint that only an emergency
registration may omit a phone number. A document store cannot express any of
them, and the fallback would be enforcing them in application code — which is
exactly the layer a hostile or buggy caller bypasses.

**Alternative: self-hosted Postgres.** Rejected for scope. Supabase bundles the
three things this needs — Postgres with RLS, an auth system with password
hashing and admin user management, and object storage with signed URLs — behind
one credential set. Running those separately is three more operational surfaces
for a project whose scarcest resource is engineering time.

**The cost, stated plainly.** PostgREST caps a response at 1,000 rows regardless
of the limit asked for. That silently truncated the admin dashboard's
demographics to the first thousand of 1,876 patients and made every "busiest
district" come back as exactly 25 — figures that were wrong and entirely
plausible at the same time. The fix was `admin_analytics()`, aggregating in
Postgres. **Aggregate in the database, not over PostgREST.**

### `pg` alongside `supabase-js`

Two clients, for two genuinely different jobs.

`supabase-js` handles every request-path read and write, because it goes through
PostgREST and therefore through RLS when using the anon key. `pg` is used
**only** by `applyV2.js`, `seedV2.js` and `seedRootAdmin.js`, because the REST
API cannot execute DDL and a schema apply must run real SQL files.

### The Aadhaar number as the primary key

**Alternative: a surrogate UUID with an indexed Aadhaar column** — the
conventional choice.

**Why the natural key.** A second human-facing identifier is one more thing to
print, type and mistype at a counter where staff already ask for Aadhaar. Making
it the primary key means a returning patient is found by the number they already
carry, and the visit history follows the person rather than a record id.

**The costs, all real.** `patients` has no `id` column, which broke a health
check that did `select('id')` (`checkServices.js` now uses `select('*')` and says
why in a comment). Foreign keys are `VARCHAR(12)` rather than `UUID`.
`audit_logs.entity_id` had to be `TEXT`. And the key is immutable —
`updatePatient` strips `aadhaar_number` from the patch, because a wrong Aadhaar
means a new record, not an edited one, or the visit history follows the wrong
person.

### Age derived, never stored

Not a technology choice, but the most consequential schema decision. A stored age
is wrong the day after it is entered, and `riskEngine.js` applies genuinely
different thresholds across seven age bands — so a stale age is a clinical error,
not a display bug. `ageFromDob()` computes it per request.

### Qdrant Cloud, over pgvector

**Alternative: `pgvector` in the existing Postgres** — one fewer service, and
protocol text could be joined to relational data.

**Why Qdrant.** Payload filtering with an explicit index. The safety requirement
is that only protocols tagged `approved = true` are retrievable, and Qdrant makes
that a first-class filter with a payload index created deliberately in
`seedQdrant.js`. Without that index Qdrant returns
`400 Index required but not found`, the whole vector block throws, retrieval
silently falls through to the keyword store — **and the approved-only safety
filter never runs**. Making the index an explicit, named creation step is what
turns that failure mode into something visible.

**The honest cost:** Qdrant is a second service with a second credential, and the
Supabase fallback path in `ragEngine.js` queries `clinical_protocols`, a v1 table
v2 does not create — so Qdrant is effectively the *only* retrieval source.
[L2](16-known-limitations-and-risks.md#l2).

---

## 5. Authentication

### Supabase Auth for passwords + an own JWT for sessions

**Alternative A: Supabase session tokens end to end.** Simpler, one token type.

**Alternative B: own password hashing with `bcrypt`.** Full control.

**Why the hybrid.** Passwords are the thing least worth hand-rolling — Supabase
Auth handles hashing, rate limiting at the identity provider, and admin
user management including credential revocation, which `deactivateUser()` uses to
ban a credential so an existing session cannot outlive a suspension.

But **the role must never come from the token**. `auth.middleware.js` accepts
either token type and then, in both paths, re-reads the profile from
`staff_profiles`. The role in the JWT body is carried for convenience only. That
is what makes a revoked role take effect on the very next request rather than at
token expiry.

The 12-hour lifetime is a deliberate trade: there is no server-side revocation
list, so short expiry is the only bound on a stolen token's window. A deny-list
is the real fix and is not built —
[09 — Authentication §7](09-authentication.md#7-known-gaps).

---

## 6. Frontend

### React 18.3, over Vue or Svelte

The deciding factor was not React itself but the ecosystem around the two hardest
UI problems here: `getUserMedia` camera capture with an in-page preview, and
`RTCPeerConnection` perfect negotiation. Both are raw browser APIs, both are
easier to reason about inside a hook with refs than inside a reactive store,
because negotiation callbacks read state **synchronously** and must never see a
stale render's copy. `CallPage.jsx` keeps every negotiation flag in a `useRef`
for exactly that reason.

### Vite 5.2, over Create React App or Next.js

**Alternative: Next.js.** Rejected. The application is entirely behind
authentication; there is no content to server-render and no SEO to gain. A
Next.js server would be a second runtime to deploy, defeating the single-container
architecture that lets the Express process serve the SPA, the API and the
WebSocket from **one origin** — which in turn removes CORS from the equation
entirely for the production deployment.

**Alternative: CRA.** Effectively unmaintained.

### Tailwind 3.4, over CSS Modules or a component library

**Alternative: MUI / Chakra / shadcn.** Rejected, and this is the one place the
project deliberately spent time on visual identity. A government medical service
should not look like a startup dashboard, and it should not look
machine-generated. `tailwind.config.js` defines a token system — `gov-*` navy,
`ink-*` text, `surface-*`, `line`, and critically `tier-*` — and
`components/ui/index.jsx` builds a small, consistent component set on top of it.

**`tier-*` is a semantic colour scale that means exactly one thing.** Green,
amber, orange and red are reserved for LOW / MODERATE / HIGH / EMERGENCY and are
never reused decoratively. A risk colour appearing on a button that is not about
risk would erode the one visual signal that carries clinical meaning.

`clsx` + `tailwind-merge` are combined into a single `cn()` helper so a variant
class can be overridden by a caller without specificity fights.

### Three.js — landing page only

`DistrictNetwork3D.jsx` renders an India district network on the public landing
page. **There is zero 3D anywhere inside a clinical workflow**: it costs battery
on a rural tablet and adds nothing to reading a vitals table. The component
handles resize, honours `prefers-reduced-motion`, stops rendering when the tab is
hidden, and fully disposes GPU resources on unmount.

### `axios`, over `fetch`

For two interceptors that would otherwise be repeated at 42 call sites: a request
interceptor attaching the bearer token, and a response interceptor that detects a
dead session (401, or a 403 whose message matches `no longer active|no staff
profile|no usable role`), clears `localStorage` and redirects to `/login`.

---

## 7. Realtime and video

### One WebSocket for both notifications and call signalling

**Alternative: two sockets, or Supabase Realtime for notifications and a separate
signalling server for calls.**

**Why one.** A doctor with the queue and a call open would otherwise hold two
sockets, with reconnect logic in two places. More importantly, there was
previously a second signalling server on `/signal` serving a call path that had
become unreachable from the UI and booked consultations with a payload the API
rejects. It has been removed rather than left mounted as an unused way into live
consultations. `realtimeHub.js` refuses an upgrade to any path other than
`/realtime` with a 404, rather than leaving the socket open and unowned.

### `ws`, over Socket.IO

**Alternative: Socket.IO** — rooms, automatic reconnection, fallback transports.

**Why raw `ws`.** The signalling protocol is eight message types
(`call:join/offer/answer/ice/leave` and three notification shapes) and the room
model is a `Map<consultationId, Set<WebSocket>>`. Socket.IO's abstractions would
add a wire protocol and a client library for functionality that is 60 lines here.
Its automatic reconnection is also the wrong shape: the server **forgets** a
socket's call room on disconnect, so the client must re-declare membership rather
than have a library transparently restore a connection whose server-side state is
gone. `RealtimeContext.jsx` implements exponential backoff and a TTL'd outbox
deliberately, in one place.

### Peer-to-peer WebRTC, over ZegoCloud, LiveKit or an SFU

Both hosted SDKs were **actually evaluated** — `docs/PHASE2_PROGRESS.md` Batch 9
records a three-way comparison with results per option.

| Option | Result |
|---|---|
| ZegoCloud | Room join only; remote audio/video unprovable. **Removed** |
| LiveKit | Worked — both directions, live A/V, survived refresh. **Removed anyway** |
| Custom WebRTC | Worked — both directions, live A/V, 0 errors, 0 warnings, survived refresh. **Kept** |

**Why custom won even though LiveKit worked.** A consultation is exactly two
peers, which is precisely the workload P2P is correct for — not a stand-in for
something better. It carries no per-minute cost, no vendor credential in the
browser bundle, and consultation media never traverses a third party. The
`VideoProvider` abstraction means the state machine cannot tell the
implementations apart, so this is reversible.

**What the decision costs, honestly.** Owning ICE, perfect negotiation and
reconnection. `CallPage.jsx` is 549 lines and every one of the nine defects listed
in `implementation_plan.md` §0.1 had to be fixed by hand. And it needs a TURN
relay: STUN alone fails across carrier-grade NAT, which is the normal case on a
rural mobile ISP, and without a relay the call negotiates and then carries no
media — a frozen black screen, not an error. `P2PProvider.js` falls back to a free
public relay with a one-time warning.

**Perfect negotiation with politeness fixed by role.** Election by arrival order
cannot survive a rejoin, where both peers are already present, so both would be
elected or neither would. `DOCTOR` is the polite peer, always, on both sides.

---

## 8. AI and models

### A trained classifier **and** a hosted LLM, not either alone

This is the central architectural decision.

**LLM alone:** an LLM asked "what disease is this" will name something plausible
for any input, with no notion of how well the symptoms actually matched anything.
"We do not have a confident match" is not expressible.

**Classifier alone:** it ignores duration, vitals and history entirely, and
cannot read *"chest pain since morning, worse on stairs"*.

**The composition:** the classifier produces ranked candidates with calibrated
probabilities; the LLM may **re-rank and reject** them but may not introduce a
disease outside the list; and a deterministic rule engine sets a tier floor that
neither can lower. That bound is what keeps the output traceable to 244,938
labelled training rows rather than to the model's imagination.

### Bernoulli Naive Bayes, over KNN or a neural network

The original plan named KNN. It was rejected on measurement.

| Model | Verdict |
|---|---|
| **KNN** | Keeps the whole 246k × 377 matrix in memory (~93 M values) and scans it on every prediction. Its distance metric is hard to reason about at this dimensionality |
| **Neural network** | Would need a GPU at inference, is not auditable, and is not obviously better on binary presence/absence features |
| **Bernoulli NB** ✅ | The textbook fit for binary features. Trains in seconds, predicts in microseconds, and — the part that matters clinically — returns **calibrated per-class probabilities**, so `confident: false` is expressible |
| **Centroid cosine** | Fitted as a baseline. A single number from one model is not evidence the model is any good |

Measured on 48,988 held-out cases: NB top-1 **0.854**, top-3 **0.952**, top-5
**0.974**; centroid baseline top-1 0.844, top-5 0.978. Full detail and the
caveat about which model the metadata *labels* as selected:
[11 — AI Model Training](11-ai-model-training.md).

### Python service over HTTP, not a subprocess

**Alternative: shell out to Python per request.**

**Why HTTP.** Model load happens **once at service start** instead of on every
assessment. Loading a 3.6 MB scikit-learn artifact per request would dominate the
latency of the whole pipeline.

**Why loopback.** The service has no authentication of its own. It was written on
the assumption that only the backend can reach it, and inside one container that
is literally true. `start.sh` binds it to `127.0.0.1:8001`, and `DEPLOYMENT.md`
states explicitly that it must not be given a public domain.

### FastAPI, over Flask

Pydantic request models give validated, typed input at the boundary with no
hand-written parsing — `top_k` bounded 1–10, `age_years` 0–130,
`min_confidence` 0–1, all enforced before any code runs. Flask would need those
checks written by hand in every handler.

### Groq, over OpenAI or Anthropic, for assessment and speech

Inference speed and a free tier that a hackathon can actually run on, with an
OpenAI-compatible API surface. Whisper is available from the same provider and
the same key pool, so speech and text share one rate-limit budget and one
benching mechanism.

**The cost:** aggressive rate limits, which is exactly why `keyPool.js` exists.
And model churn — Groq decommissioned `llama-3.3-70b-versatile` mid-project, and
because the model id was hardcoded at three separate call sites, every one
started returning 404 and each service quietly fell back to its non-AI path. The
assessment pipeline ran for an unknown period with no model in it at all. That
incident produced `config/models.js`: one definition per model, overridable by
environment, plus `verifyModelsAvailable()` which turns a decommission into a red
line in `npm run check` instead of silence.

### Gemini, over Groq or GPT-4V, for vision and OCR

**The deciding factor is not quality — it is capability.** The configured Groq
key exposes **no vision-capable models at all**. Gemini also reads **PDFs
natively, all pages in one request**, which is what makes a multi-page lab report
work: splitting pages into separate calls loses the cross-page context that makes
the report readable — the header on page 1, the reference ranges on page 3.

`config/gemini.js` is a **hand-written REST client** rather than
`@google/generative-ai`, for direct control over two things the SDK abstracts
away: the per-model fallback chain (Gemini free-tier quota is per model, so a
429 means *this* model is exhausted, not that the key is dead), and
`finishReason: 'MAX_TOKENS'` handling — a truncated response is not a partial
success, because the JSON will not parse and a half-read lab report must not look
like a complete one.

The model-verification check for Gemini makes a **real `generateContent` call with
a 1×1 PNG**, not a `/models` listing, because `gemini-2.5-flash` was listed for
months after `generateContent` started returning 404 for new keys — a combination
that made the health check pass while every wound photo and every prescription
silently fell back to the non-vision path.

### Tesseract.js as the OCR fallback

Runs locally, costs nothing, and works when Gemini declines or is unreachable.

**The cost was severe and is now handled.** Tesseract.js reports a failed image
decode by **throwing from its worker thread on a later tick**, which escapes every
`try/catch` around the call and killed the whole Node process — one truncated
upload from one assistant took the backend down for every clinic.
`looksLikeDecodableImage()` screens the buffer by magic bytes before the worker
ever sees it, and `server.js` carries `uncaughtException` and `unhandledRejection`
handlers as a last-resort net.

### `pdfkit`, over Puppeteer or `window.print()`

Three reasons specific to this setting: identical output on the low-end Android
tablets a sub-centre actually uses, where print-CSS support is unreliable; the
file can be attached to the record rather than only sent to a printer; and no
headless-browser dependency, so it runs on a small dyno. Puppeteer would add
~300 MB to the image for a document with no complex layout.

---

## 9. Testing

### Jest, over Vitest or `node:test`

`node:test` is dependency-free but its ESM mocking story is thinner, and this
suite depends heavily on module mocking — `aiOrchestrator.test.js` injects fake
Groq and inference clients so the pipeline runs with a controlled model response.
Vitest is faster but is built around Vite, which the backend does not use.

The configuration states its own constraint in a comment: **external APIs are
never called from this suite**, so CI stays free, deterministic, and spends no AI
quota. Anything needing a live provider belongs in `npm run check` or
`npm run check:ai`.

### Live-service check scripts as a separate tier

`checkServices.js`, `checkAiPipelines.js` and `preflight.js` make real calls,
deliberately, and are the **only** places allowed to. They have twice caught bugs
no unit test could:

- A Supabase `head: true` count reported an empty database as healthy — a HEAD
  count against a table that does not exist returns no error. `checkServices.js`
  now does a real row select and says why in a comment.
- A constraint probe passed on error code `23502` (not-null) instead of `23514`
  (check) — green while proving nothing.

---

## 10. Deployment

### Railway + Nixpacks, over Vercel + a separate backend, or Docker

**Alternative: Vercel (frontend) + Railway (backend).** `frontend/vercel.json`
still contains a working configuration for it.

**Why one container.** The Express process serves the SPA, the API and the
WebSocket from **one origin**, which removes CORS from the production path
entirely and means the realtime socket host can be derived from the page rather
than configured twice. Configuring it twice is exactly what went wrong before: a
deployment moved the backend, `VITE_API_URL` was updated and `VITE_REALTIME_URL`
was not, so every API call succeeded while the socket dialled a decommissioned
service. Nothing surfaced that as an error — consultations just never connected.

**Why Nixpacks over a Dockerfile.** The image needs Node **and** Python 3.11 in
one runtime, and `nixpacks.toml` expresses that in four lines. It also carries the
one non-obvious fix this stack needs:

```toml
nixLibs = ['stdenv.cc.cc.lib', 'zlib']
```

NumPy, SciPy and scikit-learn ship manylinux wheels containing compiled
extensions that link against the system C++ runtime. A Nix-provided Python does
not put that runtime on the loader path, so the wheels install perfectly and then
fail at import with `libstdc++.so.6: cannot open shared object file` — which
reads as a broken NumPy rather than a missing library.

### The build fails soft on Python, by design

`build-ai.sh` exits `0` even when the Python install fails, and deletes the
half-built virtualenv so `start.sh` reports it as absent rather than launching a
uvicorn that cannot import its own dependencies.

**The reasoning is stated in the script:** the clinic's core work — registering
patients, running consultations, handing cases to doctors — does not depend on
the Python service. The Node client already degrades correctly, treating a failed
call as *"no candidates"* rather than *"no disease"*. Before this, a pip
resolution failure failed the whole Railway build and took the backend down with
it: a resolver problem in an optional subsystem became a clinical outage.

The script also **imports every package after installing**, because installing is
not the same as working — that is the check that catches the `libstdc++` class of
failure at the point where the output is still being read.

---

## 11. Decisions in one table

| Decision | Chosen | Over | Deciding reason |
|---|---|---|---|
| Server runtime | Node 22 | Python, Go | WebRTC signalling + long-lived sockets |
| API framework | Express 4 | Fastify, Express 5 | Mature security middleware ecosystem |
| Language | JavaScript | TypeScript | Iteration speed; validation budget spent at runtime |
| Database | Supabase Postgres | Firebase, self-hosted | Relational integrity rules **are** the product |
| Vector store | Qdrant | pgvector | Explicit payload index for the `approved` safety filter |
| Patient key | Aadhaar (natural) | UUID surrogate | One identifier at the counter, not two |
| Age | Derived per request | Stored column | A stale age is a clinical error, not a display bug |
| Auth | Supabase + own JWT | Either alone | Don't hand-roll passwords; never trust the token's role |
| Frontend | React + Vite | Next.js, CRA, Vue | No SSR need; single-origin deployment |
| Styling | Tailwind + tokens | MUI, Chakra | Government-medical identity; semantic tier colours |
| Realtime | Raw `ws`, one socket | Socket.IO, two sockets | Small protocol; server forgets rooms, so membership must be declarative |
| Video | P2P WebRTC | ZegoCloud, LiveKit | Evaluated all three; two peers is P2P's exact workload |
| Classifier | Bernoulli NB | KNN, neural net | Calibrated probabilities; "I do not know" is expressible |
| AI serving | FastAPI on loopback | Subprocess, in-process | Load the model once, not per request |
| Assessment LLM | Groq gpt-oss-120b | OpenAI, Anthropic | Speed + free tier; ids centralised after a decommission incident |
| Vision/OCR | Gemini + fallback chain | Groq, GPT-4V | Groq exposes no vision model; Gemini reads PDFs natively |
| OCR fallback | Tesseract.js | Cloud-only | Works offline and free — with magic-byte screening |
| PDF | pdfkit | Puppeteer, print CSS | Identical output on rural tablets; no headless browser |
| Validation | Hand-written | zod, joi | Field-keyed errors + derivation + cross-field checks in one pass |
| Tests | Jest + live check scripts | Jest alone | Live scripts caught what unit tests structurally cannot |
| Deploy | Railway + Nixpacks | Vercel split, Docker | One origin; Node + Python in one image in four lines |
