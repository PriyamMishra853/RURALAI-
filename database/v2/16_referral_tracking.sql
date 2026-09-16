-- ============================================================================
-- Closed-loop hospital referral (Roadmap v3, Phase 1).
--
-- Until now a referral to hospital was a sentence in a doctor's note and a
-- visit status of 'referred'. Nothing recorded whether the patient reached the
-- hospital, so the outcome the problem statement names — referral completion —
-- could not be measured, and nobody was prompted to find out. In rural
-- practice that is exactly where patients are lost: cost, transport, a family
-- that decides against it.
--
-- One row per referral that is being followed up. It is created by an explicit
-- act — a doctor's refer_hospital decision, or an assistant confirming an
-- emergency is being sent — never inferred from a hospital being displayed.
-- The existing `referrals` table stays what it is: an audit of what was shown.
--
-- Two ways the loop closes:
--   · the referring clinic follows up (phone, home visit) before the due time
--   · the receiving hospital confirms arrival from a link on the referral slip,
--     with no account. The token is stored only as a SHA-256 hash, expires, and
--     can only move a referral forward.
--
-- Additive. baseline_metrics() is replaced with the same signature and one new
-- key, so the admin card and API keep working with or without this migration.
-- ============================================================================

ALTER TYPE notification_event ADD VALUE IF NOT EXISTS 'REFERRAL_REACHED';
ALTER TYPE notification_event ADD VALUE IF NOT EXISTS 'REFERRAL_OUTCOME';

BEGIN;

CREATE TABLE IF NOT EXISTS hospital_referrals (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id             UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  patient_id           VARCHAR(12) REFERENCES patients(aadhaar_number) ON DELETE SET NULL,
  district_id          UUID REFERENCES districts(id) ON DELETE SET NULL,

  origin               VARCHAR(20) NOT NULL CHECK (origin IN ('doctor_decision', 'emergency')),
  urgency              VARCHAR(10) NOT NULL CHECK (urgency IN ('emergency', 'routine')),
  hospital_name        TEXT NOT NULL CHECK (length(btrim(hospital_name)) BETWEEN 1 AND 200),
  hospital_district    TEXT,
  referral_code        VARCHAR(16) NOT NULL UNIQUE,
  referred_by          UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,

  status               VARCHAR(20) NOT NULL DEFAULT 'referred'
                       CHECK (status IN ('referred', 'reached', 'not_reached', 'closed', 'lost_to_follow_up')),
  not_reached_reason   VARCHAR(24)
                       CHECK (not_reached_reason IS NULL OR not_reached_reason IN
                         ('cost', 'transport', 'distance', 'family_refused', 'improved', 'died_before_arrival', 'other')),
  outcome              VARCHAR(24)
                       CHECK (outcome IS NULL OR outcome IN
                         ('admitted', 'treated_discharged', 'referred_onward', 'left_against_advice', 'died')),
  notes                TEXT CHECK (notes IS NULL OR length(notes) <= 1000),

  follow_up_due_at     TIMESTAMPTZ NOT NULL,
  reached_at           TIMESTAMPTZ,
  reached_via          VARCHAR(10) CHECK (reached_via IS NULL OR reached_via IN ('staff', 'hospital')),
  closed_at            TIMESTAMPTZ,
  last_updated_by      UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,

  ack_token_hash       CHAR(64) UNIQUE,
  ack_token_expires_at TIMESTAMPTZ,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The states must mean what they say, whichever code path wrote them.
  CONSTRAINT hr_not_reached_has_reason CHECK (status <> 'not_reached' OR not_reached_reason IS NOT NULL),
  CONSTRAINT hr_closed_has_outcome     CHECK (status <> 'closed' OR outcome IS NOT NULL),
  CONSTRAINT hr_reached_has_time       CHECK (status NOT IN ('reached', 'closed') OR reached_at IS NOT NULL)
);

-- One referral being followed up per visit. Two open referrals for one patient
-- would split the follow-up between two lists and count the patient twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_hospital_referrals_one_open
  ON hospital_referrals (visit_id) WHERE status IN ('referred', 'reached');

CREATE INDEX IF NOT EXISTS idx_hospital_referrals_worklist
  ON hospital_referrals (district_id, status, follow_up_due_at);
CREATE INDEX IF NOT EXISTS idx_hospital_referrals_visit
  ON hospital_referrals (visit_id);

ALTER TABLE hospital_referrals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hospital_referrals_service ON hospital_referrals;
CREATE POLICY hospital_referrals_service ON hospital_referrals
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE hospital_referrals IS
  'A referral to hospital that is being followed up until the patient is known to have arrived, not arrived, or been lost. Created by a doctor decision or an assistant-confirmed emergency, never inferred.';
COMMENT ON COLUMN hospital_referrals.ack_token_hash IS
  'SHA-256 of the hospital acknowledgement token. The token itself is never stored; reprinting the slip issues a new one.';
COMMENT ON COLUMN hospital_referrals.follow_up_due_at IS
  'When the referring clinic should know the answer: 24 h for emergencies, 72 h otherwise. Unknown after this counts against completion, not for it.';


