# Regulatory and legal documentation

Two pages of one document, `verification_legal_p1.png` and `_p2.png`. They have
different standing, and the difference matters when either is put on a screen.

## Page 1 — Clinical Evaluation and Verification

**This page is an unsigned template. No practitioner has signed it, and it
records no evaluation that has taken place.**

Every identifying field is a blank placeholder: `[ Name of Reviewing Medical
Practitioner ]`, `Registration No. [ ______ ]`, `[ DD / MM / 2026 ]`. It is the
form a registered medical practitioner would complete *after* independently
examining the platform against the five cases in [`demo/`](../../demo/) —
recording their own expected triage tier for each case before seeing the
platform's, then comparing.

Until a named practitioner with a real registration number has signed it, this
page must not be presented, described, or captioned as clinical verification. A
completed-looking form is exactly the sort of thing an audience reads as an
endorsement, and there is no endorsement here yet.

## Page 2 — Regulatory and Legal Compliance

This page stands on its own. It is a statement of the law that applies to the
platform and of how the code complies, and every claim in it is checkable against
this repository rather than taken on trust.

The governing provision is **Telemedicine Practice Guidelines, 2020, clause
3.7.4** — AI may not counsel a patient or prescribe medicine; only a Registered
Medical Practitioner may. The system is built around that rather than beside it:
model-authored medication is **discarded at source, not filtered**, and no
medicine, dose, frequency or duration is surfaced to the health worker at any
tier, including the lowest and including over-the-counter preparations.

Its code citations were verified against the tree at the commit that added this
file:

| Claim | Location |
|---|---|
| Model may never state a diagnosis | `backend/src/services/aiOrchestrator.js:22` |
| Model medication discarded, not filtered | `aiOrchestrator.js:319` — `delete finalAssessment.medications` |
| Health worker shown no medication at any tier | `tierWorkflowService.js:149` — `emitted: false` |
| Emitted medication must carry a formulary rule id | `formularyService.js:199` — `assertRuleSourced()` |
| Deterministic rules set a floor the model cannot lower | `riskEngine.js:22` — `higherTier()` |
| Administrators cannot read a patient record | `clinicalAccess.middleware.js` + RLS in `database/v2/03_rls.sql` |

The nine tests it cites are the eight medication-boundary tests in
`backend/tests/medicationBoundary.test.js` and the `medication is never
model-authored` block of `backend/tests/aiOrchestrator.test.js`, plus
`does not let the model lower the tier below the rule tier`. One of them plants a
plausible-looking model-authored medication and asserts it is discarded, so the
compliance claim is continuously verified rather than merely documented.

## The residual point, stated rather than buried

Page 2 states it in full and this file will not soften it. Section 57 of the
Aadhaar Act was struck down in *K. S. Puttaswamy v. Union of India* (2018), so a
private or non-statutory body cannot make Aadhaar mandatory. Using it as the sole
primary key is therefore a real design issue, not a formality.

It is partly addressed already — `registration_mode = 'emergency_bypass'` allows
registration with no identity document, and the identity columns were made
nullable for exactly this reason. The number is never published, displayed to a
third party, transmitted onward, or used for authentication, and the platform
performs no UIDAI authentication or e-KYC and holds no AUA/KUA licence. The
planned fix is a system-generated internal patient identifier with Aadhaar
retained as an optional consented attribute, which removes the issue instead of
mitigating it.
