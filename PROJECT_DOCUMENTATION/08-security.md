# 08 — Security

> **Navigation:** [Index](README.md) · Previous: [07 — Tech Stack](07-tech-stack.md) · Next: [09 — Authentication](09-authentication.md)

Input validation, file uploads, secret management, transport, injection posture,
rate limiting, audit logging, PII and health-data handling, district scoping, and
the clinical-safety boundaries enforced in code. §11 is an explicit,
non-defensive list of what is **not** secured.

---

## 1. Input validation

### 1.1 Patient identity — `services/patientFields.js`

The authority. `frontend/src/config/patientFields.js` mirrors it so the form can
validate as the user types, and carries a header comment naming the backend copy
as authoritative.

| Field | Rule | Regex |
|---|---|---|
| Aadhaar | Exactly 12 digits | `/^[0-9]{12}$/` |
| Phone | Indian mobile — 10 digits starting 6–9 | `/^[6-9][0-9]{9}$/` |
| PIN code | 6 digits, never starting 0 | `/^[1-9][0-9]{5}$/` |
| Gender | Enum | `male` \| `female` \| `other` |
| Full name | 2–150 chars after trim | length check |
| Date of birth | Parseable, not future, ≤ 120 years ago | `Date` + `ageFromDob` |
| Village line 1 | Required, ≤ 150 | length |
| District | Required, ≤ 100 | length |
| State | Must be a real `states` row | FK lookup in `createPatient` |

`validateRegistration()` returns `{ valid, errors, value }` where `errors` is
**keyed by field**, so the form places each message next to its own input rather
than showing one banner. `digitsOnly()` strips spaces and hyphens people type
into Aadhaar, phone and PIN fields.

`updatePatient` **re-validates the whole payload**, not just the changed fields.
A partial update that skipped validation is how a bad phone number or PIN gets in
after registration.

### 1.2 Vitals — `validateVitalsRanges()` in `visit.controller.js`

A transposed digit produces a physiologically impossible value, and the triage
rules would treat it as a genuine red flag. Rejecting it here is the difference
between "re-enter the pulse" and a false emergency referral.

| Vital | Accepted range |
|---|---|
| Temperature | 95–107 °F |
| Systolic BP | 50–300 mmHg |
| Diastolic BP | 20–200 mmHg |
| Pulse | 20–250 bpm |
| SpO₂ | 50–100 % |
| Respiratory rate | 5–80 /min |
| Blood glucose | 20–800 mg/dL |

Plus a **cross-field** check: diastolic must be below systolic.

Three layers, deliberately widening outward:

| Layer | Purpose |
|---|---|
| `frontend/src/config/vitals.js` — `min`/`max` | Reject a stuck key before submit |
| `validateVitalsRanges()` | Reject before the rule engine sees it |
| `visit_vitals` CHECK constraints | The floor, at rest |

All three are **wider than the alerting thresholds** on purpose: a genuine SpO₂
of 68 must be enterable, because that is exactly the reading that needs to reach a
doctor fastest.

### 1.3 Enum and identifier validation

| Input | Validation |
|---|---|
| `document_type` | Whitelisted against `DOC_TYPES`, else coerced to `other` |
| `risk_level` | `normaliseRiskTier()` — returns `null` for anything unrecognised rather than guessing |
| `decision` | Whitelisted against 5 allowed values |
| `status` | Whitelisted to `active` / `inactive` / `suspended` |
| `role` | Must be in `CREATABLE_ROLES[caller.role]` |
| `symptom_duration_unit` | `days` / `months` / `years` |
| `severity_impression` | `LOW` / `MEDIUM` / `HIGH`, else stored as `null` |
| `registration_mode` | Whitelisted, else `standard` |
| Report `type` | Must be in `REPORT_TYPES` |
| UUIDs in audit | `asUuid()` regex-checks before insert, else `null` |

### 1.4 Model output is validated, not trusted

The unusual part of this system's validation posture: **output from a language
model is treated as untrusted input.**

