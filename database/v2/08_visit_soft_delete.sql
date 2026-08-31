-- ============================================================================
-- Withdrawing an accidental case.
--
-- An assistant opening a visit on the wrong patient had no way to undo it: the
-- record stayed in the register and in the patient's history forever. This adds
-- the withdrawal, deliberately as a soft delete.
--
-- Soft, not hard, because the thing being removed is a clinical record. A
-- mistyped Aadhaar means the wrong patient's history is showing an entry that
-- is not theirs, which is worth fixing — but a DELETE makes an operator error
-- unrecoverable, and "I deleted the wrong case" has no remedy at all. The row
-- stays, stops being visible, and says who withdrew it and why.
--
-- Deletion is refused once a case has reached a doctor or has a consultation
-- attached; that rule lives in the controller, where the related tables can be
-- checked. Because of it, a withdrawable visit by definition has no
-- assigned_doctor_id and no consultation — so the doctor-facing queries, which
-- all filter on assigned_doctor_id, already exclude these rows without change.
-- Only the assistant's own reads need the new filter.
-- ============================================================================

BEGIN;

ALTER TABLE visits ADD COLUMN IF NOT EXISTS deleted_at      TIMESTAMPTZ;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS deleted_by      UUID REFERENCES staff_profiles(id) ON DELETE SET NULL;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS deletion_reason TEXT;

-- Almost every read wants the live rows, and almost every row is live. A
-- partial index keeps that lookup cheap without indexing the withdrawn ones.
CREATE INDEX IF NOT EXISTS idx_visits_live
  ON visits (district_id, created_at DESC)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN visits.deleted_at IS
  'Set when a clinic assistant withdraws an accidental entry. Withdrawn visits are hidden from every clinical read but never removed.';

COMMIT;
