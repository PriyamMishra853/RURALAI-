-- Mark demo patient records explicitly.
--
-- Test and demonstration records are currently indistinguishable from real
-- patients in the UI. The only thing separating them is a "PLACEHOLDER_DEMO"
-- prefix on full_name, which is not something the application should be
-- matching strings against at runtime: a renamed record silently becomes a
-- real one, and a real patient whose name happened to contain the prefix would
-- be mislabelled.
--
-- Clinical records are append-only (plan §B.1), so these rows stay. They are
-- flagged instead of deleted.
--
-- Apply with: paste into the Supabase SQL Editor and run. Safe to re-run.

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN patients.is_demo IS
  'True for demonstration and test records. Never set this on a real patient. The UI badges these rows so nobody mistakes them for clinical data.';

-- Backfill the three known test records by primary key rather than by name.
-- Explicit ids are exact; a LIKE on full_name is a guess that happens to be
-- right today.
UPDATE patients
   SET is_demo = TRUE
 WHERE id IN (
   '47e3cd80-eaf4-4132-97ac-a4b310d0f5f4',  -- PAT-2026-8876
   '9fb5875d-4586-4c0c-be83-d2ccc90b9e10',  -- PAT-2026-8339
   'd9c5647a-0e7d-4714-b61a-c25048531ea4'   -- PAT-2026-4725
 );

-- Partial index: the demo set is tiny and the common query is "exclude demo",
-- so index only the rows that are actually flagged.
CREATE INDEX IF NOT EXISTS idx_patients_is_demo
  ON patients (is_demo)
  WHERE is_demo = TRUE;