| Model output | Validation |
|---|---|
| Health-card fields | `validateHealthCardFields()` — a name of pure digits is a misread card number; a DOB in the future or >120 years ago is refused; a gender outside the enum is dropped. **A rejected field is simply absent**, and the API reports which ones it refused |
| Year-only birth date | Kept as `year_of_birth` and **never** turned into a full date |
| Vision `confidence` | Capped at `moderate` **in code**, not only in the prompt |
| Vision `severity_impression` | Whitelisted; anything else becomes `MEDIUM` |
| Lab `recommended_next_step` | Whitelisted to three values, else `DOCTOR_REVIEW` |
| Assessment `risk_level` | May only **raise** the tier — `RISK_RANK` comparison |
| Any medication | Deleted outright (§7) |
| Whisper transcript | Three independent rejection gates (§7.4) |
| OCR `flag` | Whitelisted to `high`/`low`/`normal`, else `unknown` |

---

## 2. File-upload handling

### 2.1 Size and count limits

`multer.memoryStorage()` buffers the whole file in heap, so an unbounded upload
is a trivial denial of service. Every instance declares limits:

| Router | Limit |
|---|---|
| `ai.routes.js` | 10 MB × 10 files |
| `vision.routes.js` | 10 MB × 10 files |
| `voice.routes.js` | 10 MB × 10 files |
| `document.routes.js` | 15 MB × 10 files |

JSON bodies are capped at **1 MB** (`express.json({ limit: '1mb' })`). The former
50 MB ceiling let a single request allocate 50 MB of heap; uploads arrive as
multipart, so JSON bodies are legitimately small.

`document.routes.js` wraps `upload.any()` so a `LIMIT_FILE_SIZE` error becomes
*"A file is larger than 15 MB. Photograph the page again at a lower resolution."*
rather than an unhandled error.

### 2.2 Content screening before Tesseract

```js
const looksLikeDecodableImage = (buffer) => {
  if (!buffer || buffer.length < 64) return false;
  // JPEG · PNG · BMP · TIFF · WEBP magic bytes
};
```

**Why this exists.** Tesseract.js reports a failed image decode by **throwing
from its worker thread on a later tick**, which escapes every `try/catch` around
the call and killed the whole Node process — one truncated upload from one
assistant took the backend down for every clinic.

Defence in depth for the same class of failure: `server.js` installs
`uncaughtException` and `unhandledRejection` handlers that log loudly and keep
serving. They are a safety net, not a substitute — anything landing there is a
bug that still needs fixing at its source.

### 2.3 Storage

| Property | Value |
|---|---|
| Bucket | `injury-photos`, **private** |
| Path | `injuries/{aadhaar}/{timestamp}_{sanitised-filename}` |
| Stored in DB | `storage_path` only — `image_url` is deliberately `NULL` |
| Read access | One-hour signed URL, minted per request |

Filenames are sanitised (`replace(/\s+/g, '_')`). The path is derived from the
**visit**, not from client input — an earlier version read `patient_id` from the
request body, which also meant a client could attach a photograph to a different
patient. The visit lookup is district-scoped, so a foreign visit id resolves to
nothing.

`npm run preflight` asserts the bucket exists **and** `public === false`.

---

## 3. Secret management

### 3.1 Nothing secret is committed

`.gitignore` excludes `.env`, `backend/.env`, `frontend/.env`, `*.env.local`,
`database/v2/DEMO_CREDENTIALS.md`, `.kaggle/` and `kaggle.json`. Verified: `git
ls-files | grep env` returns only `.env.example` files, `env.js`, `_env.py` and
`frontend/.env.production` (which contains one non-secret URL).

### 3.2 JWT secret — refuses to start on a bad value

```js
const KNOWN_LEAKED_SECRETS = new Set([
  'virtual_village_clinic_jwt_secret',
  'virtual_clinic_jwt_secret_key_2026'
]);
const MIN_SECRET_LENGTH = 32;
```

In **production**, a missing, short, or previously-leaked secret is fatal:
booting anyway would serve traffic anyone can forge tokens against, and a forged
token carries whatever role it claims — including `ADMIN`.

In **development**, a random 48-byte secret is generated per boot instead, so
there is no fixed value to leak. The only cost is that tokens do not survive a
restart.

Both leaked values are hard-coded into the refusal list because anyone reading
the repository history can sign a token with them.

