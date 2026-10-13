# TinyFish integration — plan

**Status: planned, not implemented.** Nothing in this document is running in the
product today. It is written so that the work can be picked up and finished
without a conversation, and so that nobody mistakes a plan for a feature.

Related: [PROJECT_DOCUMENTATION/PS_26133_COVERAGE_AND_HANDOFF.md](PROJECT_DOCUMENTATION/PS_26133_COVERAGE_AND_HANDOFF.md)
· [PROJECT_DOCUMENTATION/SIH_PITCH_GUIDE.md](PROJECT_DOCUMENTATION/SIH_PITCH_GUIDE.md)

---

## 1. Why this, and why now

Almost every fact a village health worker needs is already published by the
Government of India. Blood stock, bed availability, hospital empanelment,
medicine prices, treatment protocols, a doctor's registration — all public, all
official, and nearly all of it **published on web portals with no API**.

So the platform does what every other system does: it keeps a static copy. Our
referral router picks a facility from a table that was seeded once and does not
know what that hospital has today. The product deck claims "smart routing with
live inventory"; the code has no live inventory. That gap is the honest reason
for this integration.

[TinyFish](https://docs.tinyfish.ai/) runs web agents: give its Agent API a URL
and a goal in plain language, optionally with an output schema, and it drives a
real browser — navigating, waiting on JavaScript, filling forms — and returns
structured JSON. It also exposes Search, Fetch and Research surfaces, async runs
with webhooks, and an MCP server for development.

That is exactly the shape of the missing piece: a reliable way to read
government portals that were never built to be read by machines.

## 2. What we would fetch

Five agents, in the order we would build them. Each one is tied to an outcome
the problem statement actually names.

| # | Agent | Source (no public API) | Outcome it serves |
|---|---|---|---|
| 1 | **Live referral intelligence** — before the referral slip is issued, check the receiving facility for what *this* patient needs | eRaktKosh blood availability; state bed and ICU dashboards; PM-JAY empanelment status | Delayed referrals; patients sent to a facility that cannot treat them |
| 2 | **Medicine availability and price** | Jan Aushadhi Kendra stock; NPPA ceiling prices | Out-of-pocket cost — the doctor names a medicine the patient can actually obtain nearby |
| 3 | **Protocol freshness** — detect a new version of a guideline and queue it for the retrieval library with title, version and source URL | MoHFW, IPHS and WHO guideline pages | Quality of care; our citations stay current and traceable |
| 4 | **Doctor credential verification** at onboarding | NMC National Medical Register search | Telemedicine Practice Guidelines 2020 require a registered practitioner |
| 5 | **eSanjeevani hand-off** — an agent carries a prepared case into the national teleconsultation portal | eSanjeevani portal | Complements the national platform instead of duplicating it. **Requires written authorisation from the health department. Do not build this without it.** |

## 3. How it fits the architecture

```
Clinic UI ──► Node/Express API ──► webAgentService.js ──► TinyFish Agent API
                                          │                 (async run + webhook)
                                          ▼
                               external_signals (Postgres)
                       source · source_url · fetched_at · payload · ttl
                                          │
                   ┌──────────────────────┴──────────────────────┐
                   ▼                                             ▼
      Doctor sees a cited fact:                     Stale or failed fetch →
  "O+ available — eRaktKosh, 14:20"            fall back to the static facility
                                                table. The referral still works.
```

- **Feature-flagged** as `web_agent_lookup`, like every other feature here, so a
  deployment can run entirely without it.
- **Scheduled and cached, never in the clinical path.** A district refreshes on a
  timer; a clinician never waits on a web agent, and a page load never triggers a
  billed run.
- **Additive migration** — one new table, no change to any existing one, in
  keeping with migrations 12–25.
- **The key lives in the backend environment only** (`TINYFISH_API_KEY`). Never in
  the browser bundle, never prefixed `VITE_`, never returned in a response, never
  committed. Same rule as the maps key.

### The three rules that make it safe in a public health system

1. **No patient data leaves the platform.** A query carries a district, a blood
   group, a facility name. Never a patient name, never an ABHA number, never a
   complaint or a vital sign.
2. **An external signal informs; it never decides.** It cannot change the triage
   tier, it cannot put a medicine on a prescription, and it is excluded from the
   learning loop and from FHIR exports — we do not export an unverified
   third-party fact as if it were a clinical record. This is the same rule the
   AI already lives under: the rules engine sets the tier, the model may only
   raise it, and the doctor decides.
3. **Everything is cited and audited.** The clinician sees the source and the
   time it was read; the fetch itself is written to the append-only audit log. A
   number with no source is never shown.

## 4. Data model

One new table. `payload` stays `jsonb` because each source has its own shape,
and a signal is only ever read through the service that wrote it.

| Column | Type | Note |
|---|---|---|
| `id` | uuid | |
| `source` | text | `erkt_blood`, `beds`, `pmjay`, `jan_aushadhi`, `nppa`, `protocol`, `nmc` |
| `subject_type` / `subject_id` | text / uuid | the facility, district or doctor the signal is about |
| `source_url` | text | shown to the clinician, stored for audit |
| `payload` | jsonb | the structured result from the agent |
| `fetched_at` | timestamptz | shown to the clinician |
| `expires_at` | timestamptz | past this, fall back to the static table |
| `run_id` | text | TinyFish run id, for tracing a disputed value |

## 5. How we would build it

| Stage | Work | Why this order |
|---|---|---|
| **Pilot — 1 PHC** | Agents 3 and 4 | Read-only, no patient data, no clinical risk. Proves the plumbing. |
| **District — ~40 sub-centres** | Agents 1 and 2 for that district's hospitals | Measured against the referral-completion baseline the platform already records. |
| **State** | Agent 5, with authorisation; webhooks feeding the district outcome dashboard | Needs a government relationship, not more code. |

Implementation order within a stage: migration → `webAgentService.js` with the
async run and webhook handler → the scheduler entry → the UI citation component →
tests, including one that asserts a signal can never alter a triage tier.

## 6. Cost control

Search and Fetch are free within a daily allowance; Agent and Research runs draw
from a wallet. Because every run is scheduled per district rather than per visit,
cost scales with the number of districts and the refresh interval, not with
patient volume — which is the only way this stays affordable at state scale.

## 7. Setup

```bash
# Backend environment only. Never VITE_-prefixed, never committed.
TINYFISH_API_KEY=...            # from the TinyFish dashboard
FEATURE_FLAGS=...,web_agent_lookup
```

For development, TinyFish also ships an MCP server, so the same agents can be
driven from a coding agent while building:

```bash
npx -y @tiny-fish/cli@latest connect --all --api-key YOUR_KEY --skip-launch
npx -y @tiny-fish/cli@latest doctor --pretty
```

The MCP server is a development convenience. Production calls the REST Agent API
from the backend, with webhooks — never from the browser.

## 8. What this is not

It is not a scraper that the clinical workflow depends on. If TinyFish is down,
if a portal changes, or if a signal is stale, the platform behaves exactly as it
does today: the static facility table, the same referral, the same doctor
decision. Everything above is additive, and every piece of it is a fact the
doctor is shown — not a decision anything else makes.
