-- ============================================================================
-- Wound / clinical photographs.
--
-- ai.controller.js has been writing to `patient_images` since v1, but the v2
-- schema never recreated the table — so every wound photo the assistant
-- captured was analysed, shown once on screen, and then silently dropped. The
-- insert failure was caught and logged as a warning, which is exactly why it
-- went unnoticed: nothing user-facing broke, the doctor simply never saw the
-- photograph.
--
-- The vision OBSERVATION is stored alongside the image because it is what the
-- doctor actually reads, and re-running the model on an old photo would cost
-- money and could return something different.
-- ============================================================================

-- ALTER TYPE ... ADD VALUE cannot run inside a transaction, so this sits
-- above the BEGIN. It is idempotent.
ALTER TYPE notification_event ADD VALUE IF NOT EXISTS 'DOCTOR_REVIEW_COMPLETED';

BEGIN;

CREATE TABLE IF NOT EXISTS patient_images (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id     VARCHAR(12) REFERENCES patients(aadhaar_number) ON DELETE CASCADE,
  visit_id       UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,

  storage_bucket VARCHAR(60),
  storage_path   TEXT,
  image_url      TEXT,
  mime_type      VARCHAR(100),

  -- The full observational payload from visionService: body region, extent,
  -- possible_conditions (capped at "moderate" confidence), first aid and
  -- escalation triggers.
  observation    JSONB NOT NULL DEFAULT '{}'::jsonb,
  severity_impression VARCHAR(10)
                 CHECK (severity_impression IS NULL
                        OR severity_impression IN ('LOW', 'MEDIUM', 'HIGH')),
  engine         VARCHAR(60),

  uploaded_by    UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patient_images_visit   ON patient_images(visit_id);
CREATE INDEX IF NOT EXISTS idx_patient_images_patient ON patient_images(patient_id);

ALTER TABLE patient_images ENABLE ROW LEVEL SECURITY;

-- Same visibility as everything else hanging off a visit: the visit's own
-- policy decides, so a doctor sees photos for cases assigned to them and an
-- assistant sees photos in their own district.
DROP POLICY IF EXISTS images_via_visit ON patient_images;
CREATE POLICY images_via_visit ON patient_images
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM visits v WHERE v.id = patient_images.visit_id))
  WITH CHECK (EXISTS (SELECT 1 FROM visits v WHERE v.id = patient_images.visit_id));

-- ---------------------------------------------------------------------------
-- Doctor review visibility for the assistant.
--
-- §3.6: the doctor's review must reach the assistant's portal. `doctor_reviews`
-- previously had no policy allowing the assistant who opened the visit to read
-- it, so the loop could never close.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS reviews_readable_by_visit_clinicians ON doctor_reviews;
CREATE POLICY reviews_readable_by_visit_clinicians ON doctor_reviews
  FOR SELECT TO authenticated
  USING (
    doctor_id = auth_staff_id()
    OR EXISTS (
      SELECT 1 FROM visits v
      WHERE v.id = doctor_reviews.visit_id
        AND auth_role() = 'clinic_assistant'
        AND v.district_id = auth_district()
    )
  );

-- Prescriptions the doctor signs must reach the assistant too — they are what
-- the patient is actually given.
DROP POLICY IF EXISTS prescriptions_readable_by_visit_clinicians ON prescriptions;
CREATE POLICY prescriptions_readable_by_visit_clinicians ON prescriptions
  FOR SELECT TO authenticated
  USING (
    doctor_id = auth_staff_id()
    OR EXISTS (
      SELECT 1 FROM visits v
      WHERE v.id = prescriptions.visit_id
        AND auth_role() = 'clinic_assistant'
        AND v.district_id = auth_district()
    )
  );

COMMIT;
