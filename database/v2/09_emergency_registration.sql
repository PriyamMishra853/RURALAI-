-- ============================================================================
-- Emergency registration: absent identity data stays absent.
--
-- `registration_mode` has carried an `emergency_bypass` value since v2, but the
-- table could not actually hold such a record. phone, pin_code, village_line1,
-- address_district and address_state_id were all NOT NULL, and phone and
-- pin_code additionally had to match real Indian formats. Registering a patient
-- who arrives unconscious with no documents therefore required inventing a
-- mobile number and a PIN code that would pass those checks — fabricated values
-- indistinguishable from real ones, written into a clinical record.
--
-- The columns become nullable, and a conditional constraint keeps the
-- requirement exactly where it belongs: a standard or ABHA registration must
-- still carry all of it. Only an emergency bypass may leave it empty, and the
-- empty fields then say plainly that the data was never collected.
--
-- The existing format checks are unchanged and still apply to any value that IS
-- present: a CHECK passes on NULL, so `pin_code ~ '^[1-9][0-9]{5}$'` continues
-- to reject a malformed PIN while permitting a missing one.
--
-- date_of_birth stays NOT NULL on purpose. Age drives triage — riskEngine
-- thresholds differ for children and the elderly — so an estimated age is
-- required even in an emergency. An estimate is normal clinical practice; a
-- missing one would silently change how the patient is scored.
-- ============================================================================

BEGIN;

ALTER TABLE patients ALTER COLUMN phone            DROP NOT NULL;
ALTER TABLE patients ALTER COLUMN pin_code         DROP NOT NULL;
ALTER TABLE patients ALTER COLUMN village_line1    DROP NOT NULL;
ALTER TABLE patients ALTER COLUMN address_district DROP NOT NULL;
ALTER TABLE patients ALTER COLUMN address_state_id DROP NOT NULL;

ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_identity_required_unless_emergency;
ALTER TABLE patients ADD CONSTRAINT patients_identity_required_unless_emergency CHECK (
  registration_mode = 'emergency_bypass'
  OR (
    phone            IS NOT NULL AND
    pin_code         IS NOT NULL AND
    village_line1    IS NOT NULL AND
    address_district IS NOT NULL AND
    address_state_id IS NOT NULL
  )
);

-- Finding the provisional records later is the whole point of `reconciled_at`:
-- an emergency patient is meant to be completed once their documents turn up.
CREATE INDEX IF NOT EXISTS idx_patients_unreconciled_emergency
  ON patients (clinic_district_id, created_at DESC)
  WHERE registration_mode = 'emergency_bypass' AND reconciled_at IS NULL;

COMMENT ON COLUMN patients.reconciled_at IS
  'Set when an emergency_bypass record has had its real identity details filled in.';

COMMIT;
