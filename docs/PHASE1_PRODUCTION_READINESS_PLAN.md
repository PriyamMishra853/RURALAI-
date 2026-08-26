# RuralAI — Phase 1: Production-Readiness Plan

**Status:** Proposal, awaiting owner approval. No code has been written.
**Scope:** Architecture, stack, data model, auth, AI workflow, integrations, deployment, roadmap.
**Origin:** BOB HACKS'26 (CSJMU) Problem Statement 3, 1st Prize, Team UnfilteredEngineers.
**Target:** Live multi-device demonstration to a state governor and an AI Summit; then incubation.

---

## 0. Read this first

### 0.1 The principle everything else derives from

> **Nothing probabilistic makes a safety-critical decision alone.**
> Models generate hypotheses. Deterministic rules set floors and gates. Humans decide.

Every recommendation below is downstream of that sentence. Where a design choice trades
elegance for the ability to prove that rule holds, this plan takes the proof.

### 0.2 Six shaping decisions

These are recommendations that change the shape of everything after them. I need your
confirmation on each — they are consolidated with the rest of the open questions in §J.

| # | Decision | Recommendation |
|---|---|---|
| 1 | **Patient identifier** | **Do not use Aadhaar as the primary key.** Issue a system-generated 12-digit RuralAI Health ID with a check digit. Optional ABHA linkage. See §0.3 and §C.6. |
| 2 | **Backend** | Supabase (managed Postgres, Mumbai region) **plus** a separate Node/Express Core API. Not one or the other. See §A.3. |
| 3 | **Medicine** | Never model-authored. A clinician-signed formulary behind a rules engine, LOW tier only. See §D.2. |
| 4 | **Triage** | Monotonically escalating: `final_tier = MAX(rule_tier, model_tier)`, enforced by a database constraint. See §D.6. |
| 5 | **Offline PWA** | Defer past the Summit, but design writes to be idempotent now so it isn't a rewrite later. See §F.4. |
| 6 | **HIGH-tier "bill"** | Reframe as a referral/transfer document with clearly provisional charges. Not a payment gate. See §0.4. |

### 0.3 The Aadhaar problem — read this before anything else

Requirement 3.8 specifies Aadhaar as the patient primary key. **I recommend against it, and
this is the one place in the brief where I think proceeding as written creates real legal
exposure rather than a design trade-off.**

- The Aadhaar Act 2016 and subsequent UIDAI regulations restrict who may collect, store and
  use Aadhaar numbers, and under what authority. A private platform storing raw Aadhaar
  numbers as a database key is not a grey area.
- The Supreme Court's 2018 judgment substantially narrowed permissible private-sector Aadhaar
  use. "We're a health platform" is not, by itself, a basis.
- Storing it *hashed* does not solve it. The number space is small enough that a hash of a
  12-digit identifier is reversible by brute force in minutes. A hashed Aadhaar column is
  an Aadhaar column.
- Practically: it also breaks your own emergency-bypass requirement. A patient in an
  emergency may not have their card.

**Recommendation.** A system-issued **RuralAI Health ID (RHID)** — 12 digits, randomly
allocated rather than sequential, with a check digit (Verhoeff or Damm) so a mistyped ID is
rejected at entry instead of silently creating a duplicate patient record. Internal foreign
keys use a UUID; the RHID is the human-facing key the assistant types and the patient
remembers.

Keep an **optional** `abha_id` column for patients who already have one, reserved for future
ABDM interoperability. Never required, never the key.

This costs you nothing you actually wanted. It removes an entire category of regulatory
risk from a system you intend to show to a state government. Note that this also means the
ABHA/Ayushman card OCR fast-registration path (3.8) should extract **name, age, sex and the
ABHA number** — not the Aadhaar number printed on it.

> ⚠️ **Sign-off flag.** If you want to proceed with Aadhaar regardless, that needs a lawyer's
> written opinion, not my agreement. Tell me and I will design it, but I want the decision
> recorded as yours.

### 0.4 The HIGH-tier billing problem

Requirement 3.6 HIGH specifies "instantly generate and print a bill" as part of the emergency
referral, with the danger-zone UI cleared "after billing."

Two problems:

1. **Clinically and legally, emergency care in India cannot be conditioned on payment.**
   *Parmanand Katara v. Union of India* (1989) and subsequent rulings establish an obligation
   to provide emergency medical care irrespective of payment. A UI in which the emergency
   state does not clear until a bill is produced inverts that.
2. **Optically**, on a stage, in front of a governor: a red emergency screen that resolves
   into an invoice is the single most quotable failure mode this demo has.

**Recommendation.** Keep the artefact, change what it is. Generate a **printable referral /
transfer document** containing patient summary, vitals, AI assessment, first aid given,
receiving hospital, bed availability, location and contact. Include a charges section if you
want one, clearly marked provisional and defaulting to zero until real charge schedules are
supplied. The danger-zone state clears on **referral completion** — the document being
generated and the transfer being recorded — not on payment.

Actual charge amounts are state health policy and I will not invent them. See §J.

### 0.5 What the AI is, in one paragraph, for when you are asked on stage

RuralAI does not diagnose. It performs **structured intake** in the patient's own language,
**retrieves** matching guidance from an approved corpus of published clinical protocols,
applies a **deterministic red-flag rule layer** to decide urgency, and presents a **cited,
structured summary** to a qualified doctor who makes every medical decision. The only
medication it can ever suggest comes from a short list of over-the-counter items reviewed
and signed by a registered practitioner. It is a triage and preparation tool. Say this
sentence rather than "our AI diagnoses patients," because the second sentence is both
untrue and a regulatory problem.

---

# A. Tech Stack & Backend/Database Decision

## A.1 What we are actually optimising for

The brief names six criteria. Ranked by how much they should influence the decision:

1. **Native row-level security for the role model in 3.8.** This is first because "an admin
   must never read patient clinical data" is a *safety invariant*, not a feature. Any option
   where that is enforced only in application code means one missing conditional is a breach.
2. **Migration cost if incubated.** You are explicitly planning for this to outgrow its first
   home. An option that is cheap now and a rewrite later is expensive.
3. **True real-time sync across simultaneous clients.** Requirement 3.1 is a hard demo
   constraint, not a nice-to-have.
