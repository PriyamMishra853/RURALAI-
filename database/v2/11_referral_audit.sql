-- ============================================================================
-- Referral records.
--
-- When a case is triaged EMERGENCY or HIGH the platform sends a patient to a
-- hospital, and that is a clinical decision like any other. It has to be
-- reconstructable afterwards: which hospital, how far it was said to be, and
-- critically WHERE the coordinates came from — a referral computed from a good
-- GPS fix and one computed from the clinic's district centroid can name
-- different hospitals, and if the wrong patient went to the wrong place that
-- distinction is the whole enquiry.
--
-- Distance and ETA are stored as they were SHOWN, not as they would be
-- recomputed later. The question after an incident is what the health worker
-- was looking at when they decided, and a value recomputed from today's road
-- data does not answer it.
--
-- Capacity is deliberately absent, as everywhere else in this feature: there
-- is no live bed feed for UP district hospitals, and a column here would
-- invite one to be invented. See _meta in up_district_hospitals.json and
-- MASTER_PLAN §0 item 2.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS referrals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id       UUID REFERENCES visits(id) ON DELETE CASCADE,
  patient_id     VARCHAR(12) REFERENCES patients(aadhaar_number) ON DELETE SET NULL,

  -- The tier that triggered it, as the engine reported it.
  risk_level     VARCHAR(12),

  -- Where the search started, and how that location was obtained. 'gps' is a
  -- live fix, 'district' the clinic's own coordinates, 'manual' a district the
  -- health worker picked when neither was available.
  origin_lat     DOUBLE PRECISION,
  origin_lon     DOUBLE PRECISION,
  origin_source  VARCHAR(12) NOT NULL
                 CHECK (origin_source IN ('gps', 'district', 'manual')),
  origin_accuracy_m DOUBLE PRECISION,

  hospital_name     TEXT,
  hospital_district TEXT,
  hospital_lat      DOUBLE PRECISION,
  hospital_lon      DOUBLE PRECISION,

  -- As displayed. distance_source says whether the number was a straight line
  -- or a road distance, so a 40 km reading is never mistaken for a 40 km drive.
  distance_km      NUMERIC(6, 1),
  distance_source  VARCHAR(20) NOT NULL DEFAULT 'straight-line',
  eta_text         TEXT,

  referred_by    UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
  district_id    UUID REFERENCES districts(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referrals_visit    ON referrals(visit_id);
CREATE INDEX IF NOT EXISTS idx_referrals_district ON referrals(district_id, created_at DESC);

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

-- Same visibility rule as everything else hanging off a visit: the clinic that
-- made the referral can see it, and a doctor can see referrals on their cases.
DROP POLICY IF EXISTS referrals_via_district ON referrals;
CREATE POLICY referrals_via_district ON referrals
  FOR ALL TO authenticated
  USING (
    district_id = auth_district()
    OR EXISTS (
      SELECT 1 FROM visits v
      WHERE v.id = referrals.visit_id AND v.assigned_doctor_id = auth_staff_id()
    )
  )
  WITH CHECK (district_id = auth_district());

COMMENT ON TABLE referrals IS
  'One row per referral shown to a health worker for an EMERGENCY or HIGH case. Records what was displayed at the moment of the decision, including where the coordinates came from.';

COMMIT;