### 3.3 Groq key pool — `config/keyPool.js`

Four environment variable names are read (`GROQ_API_KEY`, `Groq_API_Key1..3`),
**duplicates collapsed by value** so two vars holding the same key do not double
the apparent capacity and make the pool bench "both" at once.

| Event | Behaviour |
|---|---|
| Normal | Round-robin across available keys |
| `429` | Bench that key for `Retry-After`, or the delay parsed from the message, capped at 30 s |
| `401` / `403` | **Retire permanently** — a bad key, not a busy one |
| All benched | Wait for the soonest, rather than silently falling back to the non-AI path |
| No keys | Throw — never degrade silently |

`poolStatus()` exposes per-key call counts and rate-limit hits **without ever
exposing a key value**.

### 3.4 Other handling

| Practice | Where |
|---|---|
| Service-role key never reaches the browser | Only `SUPABASE_ANON_KEY` is exposed as `VITE_*` |
| No hardcoded credential fallbacks | `frontend/src/config/supabase.js` and `seedQdrant.js` both had them removed; `seedQdrant.js` previously carried a live cluster URL and API key as defaults, in a public repository |
| Secrets never logged | `checkServices.js` prints provider messages, never key values |
| Demo password rotation | `npm run rotate:demo` writes to a gitignored file and prints once |
| Super-admin credentials | Passed on the command line at provision time; no default, minimum 12 characters, never in the repo or the bundle |
| Video credentials | `joinMeeting()` issues a short-lived per-user JWT. Provider secrets never cross the `VideoProvider` boundary |
| Realtime token | Passed as a query parameter because the browser `WebSocket` API cannot set headers; short-lived and not logged |

---

## 4. Transport security

| Control | Implementation |
|---|---|
| HTTPS / WSS | Terminated by the platform. `RealtimeContext.jsx` derives the socket **scheme from the page**, never from configuration — an HTTPS document may not open a `ws://` socket, and honouring a misconfigured `ws://` would just reproduce the failure |
| CORS | Origin **allowlist** from `CORS_ALLOWED_ORIGINS`. Required in production; the server refuses to start without it. A wildcard is never accepted — with `*`, any website could drive the API using a signed-in user's browser |
| CORS denial | Withholds the CORS headers rather than throwing. An error propagates to the global handler and turns the request into a 500, which took down same-origin stylesheets the moment anything added an `Origin` header. Without the headers the browser blocks the cross-origin read itself, which is the actual enforcement |
| WebSocket origin | Browsers do **not** apply CORS to WebSockets, so `realtimeHub.js` checks `request.headers.origin` against the same allowlist and refuses with 403. This check is the only thing standing in for CORS there |
| Path restriction | An upgrade to any path other than `/realtime` is refused with a 404 and the socket destroyed — returning silently would leave it open and unowned |
| `trust proxy` | `app.set('trust proxy', 1)` so rate limiting and logging see the real client IP. Without it every request behind the load balancer shares one bucket and the limiters are meaningless |
| Security headers | `helmet` — HSTS, `X-Content-Type-Options`, `X-Frame-Options`, referrer policy. **CSP is disabled** — see §11 |

---

## 5. SQL injection and XSS posture

### 5.1 SQL injection

**Parameterised throughout.** Every request-path query goes through
`supabase-js`, which builds PostgREST requests with encoded parameters — string
concatenation into SQL is not possible through that interface. The `pg` client is
used only by DDL/seed scripts, and `seedRootAdmin.js` uses positional parameters
(`$1, $2, $3`).

**The one construct that deserves scrutiny** is PostgREST's `.or()` filter, used
in three places with interpolated user input:

```js
q.or(`full_name.ilike.%${term}%,phone.ilike.%${term}%,village_line1.ilike.%${term}%`)
```

