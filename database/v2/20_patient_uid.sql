-- ============================================================================
-- An internal patient identifier (Roadmap v3, Phase 3).
--
-- patients.aadhaar_number is the primary key, so every foreign key, every URL
-- this system ever builds and every export would otherwise carry a national
-- identity number. Phase 3's exit criterion is the opposite: "No patient is
-- keyed on Aadhaar."
--
-- This is the first half of that change, and it is additive. Every patient
-- gains a stable, meaningless UUID. Nothing is re-keyed here — re-pointing the
-- foreign keys is a contraction and waits until the checkpoint is retired
-- (ground rule 5) — but from now on:
--
--   * anything leaving this system identifies the patient by patient_uid
--     (the FHIR export is the first caller),
--   * Aadhaar stays an attribute of the record rather than its name,
--   * and a later migration can re-point the foreign keys without inventing
--     identifiers for rows that already exist.
--
-- The UUID is random, not derived from the Aadhaar number: a hash of a
-- 12-digit number with a known format is reversible by anyone with a laptop.
-- ============================================================================

BEGIN;

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS patient_uid UUID NOT NULL DEFAULT gen_random_uuid();

-- One patient, one identifier, for as long as the row exists.
CREATE UNIQUE INDEX IF NOT EXISTS uq_patients_patient_uid ON patients (patient_uid);

COMMENT ON COLUMN patients.patient_uid IS
  'Internal identifier for anything that leaves this system — exports, future ABHA linkage, cross-facility sharing. Random, never derived from the Aadhaar number, and never shown to a patient as a code to quote.';

COMMIT;
