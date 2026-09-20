-- ============================================================================
-- District outcome dashboard (Roadmap v3, Phase 7).
--
-- baseline_metrics() answers "how is this scope doing" as one set of numbers.
-- A state administrator needs the other question: which districts, of the
-- thirty-six, are the ones to ask about. One median for Maharashtra hides the
-- district where nobody is following anything up.
--
-- So this returns one row per district with the outcomes the problem statement
-- names, and the sample size beside each — because a median of three cases is
-- not a finding, and a dashboard that hides n invites exactly that mistake.
--
-- Every number here already exists in baseline_metrics(); this is the same
-- arithmetic grouped by district, so the two can never disagree about what a
-- word means. Counts only: no patient, visit or staff member is identifiable.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION district_outcomes(
  scope_state    UUID    DEFAULT NULL,
  scope_district UUID    DEFAULT NULL,
  window_days    INT     DEFAULT 30,
  include_demo   BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  WITH params AS (
    SELECT GREATEST(1, LEAST(COALESCE(window_days, 30), 365)) AS days
  ),
  scoped_districts AS (
    SELECT d.id, d.name, s.name AS state_name
      FROM districts d
      JOIN states s ON s.id = d.state_id
     WHERE (scope_district IS NULL OR d.id = scope_district)
       AND (scope_state    IS NULL OR d.state_id = scope_state)
  ),
  scoped_visits AS (
    SELECT v.id, v.district_id, v.created_at, v.intake_started_at
      FROM visits v, params
     WHERE v.deleted_at IS NULL
       AND v.created_at >= NOW() - make_interval(days => params.days)
       AND (include_demo OR NOT v.is_demo)
       AND v.district_id IN (SELECT id FROM scoped_districts)
  ),
  first_review AS (
    SELECT r.visit_id, MIN(r.created_at) AS at
      FROM doctor_reviews r JOIN scoped_visits sv ON sv.id = r.visit_id
     GROUP BY r.visit_id
  ),
  decisions AS (
    SELECT sv.district_id,
           EXTRACT(EPOCH FROM (fr.at - COALESCE(sv.intake_started_at, sv.created_at))) / 60.0 AS minutes
      FROM scoped_visits sv JOIN first_review fr ON fr.visit_id = sv.id
  ),
  waits AS (
    SELECT sv.district_id,
           EXTRACT(EPOCH FROM (c.actual_start_time - c.created_at)) / 60.0 AS minutes
      FROM consultations c JOIN scoped_visits sv ON sv.id = c.visit_id
     WHERE c.actual_start_time IS NOT NULL AND c.consultation_type = 'INSTANT'
  ),
  referrals AS (
    SELECT sv.district_id, hr.status
      FROM hospital_referrals hr JOIN scoped_visits sv ON sv.id = hr.visit_id
     WHERE hr.follow_up_due_at <= NOW()
  ),
  follow_ups AS (
    SELECT sv.district_id, f.status, f.completed_at, f.window_ends_at
      FROM follow_ups f JOIN scoped_visits sv ON sv.id = f.visit_id
     WHERE f.window_ends_at <= NOW() AND f.status <> 'cancelled'
  ),
  consents AS (
    SELECT p.clinic_district_id AS district_id,
           count(DISTINCT p.aadhaar_number) AS patients,
           count(DISTINCT c.patient_id) FILTER (
             WHERE c.purpose = 'share_with_facility' AND c.status = 'granted'
               AND (c.expires_at IS NULL OR c.expires_at > NOW())) AS sharing
      FROM patients p
      LEFT JOIN patient_consents c ON c.patient_id = p.aadhaar_number
     WHERE p.clinic_district_id IN (SELECT id FROM scoped_districts)
     GROUP BY p.clinic_district_id
  )
  SELECT jsonb_build_object(
    'window_days',  (SELECT days FROM params),
    'include_demo', include_demo,
    'generated_at', NOW(),
    'districts', COALESCE((
      SELECT jsonb_agg(row ORDER BY row->>'district')
        FROM (
          SELECT jsonb_build_object(
            'district', sd.name,
            'state',    sd.state_name,
            'visits',   (SELECT count(*) FROM scoped_visits sv WHERE sv.district_id = sd.id),
            'decision_minutes', (
              SELECT jsonb_build_object(
                'n', count(*),
                'median', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes))::numeric, 1))
                FROM decisions WHERE district_id = sd.id AND minutes >= 0),
            'instant_consult_wait_minutes', (
              SELECT jsonb_build_object(
                'n', count(*),
                'median', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes))::numeric, 1))
                FROM waits WHERE district_id = sd.id AND minutes >= 0),
            'referral_completion', (
              SELECT jsonb_build_object(
                'due', count(*),
                'rate', CASE WHEN count(*) = 0 THEN NULL
                             ELSE round(count(*) FILTER (WHERE status IN ('reached', 'closed'))::numeric / count(*), 3) END)
                FROM referrals WHERE district_id = sd.id),
            'follow_up_adherence', (
              SELECT jsonb_build_object(
                'due', count(*),
                'rate', CASE WHEN count(*) = 0 THEN NULL
                             ELSE round(count(*) FILTER (
                               WHERE status = 'completed' AND completed_at <= window_ends_at)::numeric / count(*), 3) END)
                FROM follow_ups WHERE district_id = sd.id),
            'sharing_consent', (
              SELECT jsonb_build_object(
                'patients', COALESCE(max(patients), 0),
                'granted',  COALESCE(max(sharing), 0))
                FROM consents WHERE district_id = sd.id)
          ) AS row
          FROM scoped_districts sd
        ) rows), '[]'::jsonb)
  );
$$;

COMMENT ON FUNCTION district_outcomes IS
  'One row per district with the outcomes the problem statement names, and the sample size beside each. Same arithmetic as baseline_metrics(), grouped by district. Counts only — nobody is identifiable.';

COMMIT;