4. **File/image/document storage** feeding OCR and vision pipelines.
5. **Auth flexibility** — admin-provisioned only, no public signup (3.8's critical constraint).
6. **Cost at demo scale vs commercial scale.**

## A.2 Candidates against those criteria

| | Firebase | MongoDB (custom) | Appwrite | Supabase | Custom PG (self-managed) |
|---|---|---|---|---|---|
| **RLS** | Security Rules — path-based, not relational | ✗ none; app-code only | Per-document ACLs | ✅ Postgres RLS, the real thing | ✅ but you write everything around it |
| **Migration out** | ✗ worst — no SQL equivalent, every query rewritten | Moderate | Moderate | ✅ best — it's just Postgres, `pg_dump` and go | ✅ already portable |
| **Realtime** | ✅ excellent | Change streams, you build fan-out | ✅ good | ✅ good (logical replication) | ✗ build it |
| **Storage** | ✅ | ✗ build it | ✅ | ✅ policy-aware + signed URLs | ✗ build it |
| **Auth / no-signup** | ✅ custom claims | ✗ build it | ✅ | ✅ signups off, JWT claims hook | ✗ build it |
| **Cost, demo** | Free tier, then per-read | Cheap | Cheap | Free → $25/mo | Cheap + your time |
| **Cost, scale** | ⚠️ per-document reads; unpredictable | Predictable | Predictable | Predictable | Predictable |
| **India residency** | `asia-south1` | Your choice | Self-hostable | `ap-south-1` (Mumbai) | Your choice |

**Firebase is rejected** on two counts. Expressing "a doctor may read only LOW-tier cases
assigned to them, in their district, from today" in Firestore Security Rules requires
denormalising tier, district and assignment onto every document and keeping those copies
consistent — the consistency of which is now *your* problem, and it is a safety property.
Second, per-document read billing on a doctor queue with live listeners is the classic
cost surprise, and you cannot forecast it before you have usage.

**MongoDB is rejected** because it has no row-level security at all. In a system whose
headline compliance claim is "admins structurally cannot see patient data," moving that
enforcement entirely into application code is the wrong trade at any speed of development.
It also gives up referential integrity on a clinical record where referential correctness
is itself a safety property (an assessment must belong to a visit; a medication row must
point at a signed formulary rule).

**Appwrite is viable** — self-hostable, which is genuinely attractive for data residency
during incubation. It loses to Supabase on two points: per-document ACL lists are awkward
for attribute-based rules ("today", "my district", "assigned to me"), and the exit path is
less clean than "it was always Postgres."

**Custom Postgres, self-managed, is the right *destination*** and the wrong *starting point*.
Building auth, storage, realtime, pooling and backups yourself before a demo deadline spends
your budget on undifferentiated plumbing.

## A.3 Recommendation

> **Supabase (managed Postgres, `ap-south-1` Mumbai) as the data plane, plus a separate
> Node/Express "Core API" service for everything that requires trusted computation.**

Not one or the other. The split is the recommendation, and it is the most important
architectural decision in this document.

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Assistant    │  │ Doctor       │  │ Admin        │
│ (mobile/tab) │  │ (desktop)    │  │ (desktop)    │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │
       │   READS + REALTIME: anon key + the user's own JWT
       │   → Postgres RLS is what actually enforces access
       ├─────────────────┼─────────────────┤
       │                 │                 │
       ▼                 ▼                 ▼
┌──────────────────────────────┐   ┌──────────────────────────────┐
│         Supabase             │   │      RuralAI Core API        │
│  Postgres · Auth · Storage   │◀──│      (Node/Express)          │
│  Realtime · RLS              │   │  triage · AI · OCR · vision  │
└──────────────────────────────┘   │  IoT · scheduling · jobs     │
         service-role writes only  │  sockets · referral matching │
                                   └───────────┬──────────────────┘
                                               │
                                    ┌──────────┴──────────┐
                                    │ Redis               │
                                    │ BullMQ + Socket.IO  │
                                    │ adapter (fan-out)   │
                                    └─────────────────────┘
```

### Why the split rather than one or the other

**Supabase alone cannot hold this system.** The triage rule engine, LLM orchestration, OCR
pipeline, vision rubric enforcement, formulary rules engine, IoT ingest, hospital matching
and scheduled jobs all need server-only secrets and trusted computation. Edge Functions can
technically host some of it, but you lose local runnability, straightforward debugging and
the ability to test the safety-critical triage path as ordinary code — and the triage path
is the thing you least want to test awkwardly.

**Express alone means rebuilding RLS, realtime, storage and auth** to a standard you can
defend to a government audience, on a demo timeline.

So: **clients read through Supabase with the user's own JWT, so Postgres enforces access.
Writes that matter go through the Core API using the service role, and every such call site
carries an explicit authorisation check and an audit row.**

### The main trade-off, stated plainly

Two deploy targets, two mental models, and one specific sharp edge: **the service-role key
bypasses all row-level security.** A developer who reaches for `supabaseAdmin` to "make the
query work" has silently disabled the entire access-control system, and nothing will fail
loudly.

This must be a hard code-review rule, not a convention. Concretely:

- Two distinct client factories, named so the difference is unmissable: `supabaseAsUser(jwt)`
  and `supabaseAdmin`. Never a single client with a mode flag.
- Every `supabaseAdmin` call site requires an explicit authorisation check and an audit row.
- **RLS regression tests** that assert the negative: a doctor cannot read another district's
  patient; an admin's read of a clinical table returns zero rows. These tests are the only
  thing that will catch a policy regression, because the application will keep working.

## A.4 Supporting stack

| Component | Choice | Why |
|---|---|---|
| Realtime fan-out | **Socket.IO + Redis adapter** | Requirement 3.1 means multiple API instances. Without a shared adapter, a notification emitted on instance A never reaches a socket connected to instance B. This is the single most-missed requirement in "worked on my laptop" demos. |
| Job queue | **BullMQ** (same Redis) | The 5-minute consultation tolerance window is a delayed job, not a `setTimeout` — a `setTimeout` dies with the process and does not survive a deploy. |
| Validation | **Zod** | One schema per boundary, shared between route validation and typed models. |
| Security middleware | **Helmet**, **express-rate-limit with the Redis store** | In-memory rate limits are per-instance and therefore fictional behind a load balancer. |
| Logging | **Pino**, structured, with PHI redaction | Redaction must include filenames — see §B.1. |
| Image preprocessing | **Sharp** | Deskew/contrast/resize before OCR buys more accuracy than swapping OCR engines. |
| Testing | **Jest**, with fakes injected for all external APIs | CI must be free, deterministic, and must never spend AI quota. |

## A.5 What this costs

**Demo scale (per month, order of magnitude):** Supabase Free→Pro $0–25 · Upstash Redis free
tier · Core API on Render/Railway 2 instances ~$14–40 · LLM API pay-per-use ~$20–50 at demo
volume · video provider free tier. **Under ~$100/month.**

**Commercial scale:** the database is not what gets expensive. LLM inference and video
minutes dominate, and both scale with consultations rather than with patients. Budget per
consultation, not per user. This is worth modelling before any pricing conversation with an
incubator.

> ⚠️ **Cost decision flag.** Every paid tier above needs your explicit approval before I sign
> anything up. See §J.

## A.6 Reconciling this with the Phase 2 repo skeleton

**The Phase 2 brief specifies a `mongo-data/` directory, which implies a self-hosted MongoDB
backend. This plan recommends Supabase/Postgres. That is a direct conflict and the brief
asked me to flag it rather than silently pick.**

My recommendation: keep your top-level structure exactly as specified — it is a good
structure and it maps cleanly onto this architecture — with one rename:

- `mongo-data/` → **`db-data/`**, serving as the local Postgres container volume for offline
  and destructive migration testing.

Everything else in your skeleton survives unchanged: `config/`, `controllers/`,
`middlewares/`, `models/` (Zod schemas and data-access modules rather than ODM models),
`routes/`, `services/`, `sockets/`, `jobs/`, `locales/`, `tests/`, `utils/`, `docs/`,
`public/temp/`. Two additions I would ask for: `db/migrations/` and `db/seeds/` (numbered SQL
files), and `scripts/` for operational checks.

**Do not let me scaffold the DB layer until you confirm Postgres over Mongo.**

## A.7 Migrations

Numbered SQL files applied by a small runner script, tracked in a `schema_migrations` table.

**Applied migrations are immutable.** Never edit one; add a new numbered file. This is not
fussiness — once a migration has run against the Supabase project, editing the file means
your local state and the deployed state diverge silently, and you find out during the demo.

---

# B. Database & Data Model Strategy

## B.1 Design principles

1. **Visit-centric.** Everything clinical hangs off a `visit`, never directly off a patient.
   A patient who returns three times has three visits, each with its own vitals, symptoms and
   assessment. **This is what makes Model 5 (the longitudinal risk detector) possible at
   all** — a schema that overwrites a patient's current vitals has destroyed the training
   signal before you ever get to build the model.
2. **Clinical and audit data are append-only.** No `DELETE` grant, no `DELETE` policy.
   Corrections are new rows superseding old ones. Accounts are deactivated, never removed,
   so attribution on a past clinical decision survives.
3. **AI output and doctor decision are separate rows**, never one row with a status flag.
   Requirement 3 in the brief — "always clearly separate AI suggestion from doctor's medical
   decision" — is enforced structurally here, not by UI copy that a redesign can lose.
4. **Safety invariants are database constraints, not application code.** Anything that must
   be true regardless of which service wrote the row belongs in a `CHECK`, a trigger or a
   `NOT NULL` foreign key.
5. **No PHI in logs, audit metadata, notification payloads, or storage paths** — *including
   filenames*. A file named `ramesh-kumar-wound.jpg` in an object storage path is a PHI leak
   into every access log that touches it. Storage paths are opaque by construction.

## B.2 Core entities

**Geography and facilities**
`states` → `districts` → `facilities`. Three levels, because admin scoping in 3.8 is
state-wise then district-wise, and because hospital referral matching needs geography.

**Identity and staff**
`profiles` (one row per auth user, holds role and region scope) · `doctors` (specialty,
disease categories, availability, current load) · `clinical_assistants` (assigned facility) ·
`admin_scopes` (which state/district an admin may manage) · `staff_invitations` (single-use,
short-TTL tokens).

**Patients**
`patients` (UUID primary key; `rhid` as the human-facing unique key; optional `abha_id`) ·
`patient_history` · `allergies` · `consents` (what the patient agreed to, when, in which
language — a DPDP Act requirement, not a nicety).

**Encounters — the spine**
`visits` (patient, facility, assistant, opened/closed, `rule_tier`, `model_tier`,
`final_tier`, status) · `vitals` (with a `source` column: manually entered vs device-captured,
plus device provenance) · `symptom_entries` (text, onset date, duration, **original
transcript and language alongside any translation**) · `attachments` (opaque storage path,
kind: prescription / wound / lab report / ABHA card) · `attachment_extractions` (OCR or vision
output, plus a `verified_by` and `verified_at` — nothing extracted enters the clinical record
unverified).

**AI and decision layer — the safety-critical part**
`ai_assessments` (immutable: model name, model version, prompt hash, retrieved chunk IDs, raw
output, parsed output — reproducibility is a regulatory requirement) · `triage_evaluations`
(`rule_tier`, `model_tier`, `final_tier`, the specific rules that fired) · `care_plans`
(first aid steps, precautions, diet) · `care_plan_medications` (**`rule_source_id` NOT NULL**,
foreign key to `formulary_rules`) · `doctor_reviews` (outcome: approve or flag-back; a
mandatory clinical note on flag-back; the reviewing doctor; timestamp).

**Consultations and queue**
`consultations` (visit, doctor, `scheduled_at`, `tolerance_expires_at`, status, provider room
id) · `consultation_events` (joined, left, reassigned — the call is itself a clinical record).

**Referral**
`hospitals` (location, contact, specialties, bed availability, last-updated) ·
`referrals` (**a snapshot of the hospital's state at the moment of referral**, not a live
foreign key — bed counts change, and the printed slip in a patient's hand must match what
was promised when it was printed).

**Devices**
`devices` (make, model, adapter, decoder) · `device_readings` (raw payload retained alongside
the normalised value).

**Cross-cutting**
`notifications` (recipient, kind, reference id — **never PHI in the payload**) ·
`audit_log` (append-only; actor, action, target, timestamp, request id) ·
`formulary_rules` (with `signed_by` and `signed_at`) · `protocol_documents` (corpus source,
version, `approved` flag).

## B.3 Key constraints

These are the ones that carry safety weight:

- `visits.final_tier` is **not client-writable.** A client that could set its own tier could
  downgrade a HIGH-risk case.
- `CHECK (final_tier = GREATEST(rule_tier, model_tier))` — enforced in the database so that
  even a compromised service-role key cannot record a de-escalation. See §D.6.
- `care_plan_medications.rule_source_id NOT NULL` — a medication row that does not point at a
  signed formulary rule is rejected by the database. This is how "medicine is never
  model-authored" becomes structurally true rather than aspirational.
- A trigger blocking any admin role from writing any clinical table, in addition to the RLS
  policy. Belt and braces, because this is the claim you will make on stage.

## B.4 How realtime maps onto this

Three subscription surfaces:

| Subscriber | Watches | Scoped by |
|---|---|---|
| Assistant | `visits`, `notifications` | own facility |
| Doctor | `visits` (assigned queue), `consultations`, `notifications` | assigned + district |
| Admin | staff/region tables only | admin scope — **never clinical tables** |

Two design notes that matter:

1. **Realtime respects RLS when the client subscribes with the user's JWT.** That is precisely
   why the read path uses the user token. A doctor's subscription cannot leak another
   district's rows even if the client-side filter is wrong.
2. **Broadcast an identifier and a tier, not the row.** The client re-fetches through RLS.
   This keeps PHI out of the realtime transport and out of anything that logs it, and it means
   a change to the row shape does not change what goes over the wire.

## B.5 How RLS maps onto this

Per-table policies, expressed against the role and region claims carried **in the JWT** rather
than joined from `profiles` on every row check (see §B.6 for why).

The load-bearing policies:

- **Admins: zero clinical read.** Not `patients`, not `visits`, not `ai_assessments`. Managing
  staff in a district does not require seeing a named patient's record. This is the strongest
  compliance claim the system has and it costs nothing to hold.
- **Doctor:** cases assigned to them; LOW-tier review queue additionally day-scoped.
- **Assistant:** patients and visits at their own facility.
- **Auditor:** `audit_log` and aggregate counts; no clinical content.

## B.6 Where this could bite

- **RLS performance.** A policy that runs a subquery per row will be slow at scale. Mitigate
  by indexing the discriminating columns (`facility_id`, `district_id`, `assigned_doctor_id`),
  putting role/region claims into the JWT via a custom access-token hook so no join is needed,
  and marking any helper functions `STABLE`.
- **Connection pooling.** Supabase's direct Postgres host is IPv6-only, and most PaaS
  providers have no IPv6 egress. **You must use the Supavisor pooler connection string in
  deployment.** This works fine in local development and fails on deploy day, which is the
  worst possible time to discover it.
- **Migration immutability** in a team of one is easy to violate accidentally. Make the runner
  refuse to apply a file whose checksum has changed.

---

# C. Authentication & Authorization Design

## C.1 Role hierarchy

The brief specifies three roles. I recommend **eight**, and roles should be **explicit
permission sets rather than an inheritance chain** — inheritance is exactly how "admin can do
everything" quietly becomes "admin can read patient records."

| Role | Purpose | Clinical data access |
|---|---|---|
| `super_admin` | Owner/developer. Provisions state admins. Secret login. | **None** |
| `state_admin` | Manages districts, facilities and staff within one state. | **None** |
| `district_admin` | Manages staff within one district. | **None** |
| `senior_doctor` | *Recommended addition.* Signs the formulary, owns the protocol corpus, adjudicates flagged cases, reviews other doctors' decisions. | Full, within region |
| `doctor` | Reviews assigned LOW cases day-wise; conducts consultations. | Assigned cases |
| `clinical_assistant` | Registers patients, captures intake, runs assessment, acts on care plans. | Own facility |
| `auditor` | *Recommended addition.* Reads the audit log and aggregate metrics. | **None** — metadata only |
| `patient` | *Reserved, not implemented now.* Future ABDM-linked patient view. | Own records |

**Why `senior_doctor`.** Somebody must hold clinical authority over the formulary and the
protocol corpus, and that is a categorically different permission from "can see a patient."
Without this role, either every doctor can edit the formulary (unacceptable) or the developer
does it (also unacceptable, and it puts you personally in the clinical decision chain).

**Why `auditor`.** A government showcase will be asked "who watches this system." Having a
role that can demonstrate full accountability *without* clinical access is a strong answer,
and it is also the role you give a compliance reviewer during due diligence.

## C.2 Permission matrix — the load-bearing rows

| Capability | super | state | district | senior_doc | doctor | assistant | auditor |
|---|---|---|---|---|---|---|---|
| Provision staff accounts | ✅ | ✅ scope | ✅ scope | ✗ | ✗ | ✗ | ✗ |
| Deactivate staff | ✅ | ✅ scope | ✅ scope | ✗ | ✗ | ✗ | ✗ |
| View region analytics | ✅ | ✅ scope | ✅ scope | ✅ | ✗ | ✗ | ✅ |
| **Read patient record** | **✗** | **✗** | **✗** | ✅ region | ✅ assigned | ✅ facility | **✗** |
| **Write clinical data** | **✗** | **✗** | **✗** | ✅ | ✅ | ✅ | **✗** |
| Register patient | ✗ | ✗ | ✗ | ✗ | ✗ | ✅ | ✗ |
| Run AI assessment | ✗ | ✗ | ✗ | ✅ | ✅ | ✅ | ✗ |
| Review / flag back LOW case | ✗ | ✗ | ✗ | ✅ | ✅ assigned | ✗ | ✗ |
| Conduct consultation | ✗ | ✗ | ✗ | ✅ | ✅ | ✗ | ✗ |
| Issue prescription | ✗ | ✗ | ✗ | ✅ | ✅ | ✗ | ✗ |
| **Edit formulary** | ✗ | ✗ | ✗ | **✅ only** | ✗ | ✗ | ✗ |
| Read audit log | ✅ | ✅ scope | ✅ scope | ✗ | ✗ | ✗ | ✅ |

Note the two rows in bold that say ✗ for every admin. Those are the rows to point at when
someone asks what stops the platform operator from reading patient files.

## C.3 Admin-only provisioning — how it is actually enforced

Requirement 3.8's critical constraint is that doctors and assistants can **never**
self-register. Three layers:

1. **There is deliberately no `POST /auth/register` route.** Not a disabled one. Not one
   behind a flag. It does not exist.
2. **Public sign-ups are disabled at the auth provider**, so even a direct call to the
   provider's API fails. This is a dashboard setting with no code equivalent, which means it
   is invisible in code review — it must be documented in `docs/SETUP.md` and verified as part
   of the pre-demo checklist.
3. **Invitation flow, so the admin never learns the credential.** Admin creates the account →
   the system issues a single-use, short-TTL invitation token → the staff member sets their
   own password via `POST /auth/accept-invitation`.

That third point is worth more than it looks. It means a compromised admin account can create
an account but cannot silently *use* one, and it gives you non-repudiation for a doctor's
sign-off: nobody else ever held that doctor's password.

> ⚠️ **Needs a decision and a credential.** Invitation delivery requires an SMS or email
> provider. Until one is configured, the token can be returned once in the API response —
> workable for a demo, not acceptable in production. See §J.

## C.4 Session and credential handling

- Short-lived access token plus a rotating refresh token; `httpOnly`, `Secure`, `SameSite`
  cookies. Tokens are never in `localStorage`.
- **Role and region claims injected into the JWT via a custom access-token hook**, so RLS
  policies read them directly instead of joining `profiles` on every row check. This is both a
  performance and a correctness decision.
- **MFA (TOTP) mandatory for `super_admin` and `senior_doctor`**, and enforced in code rather
  than relying on a provider dashboard toggle.
- Rate limiting and audit logging on login **and on patient search** — patient search is the
  probing surface for guessing valid health IDs, and it deserves the same treatment as login.
- Accounts are deactivated, never deleted.

## C.5 The "secret admin login"

Requirement 3.8 asks for an admin login at a secret URL known only to you.

I will build it, with one honest caveat recorded here: **an unlisted URL is not a security
control.** It is presentation. It will be in browser history, in any proxy log, and in the
JS bundle if routing is client-side.

So: unlisted path **plus** mandatory MFA **plus** an IP allowlist for the demo window **plus**
an alert on every successful admin login. The unlisted path is the theatre; the MFA is the
control. Both are fine to have — just don't let the first one be mistaken for the second.

## C.6 Patient identity

As set out in §0.3: a 12-digit system-issued **RHID**, randomly allocated, check-digit
validated, with a UUID internal primary key and an optional `abha_id`. Lookup is rate-limited
and audited so that probing the identifier space is impractical and, more importantly,
*detectable*.

---

# D. AI Model Training Workflow

## D.0 The framing that makes this defensible

The brief asks for five trained models. Here is the honest position:

> **You should not train five medical models from scratch on a hackathon-to-startup budget,
> and — more importantly — you should not claim to.**

A trained model that cannot cite its source is indefensible in front of a clinician, and it
is worse than useless in front of a regulator. The architecture that *is* defensible is
**retrieval over approved protocols + deterministic rules + narrow models**, with an LLM used
as a *language interface*, not as a decision-maker.

This is not a weaker system. It is a system whose every output can be traced to a published
guideline, which is exactly what a state health department will ask for. Below, each of the
five "models" in 3.6 is specified as what it should actually be.

## D.1 Model 1 — Symptoms → preliminary differential

**Approach: RAG over an approved protocol corpus, with schema-constrained LLM reasoning.
Not fine-tuning.**

Fine-tuning bakes claims into weights you cannot cite. RAG makes every statement point at a
source document, which is the difference between "the AI said" and "the MoHFW Standard
Treatment Guideline, section 4.2, says."

- **Corpus:** MoHFW Standard Treatment Guidelines, IMNCI/IMCI, relevant WHO guidance, ICMR
  material. All publicly available. Chunked, embedded, and tagged with source, version and an
  `approved = true` flag; nothing untagged is retrievable.
- **Output shape:** a fixed schema — differential hypotheses with confidence, the protocol
  chunks each is grounded in, red flags detected, and explicit "hypotheses for clinician
  review." Never a diagnosis, never free-form prose.
- **Training data needed: none.** What you need instead is a **golden case suite** — 100–200
  hand-constructed cases with an expected tier and expected red flags. This is the real work,
  and it is also your regression gate (§D.7).
- **Validation:** parse-or-reject on the output schema; any claim not grounded in a retrieved
  chunk is dropped rather than shown.

> ⚠️ **Sign-off flag.** The retrieval corpus and the clinical framing of the prompt need a
> physician's review before this is shown to anyone as clinically meaningful.

## D.2 Model 2 — Disease → medicine

**This is not a model. It is a rules engine over a clinician-signed formulary.**

This is the highest-consequence component in the system and the one where a plausible-sounding
generated answer is most dangerous — a fabricated-but-reasonable dosage is precisely the kind
of output a health worker would act on.

- **Scope:** LOW tier only. Over-the-counter items only. **10–20 entries maximum** for demo
  scope. A short, correct formulary is worth infinitely more than a broad, unreviewed one.
- **Each rule carries:** indication, drug, form, dose banded by age and weight, maximum
  duration, contraindications, interactions, pregnancy/lactation flags, red-flag exclusions,
  and `signed_by` + `signed_at` naming the practitioner who approved it.
- **Sources:** the WHO Model List of Essential Medicines and India's National List of
  Essential Medicines, constrained by what is genuinely OTC under the Drugs and Cosmetics
  Rules.
- **Enforcement:** `care_plan_medications.rule_source_id NOT NULL` (§B.3). The database
  rejects a medication that did not come from a signed rule.

> 🚨 **Hardest flag in this document. This cannot ship without a registered medical
> practitioner reviewing and signing the formulary. There is no technical substitute, and it
> has the longest lead time of anything in the project. Start finding that clinician before
> any code is written.**

> 🚨 **Conflict with the brief.** Requirement 3.6 LOW describes medication as "queued for daily
> doctor review." If the assistant *dispenses* before that review happens, that is an AI system
> effectively prescribing without a practitioner in the loop, which is not defensible under the
> NMC Telemedicine Practice Guidelines 2020. Two acceptable resolutions:
> **(a)** restrict the list to items a trained health worker may already dispense under standing
> orders, with the doctor's review as a record rather than a gate — workable for demo scope; or
> **(b)** require doctor approval *before* dispensing.
> I recommend (a) for the Summit and (b) as the commercial posture. **This needs your decision
> and the clinician's agreement.**

## D.3 Model 3 — Wound image → extent of injury

**Approach: an API-based vision model constrained to a fixed clinical rubric, behind a
deterministic escalation gate. Not a trained CNN.**

You do not have a labelled dataset of rural wound photographs, and building one is roughly a
year of work with an ethics process attached. What you can do now is constrain a capable
vision model tightly enough that its output is auditable.

- **Rubric, not free text.** Fixed fields only: wound type, approximate size band, depth
  indication, signs of infection, foreign body visible, active bleeding, surrounding tissue
  condition. The model fills a form. It does not narrate a diagnosis.
- **Deterministic gate on top.** Any infection sign, any depth beyond superficial, or any
  location on face / hand / genitals / over a joint → escalate, **regardless of model
  confidence.** The gate is not advisory.
- **Validation reality check:** vision models correctly refuse to score synthetic or
  illustrated images — they will tell you it appears to be a graphic. **A wiring test proves
  wiring only. You learn nothing about clinical behaviour until you test on real wound
  photographs.**

> ⚠️ **Sign-off flag.** Real wound images require patient consent and, for anything you intend
> to publish or train on, an ethics process. Do not shortcut this with images scraped from the
> internet — provenance matters and you will be asked.

**Commercial path:** collect consented, clinician-labelled images through the deployed system,
then fine-tune a narrow classifier for *severity banding only* — not diagnosis.

## D.4 Model 4 — Test/report analysis

**Approach: OCR → deterministic parsing → reference-range comparison. The LLM only
summarises values that have already been extracted deterministically.**

This is the most important "never do the obvious thing" in the document. **Never let a
language model read a lab report image and report the numbers.** A hallucinated haemoglobin
value is the highest-consequence failure mode in this entire system, and it will look
completely plausible.

- **Parse:** analyte name normalised (map to LOINC where practical), value, unit, and the
  reference range **as printed on the report itself** rather than from a hardcoded table —
  ranges vary by lab and by method.
- **Flag out-of-range deterministically**, before any model sees it.
- **Anything unparseable is surfaced as "could not read — verify manually."** Never silently
  dropped, never guessed.
- **Mandatory human verification**, side-by-side original and extracted fields, as the brief
  already requires. Nothing enters the clinical record unverified.

> ⚠️ **Needs real data.** Lab report layouts vary enormously between facilities, and this is
> the difference between 95% and 40% extraction accuracy. I need **sample report layouts from
> your actual target facilities.** See §J.

## D.5 Model 5 — Longitudinal risk detector

**Approach: rule-based trend analysis first, classical ML later. Not deep learning.**

You will have hundreds of visits, not millions. A deep model on that data would be
unfalsifiable and would overfit immediately.

- **Features:** vitals trajectories (blood pressure trend, SpO₂ trend, weight change,
  recurring fever), symptom recurrence patterns, visit frequency, apparent medication
  non-response, age and comorbidity flags.
- **v1 — deterministic and explainable.** For example: the same unresolved symptom across
  three visits within 60 days escalates; blood pressure sustained above threshold across
  visits raises a hypertension-risk flag. Explainable, defensible, and it works at n=200.
- **v2 — post-data.** A gradient-boosted model over engineered features, with the v1 rules
  retained as a floor. Never replacing them.

**This model is entirely dependent on the visit-centric schema in §B.1.** If clinical data is
stored as "the patient's current state" rather than as a series of visits, Model 5 is not
buildable later — the signal was destroyed at write time. This is why that schema decision
appears first.

## D.6 The triage classifier — the safety core

This is the most important subsystem in the platform. Its structure:

**Two independent paths, and a maximum.**

1. **Deterministic rule layer.** Age-banded red-flag thresholds derived from published scores
   (NEWS2 for adults, IMCI and PALS for children): SpO₂ below threshold, systolic BP outside
   range, temperature extremes, respiratory rate by age band, altered consciousness, chest
   pain, bleeding in pregnancy, fever in an infant under two months, and so on.
2. **Model layer.** The output of §D.1, mapped to a tier.

```
final_tier = MAX(rule_tier, model_tier)
```

**Rules set a floor. A model may raise a tier and can never lower one.**

Enforced as a **database CHECK constraint**, not application code — so that even a compromised
service-role key cannot record a de-escalation. This is the single most important line in the
schema.

Three fail-safe behaviours:

- **Degraded AI floors at MEDIUM, never LOW.** Timeout, malformed output, no model configured,
  provider outage — all of these produce MEDIUM. A system that returns LOW when the AI is down
  is a system that returns LOW at exactly the wrong moment.
- **Missing data escalates.** Absent vitals, unknown age, incomplete registration all raise
  the tier. Absence of evidence is not evidence of absence.
- **Ties escalate.** Where a rule is ambiguous, it resolves upward.

> ⚠️ **Sign-off flag.** The specific thresholds are drawn from published scoring systems but
> **are not validated for this population or this deployment.** They must be reviewed by a
> clinician. Until they are, every assessment carries an `unvalidated` stamp and the
> application carries a visible "not for clinical use" notice — **including during the
> governor demo.** Showing an unvalidated clinical tool without that notice is the kind of
> detail that turns a success into an incident.

## D.7 Validation before anything reaches a doctor or a patient

- **Schema-constrained generation.** Parse-or-reject, retry N times, then fail safe to MEDIUM.
- **Golden case suite as a CI gate.** A change that flips a golden case's tier fails the build.
  Write this suite *before* the triage engine, not after.
- **Full reproducibility persisted:** model name, version, prompt hash, retrieved chunk IDs,
  raw output. If a clinician disputes an assessment six months later, you must be able to
  reconstruct exactly what happened. This is a regulatory expectation, not an engineering
  nicety.
- **Prompt injection is a live threat here, not a theoretical one.** Symptom free-text and —
  especially — OCR'd document content flow into prompts. An uploaded "prescription" containing
  instruction-shaped text is a realistic attack, and in a clinical context the payoff is
  changing a triage tier. **All extracted text is untrusted data and must never be
  concatenated into a prompt as instructions.**
- **Human in the loop is structural.** No tier bypasses a human. LOW is reviewed, MEDIUM is
  consulted, HIGH is referred.

## D.8 Demo-credible → clinically defensible

| Stage | What is true | What is required |
|---|---|---|
| **Summit demo** | Published-source corpus, golden suite passing, fail-safe behaviour verified, no real patient data | `unvalidated` stamp, "not for clinical use" notice, clearly-labelled placeholder data |
| **Pilot** | Clinician-signed formulary and thresholds | Retrospective validation against chart-reviewed cases; **measured sensitivity for HIGH-tier detection** — you care far more about recall on emergencies than precision; institutional/ethics approval |
| **Commercial** | Evidence base and audit trail | **CDSCO Software-as-a-Medical-Device determination** — a triage and clinical-decision-support tool is plausibly a regulated device class in India, and that call needs a regulatory consultant rather than a developer's reading; DPDP Act 2023 data-fiduciary obligations (consent, purpose limitation, breach notification, grievance officer); Clinical Establishments Act implications for the facilities involved |

> 🚨 **Flag.** The regulatory determination is not a formality to handle after product-market
> fit. If RuralAI is classified as a medical device, that shapes the architecture, the claims
> you may make in a pitch deck, and the validation evidence you must retain — retroactively.
> Get the read early, while changing course is still cheap.

---

# E. Video, Voice, OCR & IoT Integration Plan

## E.1 Multilingual STT / TTS / translation

**Recommendation: Bhashini as primary for Indian languages, with a commercial fallback.**

- **Why Bhashini:** it is the Government of India's national language mission, purpose-built
  for Indian languages and dialects, and free or subsidised. In a demo to a state government,
  building on national digital public infrastructure is itself an asset — it is a better
  answer than "we use an American API."
- **Trade-off:** less mature SDKs, more variable latency, and registration lead time.
- **Why a fallback is mandatory:** a live demo cannot depend on a single external service.
  Build an adapter interface with runtime provider selection; a commercial STT (Google Cloud
  Speech, or a hosted Whisper) sits behind the same interface.
- **TTS matters as much as STT** — the assistant reads first-aid steps back to the patient in
  their own language. Do not treat it as the lesser half.
- **Always keep the original transcript alongside any translation.** The clinical record is
  the original utterance; the translation is a convenience for the doctor. A record that
  stores only the translated form has lost evidence.

**One design caveat that is worth more than the provider choice:** medical terminology
transcribes poorly in low-resource Indian languages. **Prefer structured-entry-with-voice-assist
over free-form voice → LLM.** Voice fills known symptom fields; it does not narrate freely into
a model. This collapses the failure surface dramatically and makes the demo far more reliable.

> ⚠️ **Needs credentials and a decision.** Bhashini registration; fallback provider account;
> and which languages we are demonstrating. See §J.

## E.2 Video consultation — build vs buy

**Recommendation: buy, via LiveKit. Not raw WebRTC, and not Zoom/Meet.**

**Why not raw WebRTC.** You would need signalling, STUN and TURN infrastructure, an SFU for
anything multi-party, network resilience over rural connectivity, and mobile browser quirk
handling. That is the entire engineering budget of this project spent on undifferentiated
plumbing that a provider has already solved.

**Why not Zoom or Google Meet.** They take the user out of your application. You lose session
control, you cannot reliably tie call lifecycle events back to the clinical record, and the
consultation happens outside your audit trail. **In a clinical system, the call is a record** —
who joined, when, for how long, and what was decided. Handing that to an external product you
cannot query is the wrong trade, even though it is the fastest one.

**Why LiveKit specifically.** Open-source core with a managed cloud option. If incubation or a
government partner demands that media stay in-country on your own infrastructure, you
self-host without changing application code. That is the same migration-path argument that
selected Postgres in §A.2, applied to the second-most-coupled piece of the system.

*(100ms, Twilio Video and Daily are all reasonable alternatives on the same "buy" side of the
argument. The open-source-core property is what breaks the tie.)*

### The 5-minute tolerance window and notifications

**These are yours regardless of which provider you pick** — no video vendor implements your
scheduling policy. Design:

1. Consultation scheduled → **both parties notified over Socket.IO**, with a push/SMS fallback
   for a doctor who does not have the tab open.
2. At start time, a **BullMQ delayed job** opens the tolerance window. A delayed job rather
   than a `setTimeout`, because a `setTimeout` dies with the process and does not survive a
   deploy — and a deploy on demo day is not hypothetical.
3. If the doctor has not joined within **5 minutes**, the job fires reassignment to the next
   available doctor in the same disease category and re-notifies both parties.
4. **One active call per doctor is enforced by a database constraint** on doctor plus
   overlapping time window — not by UI state. UI state does not survive two browser tabs.

**Doctor selection / load balancing** (requirement 3.6 MEDIUM): disease-category match first,
then current active load, then online status, then round-robin as the tiebreak.

## E.3 OCR — prescriptions, reports, ABHA cards

**Two tracks, chosen per document:**

- **Tesseract locally** for printed text — cheap, no per-call cost, runs offline, and performs
  well on clean printed lab reports.
- **A vision model for handwriting.** Indian handwritten prescriptions are genuinely hard and
  Tesseract will not do it.

**Preprocessing with Sharp — deskew, contrast normalisation, resize — buys more accuracy than
switching OCR engines.** Do that work before reaching for a more expensive model.

**Mandatory human verification is non-negotiable** and is already in your brief: side-by-side
original and extracted fields, assistant confirms before anything persists. **Never auto-commit
OCR output into a clinical record.**

**ABHA / Ayushman card capture** for fast registration extracts name, age, sex and the ABHA
number. Per §0.3, it does **not** extract or store the Aadhaar number printed on the card.

**Treat all extracted text as untrusted input** — see the prompt-injection note in §D.7.

## E.4 IoT — oximeter and thermometer, extensibly

**Recommendation: Web Bluetooth in the browser for the demo, behind a four-layer device
abstraction that makes future hardware a registration rather than a rewrite.**

```
1. Transport adapters    Web Bluetooth now; native BLE bridge, serial, or
                         gateway later. One interface.
2. Profile decoders      Standard GATT: Pulse Oximeter Service (0x1822),
                         Health Thermometer Service (0x1809), plus
                         IEEE 11073-20601 personal health data decoding.
3. Device registry       make/model → adapter + decoder.
4. Normalised reading    written to device_readings, linked to the visit,
                         with provenance: device id, timestamp, raw payload.
```

**Why the standard profiles matter.** Any oximeter that implements service `0x1822` works with
zero new code. That is requirement 3.4's "ports and hooks for future hardware" satisfied
properly, rather than as a one-off integration wearing an abstraction as a costume.

**Procedure for adding a new device** (this is the answer to "provide an approach for
integrating this class of hardware"):

1. Pair the device and dump its GATT services — nRF Connect on a phone does this in a minute.
2. If it implements a standard profile: register make/model against the existing decoder.
   **Done. No code.**
3. If it uses a vendor-proprietary characteristic: write a decoder implementing the same
   interface, register it. Nothing outside the decoder changes.
4. Add a golden-sample test with a captured raw payload so the decoder has a regression test
   that does not require the physical device.

**Two hard constraints to plan around:**

- **iOS Safari does not support Web Bluetooth.** The IoT portion of the demo must run on
  **Android or desktop Chrome.** Discover this now, not on stage.
- **Manual vitals entry must always remain available.** A device that will not pair under
  venue conditions cannot be allowed to block the demo — or, later, block a patient's care.

**Mark reading provenance** — device-captured versus manually entered — on every vital. A
clinician reviewing a case should know which numbers a machine produced.

> ⚠️ **Needs hardware details.** Exact make and model of your oximeter and thermometer, and
> confirmation of the Android/Chrome demo device. See §J.

---

# F. Frontend / UX Approach

## F.1 Framework recommendation

**React + Vite, single-page app, served by the same Express process. Tailwind for styling,
Framer Motion for animation, React Three Fiber for the 3D.**

**Why not Next.js.** Server-side rendering buys little here: every meaningful screen is behind
authentication and is live-data-driven. SSR adds a second runtime to deploy and complicates
the "one service serves both API and app" property that makes a multi-device demo reliable —
one origin, no CORS surprises, one deploy, one thing that can be down.

**The trade-off, stated:** worse SEO on the public landing page. That matters for marketing
later; it does not matter for the Summit. If it becomes a priority, split the landing page
out as a static or Next-rendered site without touching the application.

**React Three Fiber rather than raw Three.js** — it keeps the scene declarative and inside
React's lifecycle, so it disposes properly on route changes. Raw Three.js in a long-running
SPA leaks GPU memory across navigations, and a demo session is exactly the long-running case.

## F.2 Performance discipline — this is a live demo, not a portfolio piece

The 3D and background video belong **on the landing page, not in the clinical workflow.** A
doctor's queue must be instantaneous; an assistant capturing vitals must not wait on a shader.

- Lazy-load the heavy scene; never block first paint on WebGL.
- Respect `prefers-reduced-motion`.
- Cap `devicePixelRatio` — an uncapped retina render on a venue laptop will drop frames.
- Ship a static-poster fallback for machines where WebGL is unavailable or blocked.
- **Rehearse on the actual venue hardware and network.** Not on your development machine.

## F.3 The three surfaces

| Surface | Primary device | Design priorities |
|---|---|---|
| **Assistant** | Mobile / tablet | Field conditions: large touch targets, high contrast for outdoor sunlight, possibly one-handed or gloved operation, minimal typing. The recency stack of the last 5–10 patients (3.9) is the landing view. |
| **Doctor** | Desktop | Density and speed. Queue in priority order, keyboard-navigable, live-syncing across sessions and devices. |
| **Admin** | Desktop | Tables, drill-down from state → district, no clinical content anywhere. |

## F.4 Tier visual language

| Tier | Treatment |
|---|---|
| **LOW** | Calm, green/neutral. A structured card: first aid steps, patient details, medication clearly marked *pending doctor review*, point-wise precautions, optional diet. |
| **MEDIUM** | Amber, action-forward. The scheduling affordance is the primary element on the screen — everything else recedes. |
| **HIGH** | The **danger zone**: red treatment, but *designed*, not merely red. A persistent banner plus a constrained layout that removes non-essential actions, so the screen physically funnels toward referral. Clears on referral completion (§0.4), not on payment. |

**Two accessibility requirements that are also correctness requirements:**

1. **Colour alone must never carry the tier.** Icon, plus text label, plus colour. Colour-blind
   users need this, and so does the printed referral slip, which may be photocopied in
   greyscale.
2. **Pair the red state with an explicit label** — "EMERGENCY — REFER NOW". A red screen reads
   as "error" to a meaningful fraction of users, which is precisely the wrong interpretation.

## F.5 AI / doctor separation must be structural

Requirement: "always clearly separate AI suggestion from doctor's medical decision."

In the UI this means **distinct panels with distinct typography**, an explicit *"AI suggestion —
not a diagnosis"* label on every AI-produced block, and the doctor's decision rendered as a
separate, attributed, signed record. **Never a single merged card with a status badge** — a
redesign will eventually lose the badge, and the separation must survive a redesign. It is
backed by the schema decision in §B.1 principle 3, which is what makes it durable.

## F.6 Localisation and offline

- Locale files for all UI strings; no hardcoded English in components.
- **Verify font glyph coverage for Devanagari and every other target script.** A missing glyph
  rendering as a tofu box on a governor's screen is memorable for the wrong reason, and it is
  a five-minute check.
- **Offline PWA: recommend deferring past the Summit.** Rural connectivity argues for it, but
  conflict resolution on clinical data is genuinely hard and it is a large body of work.
  **Design for it now at near-zero cost:** make writes idempotent with client-generated UUIDs,
  so a queued-and-replayed write cannot duplicate a patient. That single discipline is the
  difference between adding offline later and rewriting for it later.

---

# G. Deployment & Hosting Plan

## G.1 Tier 1 — Governor / AI Summit showcase

Optimised for: fast to stand up, reliable under live multi-device conditions, low cost.

| Component | Choice | Note |
|---|---|---|
| Data plane | **Supabase, `ap-south-1` (Mumbai)** | Data residency answer ready for the obvious question |
| Core API | **Render or Railway, minimum 2 instances** behind the platform load balancer | Two instances is not padding — see below |
| Redis | **Upstash** (`rediss://`, TLS) | Socket.IO adapter + BullMQ |
| Frontend | **Built and served by the same Express process** | One origin, one deploy, no CORS |
| Video | LiveKit Cloud free/starter tier | |

**Why two instances is mandatory rather than aspirational.** Requirement 3.1 explicitly calls
for load balancing, and more practically: **a single instance will hide the socket fan-out
bug.** With one instance, everything works. With two, a notification emitted on instance A
never reaches a doctor connected to instance B — unless the Redis adapter is correctly wired.
You want to find that in staging, not when the doctor's laptop stays silent on stage.

**The deploy-day trap, stated once more because it is the most likely failure:** use the
**Supavisor pooler connection string**, not the direct Postgres host. The direct host is
IPv6-only; most PaaS providers have no IPv6 egress. It works locally and fails on deploy.

**Demo-day checklist worth writing down:**

- Rehearse on the venue network; carry a mobile hotspot as a fallback.
- Pre-warm instances — cold starts are a bad first impression.
- Seed data loaded and verified the night before, all of it clearly labelled as placeholder.
- A tagged rollback point, and a tested rollback.
- **A scripted fallback if an AI provider is down.** The system fails safe to MEDIUM (§D.6),
  so make sure your demo narrative does not depend on producing a LOW result.
- **Rotate every key before the event.** See §J.

**Cost: roughly $50–100/month.**

## G.2 Tier 2 — Post-incubation production

| Concern | Approach |
|---|---|
| Database | Managed Postgres with read replicas and point-in-time recovery. Supabase Pro/Enterprise, or self-managed on an India region if a partner demands it |
| Compute | Containers on ECS/EKS or the Azure equivalent, autoscaled behind an ALB |
| Cache/queue | Managed Redis (ElastiCache or equivalent) |
| Storage | Object storage with lifecycle policies and encryption at rest under customer-managed keys |
| Observability | OpenTelemetry traces, centralised structured logs with **PHI redaction verified by test**, SLO-based alerting |
| Media | Self-hosted LiveKit if residency requires media to stay in-country |
| Compliance | DPDP Act data-fiduciary obligations, consent records, retention policy, breach runbook, external penetration test, CDSCO determination |

## G.3 Migration path — why it is not a rewrite

The value of the Tier-1 choices is that each has a clean exit. There are exactly **three
coupling points**, and each is mitigated by keeping a real adapter from day one:

1. **Database — not a coupling.** It is plain Postgres. `pg_dump`, restore, re-point the
   connection string. RLS policies are SQL and travel with the schema.
2. **Auth — the real coupling.** Mitigate by keeping auth behind a thin internal interface and
   never scattering provider-specific calls through controllers. If that discipline holds,
   swapping the auth provider is one module.
3. **Realtime — the second coupling.** Mitigate by having clients subscribe through *your*
   abstraction rather than calling the provider's realtime SDK directly throughout the
   frontend. If you leave Supabase, the Socket.IO layer already exists and absorbs the job.

**Budget the migration as "swap three adapters and re-point a connection string" — and then
enforce that estimate by keeping those three adapters real from the first commit.** An adapter
written after you need it is a rewrite; an adapter written before is a seam.

---

# H. Claude Code Tooling Recommendations

## H.1 Skills and plugins worth enabling

| Tool | Use here |
|---|---|
| **`superpowers`** — brainstorming, writing-plans, TDD, systematic-debugging, verification-before-completion | The TDD and verification skills matter most: a clinical triage engine is precisely where "I think it works" is unacceptable. |
| **`supabase` + `supabase-postgres-best-practices`** | Load before writing any schema, RLS policy or migration. RLS is easy to write and hard to write *correctly*. |
| **`ui-ux-pro-max` / `design`** | The presentation-grade frontend in §F. |
| **`playwright` MCP** | End-to-end tests for the multi-device flows. Worth the setup: "two assistants and a doctor, concurrently" is the demo's core claim and **cannot be verified by unit tests**. |
| **`context7` MCP** | Current docs for LiveKit, Supabase and Socket.IO — all of which move faster than any model's training data. |
| **`/code-review` and `/security-review`** | Run both before demo day. `/code-review ultra` gives a deep multi-agent pass; note it is user-triggered and billed, so you launch it, not me. |

> **Note:** the Supabase MCP server requires OAuth authorisation, which cannot be completed in
> a non-interactive session. Authorise it via `claude mcp` or `/mcp` in an interactive
> terminal — or skip it entirely, since migrations as numbered SQL files work fine without it.

## H.2 Reference repositories worth reading

Verify each against its current state before depending on it.

- **`medplum/medplum`** — open-source FHIR-native healthcare platform. The best available
  reference for clinical data modelling and healthcare access control.
- **`openmrs/openmrs-core`** — long-running open-source EMR; particularly strong on the
  visit/encounter model that §B.1 depends on.
- **`hapifhir/hapi-fhir`** — reference FHIR implementation. Useful even if you do not adopt
  FHIR wholesale.
- **Bahmni** — hospital system built on OpenMRS with real Indian deployment experience. Read
  it for deployment reality rather than for code.
- **`livekit/livekit`** and its example apps — call lifecycle handling, which is the part you
  actually have to get right.
- **`supabase/supabase`** — the `examples/` directory, specifically for RLS policy patterns.

**One strong recommendation from this list:** adopt **FHIR resource shapes** (Patient,
Encounter, Observation, Condition, MedicationRequest) as your internal model, even without
full FHIR compliance. It costs very little now, and it makes ABDM interoperability and any
future hospital integration dramatically cheaper. It is also a credible answer when a health
department asks how you would integrate with existing systems.

## H.3 Practical tips for building this out

- **Keep a numbered, dated `docs/DECISIONS.md`, including reversals.** In this project, "why
  is this threshold 39.5" is a question you will get from a clinician, an investor, and
  yourself in three months. A decision log is the single highest-leverage document in a
  regulated-adjacent build.
- **Update `SYSTEM_ARCHITECTURE.md` in the same commit as the change it describes.** A stale
  architecture document is worse than none, because people trust it.
- **Keep "check" scripts that hit the real external APIs, separate from the test suite.** Jest
  injects fakes so CI is free, deterministic and never spends AI quota; the check scripts are
  how you catch wiring bugs that no unit test can see.
- **Write the golden triage case suite before the triage engine.** It is the specification.
- **Never reach for the service-role key to make a query work.** Fix the policy. This is the
  one rule most likely to be violated under deadline pressure, and violating it silently
  disables the system's entire security model.
- **Work in small, committed increments.** A demo deadline makes long-lived uncommitted work
  extremely expensive.

---

# I. Phased Build Roadmap

Ordered phases, not dates. Each produces something demonstrable.

| Phase | Deliverable | Why here |
|---|---|---|
| **0 — Unblock** | Credentials, provider accounts, **clinician engaged**, language decision, device models confirmed | The clinician has the longest lead time of anything. Start before code. |
| **1 — Foundation** | Repo skeleton, env validation, health endpoints (`/live` and `/ready` separate), logging with PHI redaction, CI, Docker | Separate liveness from readiness: a liveness probe that checks the DB restarts every instance during a brief blip, turning a small problem into an outage. |
| **2 — Identity & roles** | Auth, 8 roles, JWT claims hook, invitation flow, RLS policies, **RLS regression tests**, audit log | Everything downstream reads through RLS. Get it right before there is data to leak. |
| **3 — Clinical capture** | Patients, visits, vitals, symptoms, attachments with signed URLs, multi-file upload from camera or file manager | The visit-centric spine (§B.1). |
| **4 — Triage engine** | Rule layer, golden case suite, DB constraints for monotonic escalation, fail-safe behaviour | **Highest-risk component. Build it before any LLM work** — it is the floor everything else sits on. |
| **5 — AI assessment** | Corpus ingestion, schema-constrained assessment, care plans, formulary rules engine | Depends on Phase 4's floor existing. |
| **6 — Realtime & doctor portal** | Socket.IO + Redis adapter, notifications, doctor review loop with flag-back | First point at which requirement 3.1 is genuinely testable. Deploy two instances here. |
| **7 — Consultation** | Scheduling, tolerance-window job, reassignment, LiveKit, doctor-issued prescription PDF | |
| **8 — Multimodal** | OCR with mandatory verification, wound vision with rubric and gate, lab parsing, voice intake | |
| **9 — HIGH-tier referral** | Hospital data, matching, snapshot, printable referral document (§0.4) | |
| **10 — Presentation** | Landing page, 3D, animation polish, responsive pass, accessibility pass | Late deliberately. Polish on top of a working system; never the reverse. |
| **11 — Demo hardening** | Multi-instance deploy, concurrent load test, venue rehearsal, fallback scripts, seed data, **key rotation** | |
| **12 — Commercialisation** | Clinical validation study, regulatory determination, DPDP compliance, penetration test, offline PWA, ABDM integration, IoT with real hardware | Post-Summit. |

**IoT (Phase 3.4) placement note:** the device abstraction layer is cheap and should land with
Phase 3 (vitals). The *hardware* integration needs your physical devices and should be
scheduled once those are in hand — it is a poor fit for the critical path because it can be
blocked by a pairing quirk you cannot fix in software.

---

# J. What I need from you

Consolidated, so it is answerable in one pass.

## J.1 Blocking — needed before Phase 2 starts

1. **Confirm Postgres/Supabase over MongoDB**, and the `mongo-data/` → `db-data/` rename (§A.6).
2. **A Supabase project** in `ap-south-1` (Mumbai): project URL, `anon` key, `service_role`
   key. Free tier, no card, a few minutes to create. This is the one setup step I cannot do
   for you.
3. **Decision on the Aadhaar → RHID recommendation** (§0.3). If you want Aadhaar retained, that
   needs a lawyer's written opinion.
4. **Decision on the HIGH-tier billing reframe** (§0.4).
5. **The truncated Phase 2 brief** — your message cut off mid-sentence in §2 of the Phase 2
   feature manifest, at "Doctor (day-wise review of assigned LOW cases…". I have the rest from
   the Phase 1 sections, but send the remainder so I am not inferring your requirements.

## J.2 Credentials and accounts — you asked me to list these once

Everything I will need, in one place. **I will not sign up for any paid tier without your
approval.**

| Need | For | Note |
|---|---|---|
| Supabase URL + anon key + service_role key | Data plane | Free tier sufficient for demo |
| LLM provider API key | §D.1 assessment | Tell me the provider and whether you hold credits |
| Vision model API key | §D.3 wound analysis | May be the same provider |
| Bhashini credentials | §E.1 STT/TTS | Registration has lead time — start early |
| Fallback STT provider key | §E.1 | Reliability, not optional for a live demo |
| LiveKit API key + secret | §E.2 video | Or your chosen alternative |
| Redis URL | Socket.IO adapter + BullMQ | Upstash free tier; **must be `rediss://`** |
| SMS or email provider | §C.3 invitation delivery | Also powers consultation notifications |

## J.3 Data I will not fabricate

Per your own Phase 2 rule, and I agree with it: I will use **clearly labelled placeholder
data** and flag every instance, until you supply real sources.

6. **Hospital data** — district hospital list, locations, contacts, bed availability source
   (§B.2 `hospitals`). Or explicit approval to run labelled placeholder data for the demo.
7. **Doctor roster** — 3.8 asks for 10 doctors per district with Indian-origin names. I will
   generate these as clearly-marked `PLACEHOLDER_DEMO` records with non-dialable phone numbers
   unless you supply real ones. Confirm that is acceptable.
8. **Sample lab report layouts** from your target facilities (§D.4) — this materially changes
   extraction accuracy.
9. **Charge schedule** for referral documents (§0.4) — state health policy, defaults to zero
   and flagged provisional until supplied.

## J.4 Decisions with cost or scope implications

10. **Demo languages** — Hindi and English, plus a regional language? (§E.1)
11. **Video provider confirmation** — LiveKit, or a preference? (§E.2)
12. **Oximeter and thermometer make and model**, and confirmation of an Android or desktop
    Chrome demo device — **not iOS** (§E.4).
13. **Confirm offline PWA is deferred** past the Summit (§F.6).
14. **Hosting tier approval** for the two Core API instances (§G.1).

## J.5 Clinical and regulatory sign-off — the critical path

These are flagged per your instruction to call out anywhere the plan depends on medical
sign-off. **None of them are engineering problems, and none of them can be solved by working
harder on the code.**

| # | Item | Urgency |
|---|---|---|
| 15 | **A registered medical practitioner to review and sign the OTC formulary** (§D.2) | 🚨 **Longest lead time in the project. Start now.** |
| 16 | **Physician review of the triage thresholds** (§D.6) | 🚨 Before any claim of clinical validity |
| 17 | Physician review of the retrieval corpus and clinical prompt framing (§D.1) | Before the demo |
| 18 | **Decision on LOW-tier dispense-before-review** vs NMC Telemedicine Practice Guidelines 2020 (§D.2) | 🚨 Blocking the care-plan design |
| 19 | Consent and ethics process for real wound images (§D.3) | Before collecting any |
| 20 | **CDSCO / Software-as-a-Medical-Device determination** by a regulatory consultant (§D.8) | Before commercial deployment — but get the read early, while course changes are cheap |
| 21 | DPDP Act 2023 data-fiduciary obligations — consent, retention, breach process, grievance officer (§D.8) | Before any real patient data |
| 22 | **"Not for clinical use" notice must be visible — including during the governor demo** (§D.6) | Non-negotiable |

**One closing note on framing.** Item 22 is not a disclaimer to bury in a footer. Showing a
state governor a clinical triage system that carries an honest, visible statement of its
current validation status is *stronger*, not weaker — it demonstrates that the team understands
what clinical software requires. A system presented as more validated than it is invites
exactly one question you cannot answer well.

---

*End of Phase 1. No code has been written. Awaiting your review and explicit go-ahead before
Phase 2.*
