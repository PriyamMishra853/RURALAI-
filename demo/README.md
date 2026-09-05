# Demonstration case pack

Synthetic patient specimens for exercising the full clinical pathway end to end:
registration → vitals → OCR of paper documents → triage → doctor handoff.

**Nothing here is a real medical record.** Identities, facilities, clinicians and
registration numbers are fictional. Every Aadhaar value begins with `1`, which is
non-issuable by design — real Aadhaar numbers begin 2–9 — so none of these can be
presented to a live government service even by accident. Each specimen image
carries that statement in its own footer, so a page screenshotted out of context
still declares what it is.

Mobile numbers are placeholders — `9000000001` through `9000000004`. They cannot
be made non-issuable the way the Aadhaar values were: the registration form
validates `^[6-9][0-9]{9}$`, and this sheet exists to be typed into that form, so
an X-masked number would fail the very field it is meant to fill. A transparently
sequential placeholder is the closest available thing — obviously not a person's
number, while still valid enough to enter. The facility numbers printed on the
prescription and lab specimens are masked instead (`9XXXX 41208`), because those
are read from the page rather than typed into a field.

## The cases

| # | Presentation | Patient | Expected tier |
|---|---|---|---|
| 01 | Uncontrolled Type 2 diabetes, Stage II hypertension, early renal involvement | 68 / M | **HIGH** |
| 02 | Acute gastroenteritis with dehydration, tachycardia, febrile | 4 / F | **MODERATE** |
| 03 | Severe post-partum iron deficiency anaemia, Hb 7.8 g/dL | 32 / F | **HIGH** |
| 04 | Pulmonary TB on supervised treatment, continuation phase, stable | 45 / M | **LOW** |
| 05 | Post-partum collapse — BP 84/54, pulse 126, SpO₂ 91%, syncope × 2 | 32 / F | **EMERGENCY** |

The tiers are what the deterministic rule engine should produce. They are the
point of the pack: a case whose tier does not come out as listed is a regression,
not a judgement call.

Case 03 is deliberately **handwritten** — the OCR path that a typed prescription
never exercises.

## Running the pack

1. Open `demographics_sheet.pdf`. It gives the exact field values to enter, keyed
   to the column names in `database/v2/02_schema.sql`, so what you type matches
   what the schema expects.
2. Register the patient, then open a visit and enter the vitals exactly as
   listed — **the vitals drive the triage engine**, and approximating them
   changes the tier.
3. At the OCR step upload that case's `rx*` and `lab*` images, and verify the
   extraction before continuing. Verification is mandatory in the pipeline by
   design; nothing reaches triage unverified.
4. Compare the assigned tier against the table above.

## Why case 05 holds no documents

Case 05 is not a fifth patient. It is patient 03 deteriorating — the same woman,
re-entered with collapse vitals, as described at the foot of the demographics
sheet. It exercises the danger-zone path and the hospital-referral screen, which
are reached on vitals alone. A collapsing patient arrives without paperwork, and
the pack reflects that rather than inventing documents she would not be carrying.
