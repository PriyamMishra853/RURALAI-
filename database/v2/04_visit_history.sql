-- ============================================================================
-- Visit history fields.
--
-- The assessment page collects known medical history and allergies, and both
-- feed the AI orchestrator's prompt (combinedHistory / combinedAllergies), but
-- v2 had nowhere to store them — so the values were discarded on every save and
-- the "Known Medical History / Chronic Illness" field appeared not to work.
-- ============================================================================

BEGIN;

ALTER TABLE visits ADD COLUMN IF NOT EXISTS medical_history TEXT;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS known_allergies TEXT;

-- Symptom duration is captured as a number plus a unit so it can be reasoned
-- about, and rendered as text for the prompt. Kept alongside the existing
-- free-text column rather than replacing it: the orchestrator reads the text.
ALTER TABLE visits ADD COLUMN IF NOT EXISTS symptom_duration_value INTEGER
  CHECK (symptom_duration_value IS NULL OR symptom_duration_value BETWEEN 1 AND 999);
ALTER TABLE visits ADD COLUMN IF NOT EXISTS symptom_duration_unit VARCHAR(10)
  CHECK (symptom_duration_unit IS NULL OR symptom_duration_unit IN ('days', 'months', 'years'));

COMMIT;
