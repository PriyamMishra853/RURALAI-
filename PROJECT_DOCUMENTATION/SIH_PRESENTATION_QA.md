# SIH 2026 — Final Presentation Q&A

**Team UNFILTEREDENGINEERS · PS 26133 · Government of Maharashtra**
*Accessibility and quality of public healthcare services in rural and underserved areas*

Repository: `github.com/PriyamMishra853/RURALAI-` · Frontend: `ruralai-psi.vercel.app` · API: `ruralai-production-220.up.railway.app`

---

## How to use this document

Sixty questions a technical panel is likely to ask, grouped by theme. Every number in
here is measured or read from the code, not estimated — where a figure is a
measurement, the method is stated so you can defend it.

**The last section (Q51–Q60) is the important one.** Those are the questions designed
to catch you out, and several have answers that admit a limitation. Answer them that
way. A panel that finds a weakness you already named treats you as credible; a panel
that finds one you hid stops believing the rest.

---

# Part 1 — Problem fit and positioning (Q1–Q6)

### Q1. In one sentence, what does your system do?

It lets a trained health worker at a village sub-centre prepare a complete, structured
clinical case — identity, symptoms, vitals, transcribed paper records, wound
photographs and an AI risk assessment — and put a remote registered doctor in front of
that case within minutes, over a video call, with the doctor's decision returning to
the health worker's screen in real time.

The design principle everything else follows from: **the AI prepares the case, the
doctor makes the medical decision.** That is not a slogan; it is enforced in code at
nine separate boundaries, tested, and traceable to Indian medical law (Q19–Q24).

### Q2. The PS lists ten capabilities. Which have you built?

| PS capability | Status |
|---|---|
| Assisted teleconsultation | Built — scheduled + instant, mediasoup SFU with P2P fallback |
| Appointment / queue management | Built — 5-min slot engine, 7-day strip, doctor queue worst-first |
| Digital triage | Built — 4 tiers, deterministic rule engine + statistical model + LLM |
| Longitudinal patient records | Built — Aadhaar-keyed, visit history, documents, images |
| Referral tracking | Built — `referrals` table, audited, capability-ranked |
| Diagnostic coordination | Partial — lab report OCR + interpretation; no LIS integration |
| Medicine availability | Partial — formulary rules engine + molecule index; no live stock feed |
| High-risk follow-up | Partial — tier drives queue; no recall scheduler |
| Facility dashboards | Built — admin analytics aggregated in the database |
| Emergency escalation | Built — EMERGENCY tier bypasses the queue to referral |

Six built, four partial, none faked. The partial ones are partial for a specific
reason each — see Q52 and Q56.

### Q3. The PS says "strengthening, not replacing, the public health system." How does your design reflect that?

Three concrete ways:

1. **No clinical authority is moved to software.** Diagnosis and prescription remain
   with a registered practitioner. The platform's job is to remove the *travel* and
   the *waiting*, not the doctor.
2. **The facility hierarchy is modelled, not bypassed.** Sub-centre → PHC → rural
   hospital → district hospital exists in the referral routing, and the destination is
   a real government district hospital by default.
3. **The health worker is elevated, not automated away.** Every AI output lands in
   front of a human as a *draft*. `patient_documents.verified_at` is the only thing
   that promotes an OCR extraction to clinical data, and only a person sets it.

### Q4. Your PS is from Maharashtra. Is the system actually set up for Maharashtra?

Yes, and it runs both states side by side. It was piloted on Uttar Pradesh's 75
districts; Maharashtra's 36 districts are now seeded at the same density — 180
doctors, 36 clinic assistants, district administrators for Pune, Nagpur, Mumbai City
and Chhatrapati Sambhajinagar, and 900 synthetic patients with visits.

That was a data exercise, not a rewrite, because **nothing in the architecture is
state-specific.** Regions are two tables — `states` and `districts` — and every
clinical row is scoped by `district_id`, not by a hardcoded list. Adding Maharashtra
took three things:

1. District masters under the existing `MH` state row.
2. An additive seed, `seedMaharashtra.js`, in ID ranges that cannot collide with
   Uttar Pradesh. It counts UP rows before and after, and they did not change.
3. A per-state referral file, `mh_district_hospitals.json`, loaded beside the UP one.

What is still thin, stated plainly: Maharashtra's hospital records carry ownership
and facility type only. Capability and scheme empanelment — PM-JAY, and
Maharashtra's own MJPJAY — are unsourced, and the referral screen says so.

### Q5. Why should a district health officer trust this over an existing eSanjeevani deployment?

I would not position it against eSanjeevani. eSanjeevani is a teleconsultation
transport; the gap this fills is **everything that happens before the call connects.**

A doctor joining an eSanjeevani call meets a patient cold. A doctor joining here opens
a case that already contains structured vitals with range validation, a transcribed
and human-verified prescription history, a ranked list of statistical disease
candidates, a deterministic risk tier and a wound photograph with an observational
reading. The consultation starts at the point where the history-taking would have
ended.

### Q6. What is the single measurable outcome you would claim?

Time-to-first-clinical-decision for a rural patient, versus travel to a district
hospital. We have not run a field trial, so I will not quote an outcome number we did
not measure. What we *have* measured is the system's own latency (Q37, Q40), and the
architecture is designed so that a patient who would have travelled 40 km reaches a
doctor without leaving the sub-centre.

---

