# Project Documentation — AI-Powered Virtual Village Clinic

Complete technical documentation for this repository, written from the code
rather than from intent. Every claim in these files names the file, function,
table, endpoint, migration or script that backs it.

**Repository:** <https://github.com/PriyamMishra853/RURALAI->
**Submission:** Smart India Hackathon 2026 — Problem Statement 3, *AI-Powered
Virtual Clinic for Rural Healthcare*
**Author:** Priyam Mishra

---

## How to read this

If you are evaluating this project and have limited time, read in this order:

1. **[00 — Project Overview](00-project-overview.md)** — what it is, every built
   feature, and the requirement-by-requirement coverage table mapping the
   problem statement to code.
2. **[06 — Database Schema](06-database-schema.md)** — 17 tables, every column,
   every constraint, the ER diagram, and which migrations are applied.
3. **[11 — AI Model Training (built)](11-ai-model-training.md)** — the trained
   classifier, its measured accuracy, and the rule engine that overrides it.
4. **[08 — Security](08-security.md)** — including an explicit *current
   limitations* section that does not hide anything.
5. **[16 — Known Limitations and Risks](16-known-limitations-and-risks.md)** —
   the honest list, including defects found while writing this documentation.

Everything in files 00–11 and 13–19 describes code that exists and runs today.
**[12 — Next-Generation Model Development](12-next-generation-model-roadmap.md)**
is the only forward-looking section. It is labelled as a roadmap, opens with a
status line separating what runs today from what is being built, and is written
entirely in future or in-progress tense.

---

## Contents

### Core

| # | Document | Covers |
|---|---|---|
| 00 | [Project Overview](00-project-overview.md) | Product principle, built features, PS coverage table, scope, feasibility, scalability with real numbers, revenue model, government-integration path |
| 01 | [Setup Guide](01-setup-guide.md) | Clone, install, environment variables, migration order, seeding, running all three services, production deployment |
| 02 | [All Dependencies](02-dependencies.md) | Every backend, frontend and Python package with version and reason; runtime vs dev; external services and what breaks without each |
| 03 | [Data Flow](03-data-flow.md) | Speech, OCR, image, triage and realtime paths as separate traced flows, with Mermaid diagrams |
| 04 | [Workflow](04-workflow.md) | End-to-end clinical journey plus per-role sequences, the emergency branch and the doctor review loop |
| 05 | [Directory Structure](05-directory-structure.md) | Annotated tree; every significant file explained in one line |
| 06 | [Database Schema](06-database-schema.md) | Every table, column, type, constraint, enum, foreign key and index; ER diagram; migration history and applied status |
| 07 | [Tech Stack](07-tech-stack.md) | Every technology with version and the alternative it was chosen over |
| 08 | [Security](08-security.md) | Validation, uploads, secrets, transport, injection posture, rate limiting, audit, PII, district scoping, clinical-safety boundaries, current limitations |
| 09 | [Authentication](09-authentication.md) | Token issuance and lifetime, dual verification paths, credential handling, socket authentication |
| 10 | [Authorisation](10-authorisation.md) | Six-role model, full permission matrix per endpoint, district-scope enforcement, refusals per role |
| 11 | [AI Model Training — built](11-ai-model-training.md) | Kaggle datasets, training scripts, the symptom→disease model and its measured accuracy, medicine index, RAG store, rule engine, inference API, hosted models and key pooling |
| 12 | [Next-Generation Model Development — **roadmap**](12-next-generation-model-roadmap.md) | **In progress / planned.** In-house clinical model programme: compute, data curation, training methodology, evaluation, guardrails, and why an owned model differs architecturally from wiring up a public API |

### Supporting

| # | Document | Covers |
|---|---|---|
| 13 | [API Reference](13-api-reference.md) | All 59 HTTP routes and the WebSocket protocol, with auth, roles, request and response shapes |
| 14 | [Testing and Quality](14-testing-and-quality.md) | 135 tests across 9 suites, what each asserts, live-service check scripts, current coverage and gaps |
| 15 | [Error Handling and Observability](15-error-handling-and-observability.md) | Failure taxonomy, degradation ladder, audit log as the observability spine, diagnostics endpoints |
| 16 | [Known Limitations and Risks](16-known-limitations-and-risks.md) | Every gap, defect and unproven claim, with severity and what would close it |
| 17 | [Architecture Decision Record](17-architecture-decision-record.md) | 18 significant decisions, the alternatives, and why each was chosen |
| 18 | [Glossary](18-glossary.md) | Clinical, Indian health-system and project-specific terms |
| 19 | [Contributing and Conventions](19-contributing-and-conventions.md) | Coding conventions, invariants that must not be broken, review checklist |

---

## The one-paragraph version

A village health worker registers a patient by Aadhaar, records symptoms by
voice in Hindi or another Indian language, enters vitals, photographs the
patient's paper prescription and any visible injury, and runs an assessment. A
deterministic rule engine tiers the case, a trained classifier proposes ranked
disease candidates from 244,938 labelled symptom vectors, a language model
writes the doctor-ready summary but is forbidden from naming a diagnosis or a
medicine, and the case is handed to a named doctor in the same district who
reviews it and signs the prescription. **The AI prepares the case. The doctor
makes the medical decision.** That boundary is enforced in code, in the
database, and in the prompt — see
[08 — Security §7](08-security.md#7-clinical-safety-boundaries-enforced-in-code).