CREATE OR REPLACE FUNCTION baseline_metrics(
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
  scoped_visits AS (
    SELECT v.id, v.created_at, v.assigned_at
      FROM visits v, params
     WHERE v.deleted_at IS NULL
       AND v.created_at >= NOW() - make_interval(days => params.days)
       AND (include_demo OR NOT v.is_demo)
       AND (scope_district IS NULL OR v.district_id = scope_district)
       AND (scope_state    IS NULL OR v.district_id IN (
             SELECT d.id FROM districts d WHERE d.state_id = scope_state))
  ),
  first_assessment AS (
    SELECT a.visit_id, MIN(a.created_at) AS at
      FROM ai_assessments a
      JOIN scoped_visits sv ON sv.id = a.visit_id
     GROUP BY a.visit_id
  ),
  first_review AS (
    SELECT r.visit_id, MIN(r.created_at) AS at
      FROM doctor_reviews r
      JOIN scoped_visits sv ON sv.id = r.visit_id
     GROUP BY r.visit_id
  ),
  intervals AS (
    SELECT
      EXTRACT(EPOCH FROM (fa.at - sv.created_at)) / 60.0 AS intake,
      EXTRACT(EPOCH FROM (fr.at - sv.created_at)) / 60.0 AS registration_to_decision,
      CASE WHEN sv.assigned_at IS NOT NULL
           THEN EXTRACT(EPOCH FROM (fr.at - sv.assigned_at)) / 60.0 END AS handoff_to_decision
      FROM scoped_visits sv
      LEFT JOIN first_assessment fa ON fa.visit_id = sv.id
      LEFT JOIN first_review     fr ON fr.visit_id = sv.id
  ),
  started_consultations AS (
    SELECT c.consultation_type,
           EXTRACT(EPOCH FROM (c.actual_start_time - c.created_at)) / 60.0           AS since_request,
           EXTRACT(EPOCH FROM (c.actual_start_time - c.scheduled_start_time)) / 60.0 AS since_scheduled
      FROM consultations c
      JOIN scoped_visits sv ON sv.id = c.visit_id
     WHERE c.actual_start_time IS NOT NULL
  ),
  -- Only referrals whose follow-up is due. One still inside its window is
  -- neither a success nor a failure yet; one past it with no answer is counted
  -- as not completed, because an unknown is not an arrival.
  due_referrals AS (
    SELECT hr.status
      FROM hospital_referrals hr
      JOIN scoped_visits sv ON sv.id = hr.visit_id
     WHERE hr.follow_up_due_at <= NOW()
  )
  SELECT jsonb_build_object(
    'window_days',  (SELECT days FROM params),
    'include_demo', include_demo,
    'visits',       (SELECT count(*) FROM scoped_visits),

    'intake_minutes', (
      SELECT jsonb_build_object(
        'n',      count(intake),
        'median', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY intake))::numeric, 1),
        'p90',    round((percentile_cont(0.9) WITHIN GROUP (ORDER BY intake))::numeric, 1))
        FROM intervals WHERE intake >= 0),

    'registration_to_decision_minutes', (
      SELECT jsonb_build_object(
        'n',      count(registration_to_decision),
        'median', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY registration_to_decision))::numeric, 1),
        'p90',    round((percentile_cont(0.9) WITHIN GROUP (ORDER BY registration_to_decision))::numeric, 1))
        FROM intervals WHERE registration_to_decision >= 0),

    'handoff_to_decision_minutes', (
      SELECT jsonb_build_object(
        'n',      count(handoff_to_decision),
        'median', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY handoff_to_decision))::numeric, 1),
        'p90',    round((percentile_cont(0.9) WITHIN GROUP (ORDER BY handoff_to_decision))::numeric, 1))
        FROM intervals WHERE handoff_to_decision >= 0),

    'instant_consult_wait_minutes', (
      SELECT jsonb_build_object(
        'n',      count(since_request),
        'median', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY since_request))::numeric, 1),
        'p90',    round((percentile_cont(0.9) WITHIN GROUP (ORDER BY since_request))::numeric, 1))
        FROM started_consultations
       WHERE consultation_type = 'INSTANT' AND since_request >= 0),

    'scheduled_consult_start_delay_minutes', (
      SELECT jsonb_build_object(
        'n',      count(since_scheduled),
        'median', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY since_scheduled))::numeric, 1),
        'p90',    round((percentile_cont(0.9) WITHIN GROUP (ORDER BY since_scheduled))::numeric, 1))
        FROM started_consultations
       WHERE consultation_type = 'SCHEDULED'),

    'follow_up_decisions', (
      SELECT count(*)
        FROM doctor_reviews r
        JOIN scoped_visits sv ON sv.id = r.visit_id
       WHERE r.decision = 'follow_up'),

    'referral_completion', (
      SELECT jsonb_build_object(
        'due',         count(*),
        'reached',     count(*) FILTER (WHERE status IN ('reached', 'closed')),
        'not_reached', count(*) FILTER (WHERE status IN ('not_reached', 'lost_to_follow_up')),
        'unknown',     count(*) FILTER (WHERE status = 'referred'),
        'rate',        CASE WHEN count(*) = 0 THEN NULL
                            ELSE round(count(*) FILTER (WHERE status IN ('reached', 'closed'))::numeric / count(*), 3)
                       END)
        FROM due_referrals)
  );
$$;

COMMIT;