# Part 2 — Architecture (Q7–Q14)

### Q7. Describe your architecture end to end.

Four tiers, deliberately few:

```
React 18 + Vite SPA  ──HTTPS──►  Node 20 / Express API  ──►  Supabase Postgres
   (Vercel)                          (Railway)                  (19 tables, RLS)
        │                                 │
        │                                 ├──loopback──►  Python FastAPI
        └──────WSS /realtime──────────────┘                (symptom model)
                                          │
                                          └──►  Groq (LLM) · Gemini (vision/OCR)
```

Deployment note that matters: **the Express API and the Python inference service run
in the same container**, with Python bound to `127.0.0.1:8001`. The service has no
authentication of its own, and inside one container that assumption is literally true
rather than aspirational. `start.sh` starts both; `nixpacks.toml` puts Python in the
runtime image, not just the build image.

### Q8. Why one WebSocket for both notifications and call signalling?

Because a second channel is a second thing that can be unauthenticated.

`/realtime` carries notifications and per-consultation WebRTC signalling on one
authenticated socket. There *was* a second signalling server on `/signal`; it was
removed, not left mounted, because it took `role=DOCTOR` from a query string — putting
that string in a URL was enough to join a live consultation. Identity now comes from a
verified JWT resolved against the `staff_profiles` row, and nothing a socket claims
about itself is trusted.

### Q9. Why no message queue for the async document jobs?

Honest answer: because the job volume does not justify the operational cost, and I can
defend that with the numbers.

A district runs on the order of tens of document uploads per day. A Redis or RabbitMQ
tier would add a service to deploy, monitor and pay for, to solve a queueing problem
that does not exist yet. The job state lives in Postgres (`document_jobs`), the worker
is the same process, and the result is delivered over the socket that already exists.

**What I would change at scale:** the moment extraction throughput becomes the
bottleneck, `document_jobs` is already a durable queue — `status` is an enum with
`queued`/`running`/terminal states. Moving to a separate worker pool is a change of
consumer, not a change of data model. That is why the table exists rather than an
in-memory map.

### Q10. Why Supabase instead of self-hosted Postgres?

It is Postgres — the SQL is portable, and `database/v2/*.sql` is plain DDL with no
Supabase-specific syntax outside the RLS policies and the auth schema reference. What
Supabase supplies is managed auth, row-level security wired to a JWT claim, and object
storage with signed URLs, which is three services we would otherwise operate.

For a government deployment, the same schema runs on any Postgres; auth would move to
the department's identity provider. Nothing in the data model assumes Supabase.

### Q11. How does the frontend reach the API, and why does it matter?

Through a Vercel rewrite: `/api/*` proxies to the Railway origin, so the browser makes
**same-origin** requests.

That is not cosmetic. Before it, the SPA called the Railway host directly and every
request was cross-origin — which meant CORS preflight on a rural connection, and a
mixed-content failure the moment anything resolved to `ws://`. Same-origin removes an
entire class of failure on exactly the networks least able to absorb it.

The WebSocket is the exception and connects directly to `wss://`, because Vercel
rewrites do not proxy WebSocket upgrades. That is a documented constraint, not an
oversight.

### Q12. What happens when the Python inference service is down?

The clinic keeps working. Three layers of degradation:

1. `aiInferenceClient.js` treats a failed call as **"no candidates"** — explicitly not
   "no disease". The distinction is load-bearing: an empty list must never read as a
   negative finding.
2. The LLM prompt is told the candidate list was unavailable, rather than being handed
   an empty array it might interpret.
3. `build-ai.sh` **exits 0 even when it fails**, on purpose. A pip resolver problem in
   an optional subsystem must not fail the Railway build and take the whole clinical
   API down with it. The failure is loud in the build log and visible at
   `/api/ai/service-status`.

The rule: registration, consultation and case handoff never depend on the Python tier.

### Q13. Why is there no separate microservice per feature?

Because the failure modes of a distributed system are worse than the coupling it
removes, at this scale. Two processes, one database, one socket. Every additional
network hop between a sub-centre and a doctor is a hop that can fail on a link that
already drops.

If a component needed independent scaling it would be the vision/OCR path, and that is
already isolated behind an async job boundary — extraction can be moved to its own
worker without touching the request path.

### Q14. How do you know what is actually deployed?

`GET /api/health` returns the commit it was built from and when the process started:

```json
{ "status": "ONLINE", "commit": "a28118c", "started_at": "2026-09-07T11:34:39Z" }
```

This exists because of a real incident. A release changed one line, that line turned
out to be a no-op, and there was then **no observable difference** between the old
build and the new one — so a deploy was reported as not having happened when it
probably had. Railway injects `RAILWAY_GIT_COMMIT_SHA` at build time. "Is what I pushed
running?" is now a question with an answer instead of a guess.

---

# Part 3 — The AI pipeline (Q15–Q22)

### Q15. Walk me through the triage pipeline. What runs, in what order?

Five stages. The ordering is the safety argument:

```
1. Rule engine        deterministic, from vitals + red-flag symptoms → tier FLOOR
2. Symptom model      Bernoulli NB → ranked candidate list (bounded set)
3. RAG                approved protocol retrieval from Supabase
4. LLM synthesis      Groq, re-ranks candidates, writes first aid, no medicine
5. Vision             Gemini wound reading, may only RAISE the tier
```