This is a PostgREST filter expression, not SQL — PostgREST parses it and emits
parameterised SQL, so it is not an SQL-injection vector. It **is** a filter-syntax
injection surface: a term containing a comma or a closing parenthesis can alter
which columns are matched. In every case the query is additionally constrained by
`.eq('clinic_district_id', …)` or `applyScope()`, so the blast radius is confined
to the caller's own district and cannot reach another tenant's rows. Escaping the
term is still the correct fix — tracked as
[L13](16-known-limitations-and-risks.md#l13).

A 12-digit search term is matched **exactly**, not as a substring, so partial
digits cannot be used to walk the Aadhaar keyspace.

### 5.2 XSS

| Surface | Posture |
|---|---|
| React rendering | JSX escapes by default; **`dangerouslySetInnerHTML` appears nowhere in the codebase** |
| PDF generation | `pdfkit` draws text primitives — there is no HTML parser to exploit |
| Error messages | Suppressed in production for 5xx (§6) |
| Audit metadata | Stored as JSONB, rendered as text |
| **The one gap** | `generateCompletePDFReport()` in `PatientAssessmentVisitPage.jsx` builds an HTML string with template interpolation and writes it into a `window.open()` document. Patient name, symptoms and assessment text are interpolated unescaped. The content originates from the same clinic's own staff, and it opens in a blank window rather than the app origin — but it is unescaped interpolation and should use the server-side PDF route that already exists. [L12](16-known-limitations-and-risks.md#l12) |

---

## 6. Error handling as a security control

```js
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err);
  const status = err.status || 500;
  const body = { error: status === 500 ? 'Internal Server Error' : err.name || 'Request Error' };
  if (!config.isProduction || status < 500) {
    body.message = err.message || 'An unexpected error occurred.';
  } else {
    body.message = 'An unexpected error occurred. Contact an administrator if this persists.';
  }
  res.status(status).json(body);
});
```

The message is **logged in full** but only returned outside production. Internal
errors routinely carry table names, query fragments and upstream provider detail,
and that is reconnaissance material.

### Uniform authentication failures

`login` defines a single `reject()` used for every failure mode — no such
account, wrong password, no staff profile, suspended account — so the response
cannot be used to enumerate valid emails or account states. The distinctions are
recorded in the audit log (`LOGIN_DENIED_NO_PROFILE`, `LOGIN_DENIED_INACTIVE`)
where only oversight roles can read them.

### Uniform patient-existence failures

`createPatient` returns the same 409 message whether the Aadhaar is registered in
this district or another, so the endpoint cannot be used to probe whether a
patient exists elsewhere in the country.

---

## 7. Clinical-safety boundaries enforced in code

This is the section that distinguishes this system. Each boundary is a mechanism,
not a policy statement.

### 7.1 Medication is withheld from the health worker, at every tier

```js
// aiOrchestrator.js §7
delete finalAssessment.supportive_medication_guidance;
delete finalAssessment.medications;
finalAssessment.medication_withheld = true;
finalAssessment.medication_withheld_reason =
  'Medication is prescribed by the doctor after review. This assessment does not suggest any.';
```

**Both sources are refused, not just the model.** Whatever the model returned on
this subject is *discarded rather than filtered*, because a model that ignores
its instructions must not be able to reach a health worker with a dose. And the
signed formulary is withheld too, because "the rules chose it" does not make it
the assistant's decision to act on.

`tierWorkflowService.js` → `medicationFor()` returns `{ emitted: false, items: [] }`
unconditionally, at **every** tier — including LOW. The distinction that used to
be drawn (LOW may carry medication) put a dose in front of a health worker for
exactly the cases nobody was going to look at again, which is the wrong way
round.

Six tests in `medicationBoundary.test.js` assert that **no drug name appears
anywhere in the workflow object**, at any tier, using a word-boundary regex over
the serialised output.

### 7.2 The formulary rules engine and rule-sourced assertion

The engine is intact and governs what a doctor may prescribe. Eight sequential
gates in `formularyService.js`:

| # | Gate | Rule |
|---|---|---|
| 1 | Tier | Only LOW. MEDIUM → doctor issues it during consultation; HIGH → referral, no medicine |
| 2 | Signature | Any unsigned entry + `REQUIRE_SIGNED_FORMULARY` ⇒ emit nothing. **Default on in production** |
| 3 | Indication | Must match the recorded symptom text |
| 4 | Red flags | Checked against symptoms **and** history |
| 5 | Contraindications | Checked against history |
| 6 | Allergies | Checked against recorded allergies |
| 7 | Pregnancy | Not established as safe ⇒ excluded |
| 8 | Age band + weight | **Unknown age is a suppression, not a default to the adult dose.** Guessing an adult dose for a child is how a paediatric overdose happens. A per-kg dose with no recorded weight is refused |

Every emitted record carries `rule_source_id`. `assertRuleSourced()` **throws** on
any entry without one:

```js
throw new Error(
  `Refusing to emit medication without a rule_source_id: … ` +
  'Medication must come from the formulary rules engine, never from a model.'
);
```

`ai.controller.js` calls it and, on failure, empties the medication list and
appends the warning *"Medication suggestions were withheld: they could not be
traced to a signed formulary rule."*

22 tests in `formularyService.test.js` cover all eight gates.

### 7.3 The tier floor

```
final_tier = MAX(rule_tier, vision_tier, model_tier)
```

| Sub-rule | Enforcement |
|---|---|
| A model may raise a tier, never lower one | `higherTier()`; `RISK_RANK` comparison |
| Degraded AI fails safe to MEDIUM, never LOW | `degradedReason` branch — *"This case was not assessed by the model."* |
| Missing data escalates | Each absent core vital named; tier floored at MEDIUM |
| LOW is earned | Requires SpO₂, temperature, BP, pulse **and** age present and in range |
| A reading of `0` is a reading | `toNumber()` — `if (spo2)` treats an SpO₂ of 0 as "not recorded" and skips every red-flag check |
| Celsius is converted | Below 45 ⇒ °C. An unconverted 39 °C reads as 39 °F, below every threshold — a high fever would have triaged LOW |

### 7.4 Nothing is fabricated

| Path | Failure behaviour |
|---|---|
| Speech | `ok: false` + reason, **empty** transcript and symptoms. Three independent gates: whole-transcript artefact patterns, silence detection, and Whisper's structural padding tell |
| OCR | `needs_manual_entry: true` with empty medications and panels. Ambiguous handwriting gets a `(unclear)` marker, never a guess |
| Vision | `analysis_possible: false`, photo flagged for direct doctor review, no findings invented |
| Disease candidates | Empty list, with *"Absence of candidates is not evidence of good health."* |
| Diet guidance | Returns `[]` rather than filler when no pattern matches confidently |
| Hospital capacity | Hard-coded `'UNKNOWN'` + "confirm by phone". No public real-time bed feed exists, and an invented bed count on a referral screen is the most dangerous thing this system could display |

### 7.5 Model-output confidence caps

| Cap | Where |
|---|---|
| Vision `possible_conditions` confidence ≤ `moderate` | In the prompt **and** re-applied in `visionService.js` |
| Lab interpretation confidence ≤ `moderate` | Same pattern |
| `confident: false` below 15% top candidate | `app.py` — a flat posterior over 582 classes is the model saying it does not know, and rendering that as a ranked five invites the reader to treat 5% as a finding |
| Demographic impossibility gates | `gate_candidate()` — the classifier has never seen an age or a sex, and ranked "ovarian cyst" for a five-year-old boy. Gates only ever **remove** candidates |

### 7.6 Mandatory human verification

An OCR extraction is a **draft** until `verified_by` and `verified_at` are set by
`POST /api/documents/:id/verify`. `handOffVisit` reports verified and total
document counts separately in its manifest.

### 7.7 "Not for clinical use"

`ClinicalUseNotice.jsx` is the **single source** of the wording — two copies of a
safety disclaimer drift. It states that thresholds and the medication list are
drawn from published guidance but have not been reviewed or approved by a
registered medical practitioner for this deployment.

Shown on the public landing and sign-in screens, deliberately **not** repeated on
authenticated pages, where a permanent banner would be tuned out within a day and
would compete with the tier colours that do carry clinical meaning.

Every assessment additionally carries `legal_disclaimer`, and every unsigned
formulary line renders with `[UNSIGNED PLACEHOLDER — not reviewed by a registered
medical practitioner. Not for clinical use.]`.

---

## 8. Rate limiting

| Limiter | Window | Max | Applied to |
|---|---|---|---|
| `loginRateLimiter` | 15 min | 10 | `POST /auth/login` — `skipSuccessfulRequests: true` |
| `patientSearchRateLimiter` | 5 min | 60 | `/patients` list, `/lookup`, `/detail` |
| `aiRateLimiter` | 1 min | 20 | All `/ai`, `/vision`, `/voice`, and document upload |
| `globalRateLimiter` | 1 min | 300 | Everything under `/api` |

The reasoning is per-surface. Login is the credential-guessing surface, and staff
accounts are provisioned by an admin and few, so a legitimate user never comes
close. Patient lookup is the surface for probing which Aadhaar numbers exist —
slower on purpose, because an assistant searches a handful of times per
consultation, never hundreds. AI calls cost real money per request, so an
unbounded caller is a billing incident as well as a load problem.

`GET /api/ai/service-status` is mounted **above** the AI limiter deliberately:
someone checking whether the inference service is up must not be throttled by the
very calls failing because it is down.

**Known gap:** the store is in-memory, so limits are per process. Behind N
instances an attacker gets N× the limit. [L5](16-known-limitations-and-risks.md#l5).

---

## 9. Audit logging

Nineteen action types written across the controllers — the full list is in
[00 §3.19](00-project-overview.md#319-audit-logging).

### Redaction at write time

```js
const REDACT_KEYS = new Set([
  'aadhaar', 'aadhaar_number', 'aadhar', 'password', 'token', 'abha_number'
]);
```

Applied **recursively** to nested objects. A matched value is reduced to
`****NNNN` — enough to trace an event to a record without reproducing the
identifier. `entity_id` is separately masked with
`String(entityId).replace(/^\d{8}(\d{4})$/, '****$1')`.

**Why.** The audit log is the one table the widest set of roles can read — every
admin tier plus auditors — so writing an identifier into it hands that identifier
to everyone holding oversight access. Aadhaar is stored on `patients` by design;
it does not also belong in a log read by non-clinical staff.

### Append-only

`03_rls.sql` gives `audit_logs` a SELECT policy for oversight roles and an INSERT
policy for any active staff member, and **no UPDATE and no DELETE policy for any
role**. With RLS on, entries cannot be altered or removed through the API.

### Never breaks the request

`logAuditEvent` catches everything. An audit failure must never break the request
it is recording.

---

## 10. PII and health-data handling

### 10.1 Aadhaar

| Control | Implementation |
|---|---|
| Never in a URL | `POST /patients/lookup` and `/detail` take it in the **body**. URLs reach access logs, proxy logs and browser history |
| Masked in lists | `XXXX XXXX 9012`. Aadhaar Act 2016 §29(4) prohibits public display of the full number, and a patient list on a shared clinic screen is that situation |
| Masked in PDFs | `mask()` in `reportPdfService.js` |
| Redacted in audit | `****NNNN` |
| Rate-limited lookup | 60 per 5 minutes |
| Exact match only | A 12-digit search term is matched exactly, so partial digits cannot walk the keyspace |
| Immutable | `updatePatient` strips it from the patch |
| Documented migration path | `database/v2/README.md` records the exact change to `aadhaar_hash` + `aadhaar_last4` if the legal position is revisited |

The design is honest about its position: raw Aadhaar at rest is restricted under
the Aadhaar Act 2016 §29 and the DPDP Act 2023, UIDAI's standard pattern for
non-authorised entities is a hash plus last-4, and this stores the number as
specified with the mitigations above.

### 10.2 Clinical photographs

Private bucket, `storage_path` stored rather than a URL, one-hour signed URLs
minted per read. An hour is long enough to open a case and read it, short enough
that a copied link is not a lasting disclosure.

### 10.3 Data minimisation

| Practice | Detail |
|---|---|
| Six registration fields | Everything derivable is derived |
| Age not stored | Only date of birth |
| Health-card scan stores **nothing** | It is a proposal, not a record |
| Analytics carry no identifying field | `admin_analytics()` returns counts, bands and district names only |
| Demo emails are RFC 2606 reserved | `@vvc-demo.example.com` cannot reach a real inbox |
| Demo phone numbers cannot dial | Placeholder format |
| Clinical text stays on-device for TTS | Browser `SpeechSynthesis`, not cloud TTS |

### 10.4 Retention

Clinical records are **append-only**. The only removal is a soft delete on
`visits`, guarded four ways and recording who withdrew it and why. Staff are
**suspended**, never deleted, because clinical rows reference the staff member who
recorded them and a hard delete would either cascade those away or null out the
attribution that makes the audit trail meaningful.

---

## 11. District-level data scoping

Enforced at three layers that state the same rule.

### Layer 1 — scope derived from the caller's own profile

`attachRegionScope` sets `req.scope` from the **profile row**, never from the
request:

| Role | Scope |
|---|---|
| `SUPER_ADMIN` | `{ kind: 'national' }` |
| `STATE_ADMIN` | `{ kind: 'state', stateId }` |
| `DISTRICT_ADMIN` | `{ kind: 'district', stateId, districtId }` |
| `AUDITOR` | national, or state when `stateId` is set |
| everyone else | `{ kind: 'district', … }` |

`applyScope(query, scope)` applies it to the query builder. A query parameter can
**narrow** the result but never widen it — `getUsers` returns 403 for a
`districtId` or `stateId` outside the caller's own scope, and `createUser`
**forces** the region to the creator's scope regardless of what was sent.

### Layer 2 — every clinical read is district-filtered

| Query | Filter |
|---|---|
| `getPatients`, `lookupByAadhaar`, `getPatientDetail`, `updatePatient` | `.eq('clinic_district_id', req.user.districtId)` |
| `createVisit` | Patient must be in the caller's district |
| `getVisitById`, `updateVisit` | Doctor → `assigned_doctor_id`; assistant → `district_id` |
| `deleteVisit`, `handOffVisit` | `.eq('district_id', req.user.districtId)` |
| `getDoctorQueue`, `getDoctorCaseDetails`, `recordDoctorReview` | `.eq('assigned_doctor_id', req.user.id)` — **checked inside the query**, so a guessed visit id resolves to nothing |
| `uploadDocument`, `verifyDocumentExtraction`, `listDocuments` | Patient or visit must be in the caller's district |
| `analyzeImageAI` | Visit must be in the caller's district |
| Report PDF | Same rule as every other clinical read |
| `listDoctors` | District-scoped — there is no reason for an assistant in Ballia to enumerate the doctors of Agra |
| `getConsultations` | `doctor_id = me` or `assistant_id = me` |
| `listNotifications` | `recipient_id = me` — a recipient id can never be supplied by a client |

### Layer 3 — row-level security

`patients_read_by_clinician` uses `auth_serves_district(clinic_district_id)`.
`visits_read_scoped` splits on role. Tenancy keys on `clinic_district_id` (which
sub-centre holds the record), **not** on the address district — a patient may
give an address in another state, and that must not move their record out of the
clinic that registered them.

### Structural admin lockout

```js
const BLOCKED = new Set([...ADMIN_ROLES, ROLES.AUDITOR]);
export const denyAdminClinicalAccess = (req, res, next) => {
  if (req.user && BLOCKED.has(req.user.role)) {
    return res.status(403).json({
      error: 'Administrator and auditor accounts cannot access patient clinical records. ' +
             'This restriction is deliberate and cannot be granted per account.'
    });
  }
  return next();
};
```

Mounted on the **router**, not per route, so a route added later that forgets
`authorizeRoles` still fails closed. Mirrored in the database: **no admin role
appears in any policy** on `patients`, `visits` or their children.

The alias routers `/api/vision` and `/api/voice` reach the same controllers as
`/api/ai`, and each carries the same three guards — without them the alias would
be a way around the AI rate limiter and the admin block.

---

## 12. Current limitations

Honest and specific. Severity is engineering judgement.

| # | Gap | Severity | Detail | What closes it |
|---|---|---|---|---|
| 1 | **Formulary is unsigned** | High (clinical) | All 5 entries are `UNSIGNED_PLACEHOLDER`. `REQUIRE_SIGNED_FORMULARY` suppresses output by default in production, so the current behaviour is safe — but the capability is inert | A registered practitioner reviews and signs. **Blocked on a person, not on code** — the longest lead time in the project |
| 2 | **Triage thresholds unvalidated** | High (clinical) | NEWS2/PALS/IMNCI-derived but not reviewed for this deployment | Practitioner review. The system says so on its public pages |
| 3 | **Helmet CSP disabled** | Medium | The default policy blocks the SPA's own bundle, served from the same origin | A real per-directive policy allowing self scripts/styles and the API origin |
| 4 | **Rate limiting is in-memory** | Medium | Per process, so behind N instances the real limit is N× | A shared Redis store. Blocked on a Redis URL |
| 5 | **No token revocation list** | Medium | A JWT stays valid until it expires. 12-hour expiry is the only bound on a stolen token. `deactivateUser` bans the Supabase credential, so re-authentication fails, but an already-issued token survives | A deny-list keyed on `jti`, checked in `authenticateUser` |
| 6 | **Service-role key bypasses RLS** | Medium (by design) | Every backend query bypasses row-level security. RLS protects against direct PostgREST access with the anon key; the Express guards are what protect the API path. Documented as defence in depth — *"either one failing alone is not a breach"* | Nothing, if both layers are maintained together. The risk is drift |
| 7 | **PostgREST `.or()` filter interpolation** | Low | Not SQL injection — PostgREST parameterises — but a term with a comma or parenthesis can alter which columns match. Every such query is district-scoped, so it cannot reach another tenant | Escape or reject `,`, `(`, `)`, `.` in search terms |
| 8 | **Client-side PDF builds unescaped HTML** | Low | `generateCompletePDFReport()` interpolates patient text into an HTML string opened in a blank window. Content comes from the same clinic's staff | Delete it — the server-side PDF route already covers this |
| 9 | **`mediasoup` is not installed** | Low | So `P2PProvider` is the provider on every host. Two-peer consultations are exactly P2P's workload, so this is a scaling limit, not a security one | `npm install mediasoup@3` on a Linux host + `MEDIASOUP_ANNOUNCED_IP` |
| 10 | **No dedicated TURN server** | Medium (availability) | Falls back to a free public relay. Calls connect but on a shared tier with no capacity guarantee. TURN forwards DTLS-SRTP it cannot decrypt, so this is not a confidentiality issue | A TURN credential |
| 11 | **Only 3 protocols seeded** | Medium (clinical) | The retrieval corpus is 3 demo protocols from `seedQdrant.js` | A physician-reviewed MoHFW STG corpus — content and governance, not engineering |
| 12 | **In-memory realtime fan-out** | Medium (scaling) | `userSockets` is a per-process `Map`, so multi-replica delivery needs sticky sessions or Redis pub/sub | Redis fan-out |
| 13 | **No automated dependency scanning** | Low | No `npm audit` in CI, no Dependabot | Add both |
| 14 | **No penetration test** | Medium | The posture here is derived from code reading and the remediation record in `docs/PHASE2_PROGRESS.md`, not from an external assessment | An external test before any real patient data |
| 15 | **Aadhaar stored in the clear** | Accepted, documented | As specified. Mitigated by body-only transport, list masking, and audit redaction | The documented `aadhaar_hash` + `aadhaar_last4` migration, if the legal position changes |
| 16 | **Historical credential exposure** | Resolved in code, **not in history** | An earlier public repository committed a working `JWT_SECRET`, a ZegoCloud secret and a Supabase anon key. Both leaked JWT values are now hard-refused at boot, and RLS closed the anon-key exposure — but **scrubbing files does not remove them from git history** | Rotate every key that ever appeared in a commit or a chat transcript before any real deployment |

### What is genuinely strong

For balance, the controls that are unusually thorough for a project of this size:

- Three independent layers of district scoping, and two independent statements of
  the admin clinical lockout.
- Refuse-to-start boot checks on the JWT secret, the CORS allowlist and the
  Supabase credentials.
- A known-leaked-secret deny-list.
- Uniform failure messages on both authentication and patient existence.
- Recursive redaction of identifiers before they reach the one table oversight
  roles can read, and an append-only policy on that table.
- Private object storage with short-lived signed URLs.
- Model output treated as untrusted input, with confidence caps applied in code
  rather than only in prompts.
- A medication boundary asserted by tests that search the serialised output for
  drug names.