**final_tier = MAX(rule_tier, vision_tier, model_tier).**

Escalation is monotonic. Every source may raise the tier; **none may lower it.** That
single invariant is what makes the LLM safe to include at all — the worst a bad model
output can do is fail to escalate, and the deterministic rule engine has already set
the floor from the vitals.

### Q16. Which model does the symptom matching, and how good is it?

Bernoulli Naive Bayes over a 377-dimension binary symptom vector, trained on
**244,938 labelled rows** (of 246,945; the rest dropped by a minimum-30-samples-per-
disease threshold), covering **582 diseases** of 773 in the source.

Measured on a held-out split:

| | top-1 | top-3 | top-5 |
|---|---|---|---|
| Bernoulli NB | 0.8537 | 0.9525 | **0.9743** |
| Centroid baseline | 0.8445 | — | 0.9784 |

**The metric that matters is top-5, not top-1**, because the output is a *candidate
list handed to the LLM*, not a prediction shown to anyone. A pipeline that surfaces the
right disease in its top 5 has done its job; the LLM re-ranks against vitals and
history, and a doctor decides.

*Full disclosure:* the training run's own metadata recorded `selected: "centroid"`, but
`centroids.npy` is never loaded by the service — `NB.predict_proba` does all the
scoring. Every `/diagnose` response was therefore naming a model that was not running.
Found and fixed while preparing this document; the response now reports the model that
actually scored the request.

### Q17. Can the LLM invent a disease?

No, and that is structural rather than a matter of prompting.

The LLM receives the candidate list from the statistical model as *evidence to reason
over*. It may re-rank candidates and it may reject them. **It may not introduce a
disease outside that list.** That bound is what keeps the final output traceable to
244,938 labelled training rows instead of to a language model's imagination.

### Q18. What happens when the symptom model is not confident?

It says so, in the response, as a first-class field:

```json
{ "confident": false,
  "confidence_note": "The model did not find a confident match. The candidates below
                      are weak and near-tied; treat them as a prompt to record more
                      detail, not as a shortlist." }
```

Confidence threshold is 0.15 on the top candidate. The reasoning: across 582 classes, a
top candidate at 5% is the model saying *I do not know* — and rendering that as a
ranked list invites a health worker to read 5% as a finding.

There is also a hard refusal. If **no** symptom matched the clinical vocabulary, the
endpoint returns `ok: false` rather than scoring an empty vector — because an empty
vector makes a Naive Bayes model return its prior, i.e. the most common disease in the
training set, for a patient it knows nothing about.

### Q19. Does the AI ever name a medicine?

**Never. And the enforcement is discard, not filter.**

The system prompt prohibits naming any medicine, dose, frequency or duration —
including over-the-counter. But prompts are not a control, so anything medicinal the
model produces anyway is **deleted at source** (`delete finalAssessment.medications`),
and the health worker's interface returns `emitted: false` unconditionally at every
tier.

Medication exists only inside the registered doctor's own workflow, selected
deterministically by a formulary rules engine. Every emitted medication record carries
the `rule_source_id` of the formulary entry it came from — `assertRuleSourced()` is the
application-layer check that no medication can exist without provenance.

This is the highest-consequence failure mode in the platform, because a plausible-
sounding dose is exactly the kind a health worker acts on.

### Q20. Why is a deterministic rule engine still needed if you have an LLM?

Because a language model's risk assessment is not reproducible and cannot be audited.

`riskEngine.js` classifies from vitals and red flags with fixed thresholds. Same input,
same tier, every time — which means it can be reviewed by a clinician, tested, and
defended after a bad outcome. The LLM's risk output is **always overridden** by it.

The rule engine is the floor. The model is allowed to make the answer *more* cautious
and never less.

### Q21. What does the vision model do, and what is it not allowed to do?

Gemini 2.5 Flash reads wound and skin photographs and returns **observations, never a
diagnosis**. Every finding is phrased as an appearance ("consistent with a superficial
partial-thickness burn"), confidence is capped at "moderate" both in the prompt and
again in code, and severity can only raise the triage tier.

If the engine is unavailable the photograph is stored and flagged for direct doctor
review. **No visual finding is ever invented to fill a gap.**

### Q22. How does OCR avoid corrupting the record?

Mandatory human verification, and it survived every optimisation.

An extraction is a **draft**. It opens a verification modal; a person confirms each
field; `patient_documents.verified_at` is the only thing that promotes it to clinical
data. Making extraction asynchronous, adding a cache and streaming the result over a
socket changed *when* the draft arrives and changed nothing about the check.

There is also a rule that OCR never overwrites a hand-typed value — the health worker's
own entry always wins.

Historical note worth knowing: an earlier speech implementation **fabricated clinical
data** when transcription returned nothing, substituting a fixed Hindi sentence about
fever and cough and returning it as the patient's words. It fed the triage engine. The
current rule across every ingestion path is that an empty result is a valid answer and
nothing is ever invented to fill it.

---

# Part 4 — Clinical safety and regulatory compliance (Q23–Q28)

### Q23. Which law governs an AI system in Indian telemedicine, and are you compliant?

**Telemedicine Practice Guidelines 2020, clause 3.7.4** — notified as Appendix 5 to the
IMC Regulations 2002, administered under the National Medical Commission Act 2019. It
states that artificial intelligence and machine learning technologies **are not
permitted to counsel patients or prescribe any medicine**; only a Registered Medical
Practitioner may, and the RMP alone is accountable.

That is the exact provision this project is built around rather than beside. Compliance
is not a policy document — it is nine boundaries enforced in code:

| Boundary | Enforced at | Satisfies |
|---|---|---|
| Model may never state a diagnosis | `aiOrchestrator.js` prompt rule 1 | TPG 3.7.4; NMC s.34 |
| Model may never name medicine/dose | prompt rules 4, 5 | TPG 3.7.4; D&C Act |
| Model medication **discarded, not filtered** | `aiOrchestrator.js` §7 | TPG 3.7.4 |
| Health worker shown no medication at any tier | `tierWorkflowService.js` | TPG 3.7.4; D&C r.65(9) |
| Emitted medication must carry a formulary rule id | `assertRuleSourced()` | D&C Act; TPG 3.7.2 |
| Deterministic rules set a floor the model cannot lower | `riskEngine.js` | Duty of care |
| Degraded model fails safe to MEDIUM, never LOW | `aiOrchestrator.js` §5 | Duty of care |
| Nothing fabricated — empty is a valid answer | `speechService.js`, `ocrService.js` | IT Act s.43A |
| Administrators cannot read a patient record | `clinicalAccess.middleware.js` + RLS | IT Act / SPDI; DPDP |

Nine tests in `medicationBoundary.test.js` and `aiOrchestrator.test.js` assert these
directly — including one that plants a plausible model-authored medication and asserts
it is discarded. **The compliance claim is continuously verified, not merely
documented.**

### Q24. What other statutes apply?

- **Drugs and Cosmetics Act 1940** and Rules 1945, Sch. H/H1/X, r.65(9) — scheduled
  drugs supplied only against an RMP prescription. No dispensing function exists; no
  medicine is named to a non-prescriber.
- **IT Act 2000 s.43A** and **SPDI Rules 2011** — medical records are Sensitive
  Personal Data; reasonable security practices mandatory. RBAC, district-scoped RLS,
  audit logging of every clinical action, encrypted transport, secrets outside the repo.
- **DPDP Act 2023** — Stage 1 in force from 13 Nov 2025, substantive obligations
  phasing to 2027. Built to the standard in advance: purpose limitation, minimal
  collection, consent at registration, no secondary use, no transfer or sale.
- **CERT-In Directions, 28 April 2022** — 6-hour incident reporting. The audit trail is
  designed to support identification and reporting.
- **EHR Standards 2016 / ABDM** — ABHA number supported as an optional field.

### Q25. You use Aadhaar as the primary key. Is that legal?

This is the one residual issue in the design, and I will state it in full rather than
be caught on it.

**What we do not do:** no UIDAI authentication, no e-KYC, no biometrics, no AUA/KUA
licence, no call to any government database. The number is entered locally by the
health worker and used solely as the record identifier inside this platform.

**The problem:** s.57 of the Aadhaar Act was struck down in *K.S. Puttaswamy* (2018), so
a private or non-statutory body cannot make Aadhaar mandatory, and s.29(4) restricts
display of the number. Using it as the sole primary key makes it a practical
requirement.

**How it is addressed today:** registration is possible without it —
`registration_mode = 'emergency_bypass'` permits registration with no identity
document, and the identity columns were made nullable for exactly this reason. The
number is never published, never transmitted to a third party, never used for
authentication.

**Planned:** migrate to a system-generated internal patient identifier with Aadhaar
retained as an optional, consented attribute — removing the issue rather than
mitigating it.

### Q26. Is your formulary signed by a doctor?

**No.** `isFormularySigned()` returns false today.

The rules engine, the provenance mechanism and the enforcement are all built and
tested. What is missing is a registered practitioner's signature on the content. Until
that exists, the honest statement is that the *mechanism* for safe medication is
complete and the *clinical sign-off* is not — and the system reports it as unsigned
rather than presenting it as approved.

For deployment this is a governance step, not an engineering one.

### Q27. A patient is harmed. What can you reconstruct?

Every clinical action writes an audit row: actor, role, action, entity type, entity id,
metadata, IP, timestamp. Specifically for a referral — the decision most likely to be
questioned — the row records not just *which* hospital but *why*:

- the origin coordinates and whether they came from GPS or a district centroid
- the capabilities the case was judged to need
- the chosen facility's ownership, PM-JAY status and capability-verification state
- the ranking basis

`facility_capability_status` is stored **as it stood at the time**, including
`unverified`. A later backfill of capability data must not retroactively make the
decision look better informed than it was.

### Q28. Can an administrator read a patient's record?

No, and it is enforced twice.

`denyAdminClinicalAccess` middleware blocks every admin role from every clinical
endpoint, and Postgres RLS policies scope rows independently of the application. The
frontend route table also lists no admin role on any clinical route — but the frontend
is not the control; it just stops showing buttons that would fail.

This is a deliberate separation: an administrator manages the staff roster and sees
aggregate counts. Compliance review is a separate `AUDITOR` role that reads audit logs
and can mutate nothing — added specifically so that reviewing the system does not
require handing someone an account that can change it.

---

# Part 5 — Data model and security (Q29–Q34)

### Q29. Describe the schema.

19 tables across 13 migrations. Core entities:

```
states → districts → staff_profiles → doctor_profiles
                            ↓
patients → visits → visit_vitals, visit_symptoms, ai_assessments,
                    patient_documents, patient_images, doctor_reviews,
                    prescriptions, consultations, referrals, document_jobs
                            ↓
                    notifications, audit_logs, doctor_schedules
```

Every clinical row carries `district_id`. Enums are Postgres types, not strings —
`risk_level`, `consultation_state`, `document_job_status`, `notification_event` — so an
invalid state is a database error rather than a silent bad row.

### Q30. How is multi-tenancy enforced?

District scoping at three layers:

1. **JWT** carries `districtId` from the staff profile.
2. **Application** — every clinical query filters on it; an assistant gets visits in
   their district, a doctor gets visits assigned to them. The PDF report endpoint uses
   the *same* scoping, because a printable document is the easiest record to forward.
3. **Database** — RLS policies enforce it independently, so an application bug does not
   become a data breach.

The scope comes from the caller's own profile, **never from the request**. A client
cannot route a referral, or read a roster, through someone else's district.

### Q31. Explain a real security bug you found and fixed.

The session token lived in `localStorage`, which every tab of a browser shares.

A consultation has two ends, so testing or demonstrating one means signing in as the
assistant in one tab and the doctor in another. **The second sign-in overwrote the
first tab's token.** That tab carried on rendering the assistant's screen from React
state that had never changed, while every request it made went out as the doctor.

It surfaced as two apparently unrelated faults: "Access denied. This operation requires:
CLINIC_ASSISTANT" on the assistant's own screen, and a video call that never connected
because both tabs authenticated as the same person.

The fix: a tab's identity now lives in `sessionStorage`, which no other tab can write.
`localStorage` is kept but demoted to a starting point for a newly opened tab, so
reopening on a phone does not force a fresh sign-in.

Verified on production: `localStorage` still shows the doctor, the assistant tab's
`/auth/me` still returns the assistant.

While fixing it we found `reportDownload.js` reading the token from `localStorage`
directly — it would have fetched a patient's PDF under whoever signed in last.

### Q32. How are patient photographs stored?

Private bucket, no public URL, ever.

Nothing durable is stored except the storage path. Readers mint a **short-lived signed
URL** on demand — an hour, long enough to open a case, short enough that a copied link
is not a lasting disclosure. A public bucket means anyone holding the URL can view an
identifiable patient indefinitely, including after the case closes or the staff member
leaves.

The response also stopped echoing the uploaded image back. Of a 1,056,003-byte vision
response, **1,054,346 bytes were the photograph the phone had just finished
uploading** — a megabyte re-sent down a rural link to show a picture the device's own
camera roll already held.

### Q33. What are your rate limits?

Three tiers: a global limiter on `/api`, a stricter one on AI routes (real provider
cost), and a patient-search limiter applied also to referral routing — it costs nothing
externally but accepts live coordinates and writes a clinical record.

**Known gap, stated plainly:** the store is in-memory, so limits are counted per
process. Behind multiple instances the effective limit multiplies by instance count.
Correct fix is a shared store; it is documented, not hidden.

### Q34. How do you handle destructive operations?

After an incident. The Railway deploy was running `npm run seed` on container start —
nothing in the repository does that, so it was configured in the dashboard — and it
was **wiping and rebuilding production demo data on every deploy.**

It explained failures that had looked unrelated: a demo login that stopped working
mid-session because the account had been regenerated under a different name, and
doctor schedules that emptied repeatedly for no visible cause.

Two fixes. The seed now refuses without `--confirm`, matching `applyV2.js`. And the
refusal **exits 0, deliberately** — whatever invokes it chains into the server start, so
a non-zero exit would stop the container booting. Refusing to wipe the database must
never become an outage.

Separately, `db:apply` runs `01_reset.sql` and would destroy production, so there was no
way to add a migration to a live database. `npm run db:migrate` runs only named files
and refuses the reset outright.

---

# Part 6 — Teleconsultation and WebRTC (Q35–Q39)

### Q35. Why mediasoup and not plain peer-to-peer?

Both, in preference order, resolved **at boot rather than at call time**.

mediasoup is an SFU and scales past two peers; P2P is the fallback when the native
worker cannot run on the host. Selection happens at startup on purpose: discovering
that the SFU cannot start *while a doctor is waiting to join* is the worst possible
moment to find out. `VIDEO_PROVIDER=mediasoup` pins it explicitly and fails loudly
rather than silently downgrading, because someone deliberately asked for the SFU.

### Q36. How do you handle WebRTC negotiation reliably?

Perfect negotiation with roles assigned by clinical role — one side polite, one
impolite — so a glare condition resolves deterministically instead of by luck.

Outbound signalling is **buffered**: a message produced while the socket is down is
held and flushed on reconnect, with a TTL so a message whose peer connection has moved
on is dropped rather than delivered late. Call membership is declarative, so a
reconnecting client re-declares which consultation it is in rather than relying on
server-side session memory.

### Q37. A judge says "the video call will not work in a village on 2G." Response?

Correct, and the design says so. WebRTC needs a few hundred kbps for usable video.

What the architecture does about it:

1. **The consultation is not the only path.** Case handoff is asynchronous — the
   assistant sends a complete structured case, the doctor reviews it and returns a
   decision, with no live call at all. On a bad link that path still completes.
2. **Tiering reduces call demand.** LOW is protocol care with no doctor call. Only
   MEDIUM requires a video consultation. HIGH/EMERGENCY leaves the platform to a
   physical referral. So calls are spent where they change the outcome.
3. **Every payload was cut for the link.** Documents compress client-side before
   upload; the image echo was removed.

I would rather tell you the honest constraint than claim video works on a link where it
does not.

### Q38. Instant consultation — how is a doctor chosen without a race?

Availability is computed server-side at the moment it is asked, from `doctor_schedules`
and the `consultations` table — nothing hardcoded, nothing trusted from the client. The
whole check re-runs **inside the booking transaction**, because a slot list rendered
eight seconds ago is a guess, not a fact.

A partial unique index enforces at most one `ACTIVE` consultation per doctor at the
database level, so two simultaneous bookings cannot both win.

### Q39. What happens to a consultation nobody joins?

A background sweeper on one timer does two jobs: marks `MISSED` when a scheduled
window has fully expired, and fires a reminder ~10 minutes before start.

Both **re-read status at send time** rather than trusting what it was when the work was
queued — a consultation cancelled after a reminder was planned must not still receive
that reminder.

---

# Part 7 — Referral, emergency and low connectivity (Q40–Q45)

### Q40. How does emergency referral routing work?

Four criteria in priority order: **capability → affordability → quality → travel time.**
Applied differently by tier, because the clinical reality differs.

- **EMERGENCY** — the nearest capable facility wins outright. A NABH-accredited
  hospital 70 km away loses to a CHC at 8 km. No accreditation is worth the extra
  thirty minutes for an unstable patient.
- **HIGH** — a bounded 45-minute detour off the nearest capable option; inside that
  window, cost and quality genuinely decide. A cashless PM-JAY hospital 24 km away
  beats a chargeable one at 10 km; one 400 km away does not.

Haversine distance, offline-first, **no API key required** — a referral must not fail
because a billing quota was exceeded. A maps key only upgrades straight-line distance
to a driving time.

### Q41. Why is PM-JAY empanelment a first-class field?

Because for a landless family it is not a preference, it is whether the treatment
happens at all and whether they are solvent afterwards. An empanelled private hospital
means a cashless admission; a non-empanelled one can bankrupt them.

Every card carries a cost line, and the unknown case says **"PM-JAY status not
confirmed — ask at the desk before admission"** rather than anything reassuring.

### Q42. Do star ratings influence the ranking?

**No.** A Google rating measures parking and politeness; it is not evidence that a
hospital can run a caesarean at 3 a.m. Presenting it as a clinical quality signal on a
referral screen would be a lie with consequences.

It is a tiebreaker of last resort, used only to separate options already identical on
every clinical and financial axis, and it is labelled as public reviews with an
explicit "not a measure of clinical quality" note. Three tests pin that behaviour.

### Q43. What does your system do when it does not know a facility's capabilities?

It says so. Capability has **three** states, not two:

- `confirmed` — a source lists the capability
- `unverified` — `null`; nobody has sourced it
- `lacking` — a source positively said no

`null` must not read as "cannot treat" (that would empty the screen) and must not read
as "can treat" (that would be a lie). It ranks below anything confirmed and the card
shows **"Services not verified — ask when you call"**, which sends the health worker to
the phone, where the answer actually is.

An empty array is a *different* claim from null, which is why the dataset stores null
for unknown and never `[]`.

### Q44. Your facility dataset is mostly empty. Why ship it?

Because the alternative is fabricating clinical data, which is worse than useless.

The 111 records — 75 in Uttar Pradesh, 36 in Maharashtra — carry ownership and facility
type only where those follow from the record itself, and every other field is null
with per-field provenance. A fabricated `blood_bank` sends a haemorrhaging patient to a
hospital that cannot transfuse them.

`ingestFacilities.js` merges a real source, refuses to write any field without a
citation and retrieval date, validates every value, and reports overwrites. **The
engine is complete; the dataset is honest about being absent.**

### Q45. What did you actually do about low connectivity?

Measured first, then fixed. Measured against production:

| | Before | After |
|---|---|---|
| Document payload | 470 KB | **188 KB** |
| Upload time | 11.4 s | **6.0 s** |
| Operator blocked | ~29 s | **~6 s** |
| Vision response | 1,056,003 B | 1,657 B |

Method: the Aadhaar validation returns *after* multer buffers but *before* the model
call, which let us separate upload time from processing time cleanly. Upload is linear
at **~43 KB/s**; processing is flat at 23–29 s. So on a 4 MB phone photo the upload is
~93 s against ~29 s of model time — **three-quarters of the wait is the file climbing
the uplink.**

That is why compression and async were both needed; neither alone was enough.

Compression was validated for *accuracy*, not just size: at 1600px/q80 all five
medications came back with identical names, strengths and durations, and it picked up
"1 tab at bedtime" where the full-resolution read had flattened it to "once daily".

---

# Part 8 — Multilingual, testing, operations (Q46–Q50)

### Q46. How does multilingual support work?

32 languages: all 22 of the Eighth Schedule, English, and 9 regional languages —
Bhojpuri, Awadhi, Magahi, Rajasthani, Chhattisgarhi, Haryanvi, Tulu, Khasi, Mizo.
Bhojpuri and Awadhi are there deliberately: between them they are the first language of
much of rural UP and they appear on no official list.

A language gate appears **before** the app on first visit, because the first thing this
interface requires of anyone is that they read it — a health worker who cannot read the
sign-in screen cannot reach a language menu behind it.

Every option is written in its own script. Someone looking for Punjabi scans for
ਪੰਜਾਬੀ; a romanised "Punjabi" is invisible to a reader who does not use the Latin
alphabet, and that reader is the entire point. Urdu, Kashmiri and Sindhi set
`dir="rtl"`, which is not cosmetic — without it the interface reads backwards.

### Q47. Why no i18n library?

The app already ships three large dependencies, and this needs four things: a key
lookup, a fallback chain, a stored preference and lazy loading. i18next is ~40 KB over
a rural connection to solve what about a hundred lines solve — which would have
broken the very constraint (performance on poor links) that the feature exists to
serve.

Locales load lazily. English is bundled because it is the fallback; every other
language is its own chunk, so a Hindi user downloads English and Hindi and none of
the others. The same choice reaches the AI's prose and the printed PDF report —
see `20-internationalisation.md`.

The fallback chain is **chosen language → English → the English written at the call
site**. A missing translation renders a real sentence, never `nav.dashboard`. That
matters more here than usual: a health worker who sees a raw key does not get a
degraded screen, they get an unusable one. It is also what makes partial coverage safe
to ship.

### Q48. Are the translations reliable?

English is the reference, at 993 interface strings. Coverage elsewhere is uneven, and
measured rather than estimated by `frontend/scripts/i18n-status.mjs`: **Hindi 37%,
Marathi and ten other major languages 8%, the remaining regional languages 1–3%.**
Every untranslated string falls back to English, so no screen breaks — but a Marathi
speaker today reads mostly English beyond the core screens, and for a Maharashtra
deployment that is the first thing to fix.

**No qualified speaker has reviewed most of them, and the selector says so.**
`languages.js` carries a `reviewed` flag per locale and the UI shows an "unreviewed"
badge. This is a medical interface: a triage tier rendered as a word closer to "urgent"
than "emergency" changes what someone does with a dying patient.

Nothing is blocked — someone who reads Santali is better served by imperfect Santali
than by fluent English they cannot read. But they are told.

### Q49. What is your test coverage?

**265 tests across 15 suites**, all passing. They are not coverage-chasing; they pin the
invariants that would be dangerous to break:

- `medicationBoundary.test.js` — plants a model-authored medication, asserts discard
- `riskEngine.test.js` — escalation is monotonic
- `facilityRanking.test.js` (30) — tier-aware ranking, three-state capability, ratings
  never outrank capability or PM-JAY
- `documentJobs.test.js` (20) — cache never crosses a patient boundary, job always
  reaches a terminal state, notification payload carries no clinical data
- `visitReview.test.js` — the doctor's decision reaches the assistant
- `seedIntegrity.test.js`, `realtimeHub.test.js`, `visitWithdrawal.test.js`, …

The cache test is named for the boundary it protects, so a future "optimisation" cannot
quietly widen it.

### Q50. How do you verify a deploy actually worked?

By probing production, not by trusting a dashboard. `/api/health` reports the commit.
For the frontend, the bundle hash must change.

A cautionary example from this project: a bundle was fetched without `--compressed`,
grep matched gzipped bytes, and the conclusion "the fix is not deployed" was wrong. The
lesson we apply now — **verify the verification method** before reporting a negative
result.

---

# Part 9 — The hard questions (Q51–Q60)

### Q51. This is a hackathon project. Why would a government trust it in production?

It should not, yet, and I would not claim otherwise. What I would claim is that it is
engineered like something intended for production rather than for a demo:

- 265 tests pinning safety invariants, not happy paths
- Row-level security in the database, not just checks in the application
- Audit rows recording *why* a decision was made, not only what
- Build-marked deploys so "what is running" is answerable
- Documented known gaps rather than a claim of completeness

What stands between here and a real deployment: the formulary needs a registered
practitioner's signature, the translations need native-speaker review, the facility
capability data needs sourcing from PM-JAY/NABH registries, and it needs a clinical
safety review by people who are not us.

### Q52. What is the weakest part of your system?

The facility capability dataset. The ranking engine is complete and tested, and it is
currently ranking almost entirely on `unverified` data, which means in practice it
mostly reduces to nearest-hospital with an honest label on it.

That is a data-sourcing problem, not an architecture problem — `ingestFacilities.js`
exists precisely to close it — but it is the gap between what the system *can* do and
what it *does* do today, and it is the first thing I would fix.

Second weakest: no field trial. Every latency number is measured; no clinical outcome
number is, because we have not run one.

### Q53. Your triage could kill someone. Defend that.

It could, if it lowered a risk tier. It cannot.

Escalation is monotonic — every source may raise the tier, none may lower it — and the
deterministic rule engine sets a floor from vitals before any model runs. A degraded or
unavailable model fails safe to MEDIUM, never LOW. The worst a model failure produces
is an unnecessary consultation.

The residual risk is a patient whose vitals are normal and whose danger is not visible
to the rule engine. That risk exists in the status quo too — where the alternative is
no assessment at all — but I will not claim it is eliminated. It is why every tier
above LOW puts a registered doctor in the loop, and why EMERGENCY bypasses the platform
entirely to a physical referral rather than trying to manage the patient in software.

### Q54. What if the LLM provider is down or rate-limits you mid-demo?

The rule engine still produces a tier — it needs no network. The RAG protocol retrieval
reads from Supabase, not the LLM. The symptom model runs locally on loopback.

What degrades is the narrative synthesis and the first-aid prose. The assessment
becomes terser, not absent, and the tier — the clinically load-bearing output — is
unaffected.

### Q55. You mentioned a bug where a "fix" did nothing. How do I know your other claims are real?

That is the right question to ask, and the honest answer is: because we caught it
ourselves and said so.

The specific case: a change meant to stop echoing an uploaded image back set the final
fallback to null but left the variable seeded with the image six lines above. It was a
no-op. Worse, it was the *only* externally visible difference between two builds, so
when it turned out to do nothing, the probe for it could not distinguish a stale
deployment from a fresh one — and a deploy was wrongly reported as not having happened.

Both were fixed, and the second produced the build marker in `/api/health` so the class
of error cannot recur. Every performance number in this document is a measurement you
can reproduce against the live API, not an estimate.

### Q56. Medicine availability is "partial." What is actually missing?

There is a formulary rules engine with provenance, and a molecule/brand index built
from a 250k-row Indian medicines dataset. What is missing is a **live stock feed** from
facility pharmacies — and there is no public real-time API for it.

We deliberately did not invent one. The same reasoning applies to bed availability: the
referral screen shows no bed count because there is no public real-time feed for UP
facilities, and an invented bed count on a referral screen is dangerous. The UI
instructs the health worker to confirm capacity by phone, and the phone number is as
prominent as the route button.

Where a public feed exists (e-Aushadhi in some states), it is an ingestion adapter, not
an architecture change.

### Q57. How would you integrate with ABDM?

ABHA number is already an optional field on the patient record and the schema is
aligned to structured clinical records per EHR Standards 2016.

Full ABDM integration needs three things we have not done: registering as a Health
Information Provider, implementing the consent-manager handshake, and emitting FHIR R4
bundles for the care contexts. The data model maps cleanly — visits, observations,
diagnostic reports, prescriptions — so this is a serialisation and certification
exercise rather than a redesign.

I would not claim ABDM compliance today. I would claim ABDM-*ready* schema.

### Q58. What would break first if 10,000 clinics used this tomorrow?

In order:

1. **The in-memory rate limiter** — per-process counting means limits multiply by
   instance count. Fix: shared store.
2. **Synchronous vision calls** — 23–29 s each against a provider quota. The async job
   table already exists; it needs a separate worker pool consuming it.
3. **PostgREST's 1000-row response cap** on admin analytics — already hit once during
   development, which is why analytics aggregate in the database rather than in Node.
4. **The single WebSocket process** — `userSockets` and `callRooms` are in-process maps.
   Multi-instance needs a pub/sub layer for cross-instance delivery.

None requires a redesign. All are known and none is disguised as solved.

### Q59. Why should we believe your latency numbers?

Because the method is stated and reproducible. Every figure came from `curl` against
the live production API with `%{time_total}`, three runs, using real demo prescription
images as payloads.

The upload/processing split used a specific property of the code: the Aadhaar
validation returns after multer buffers the file but before the model call, so a
deliberately invalid request measures upload time alone, and a valid one measures the
total. Subtracting gives processing.

You can run it yourself against `ruralai-production-220.up.railway.app` — the health
endpoint tells you which commit you are measuring.

### Q60. If you had four more weeks, what would you build?

In priority order, and none of it is new features:

1. **Source the facility capability data** from PM-JAY and NABH registries — it is what
   turns the referral engine from correct-but-uninformed into genuinely useful.
2. **Get the formulary signed** by a registered practitioner.
3. **Native-speaker review** of the top eight languages by rural speaker population.
4. **A field trial** at two sub-centres, to replace measured latency with measured
   clinical outcome.
5. **Shared-store rate limiting and a worker pool** — the two things that break first
   at scale.

The pattern: the engineering is further ahead than the data and the clinical
governance. That is the honest state of the project, and it is the right order to fix
it in.

---

## Appendix — Numbers to have ready

| Metric | Value |
|---|---|
| Tests | 265 passing, 15 suites |
| Database tables / migrations | 19 / 13 |
| Roles | 6 (SUPER_ADMIN, STATE_ADMIN, DISTRICT_ADMIN, DOCTOR, CLINIC_ASSISTANT, AUDITOR) |
| Languages | 32 (22 Eighth Schedule + English + 9 regional) |
| Symptom model training rows | 244,938 of 246,945 |
| Diseases / symptoms | 582 kept of 773 / 377 |
| Model top-5 accuracy | 0.9743 (Bernoulli NB) |
| Districts modelled | 111 — 75 Uttar Pradesh, 36 Maharashtra |
| Document upload after optimisation | 188 KB, 6.0 s (from 470 KB, 11.4 s) |
| Measured uplink | ~43 KB/s |
| Vision response size | 1,657 B (from 1,056,003 B) |
| Compliance boundaries enforced in code | 9, each with a test |

## Appendix — Things to say plainly if asked

- The formulary is **unsigned**.
- Most facility capability data is **unsourced**, and the UI says `unverified`.
- Most translations are **unreviewed by native speakers**, and the selector says so.
- There has been **no field trial**; no clinical outcome number is claimed.
- All patient data in both states is **synthetic**; no real patient is in the system.
- CSP is **disabled** in helmet — a real policy is a documented open gap.
- Rate limiting is **per-process**, not shared.

Naming these before a judge finds them is worth more than any feature in the demo.
