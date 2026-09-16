-- ============================================================================
-- Follow-up recall (Roadmap v3, Phase 4).
--
-- A doctor's "follow up in N days" was a sentence appended to the clinical
-- notes. Nothing scheduled it, nobody was reminded, and whether the patient came
-- back could not be known. baseline_metrics() counted the decisions and had to
-- list follow-up adherence as not measurable.
--
-- follow_ups holds one scheduled follow-up per decision:
--   due_at          decision time + the doctor's day count
--   window_ends_at  due_at + grace (1 day for <= 3, 3 for <= 14, 7 beyond),
--                   written at creation so the metric never re-derives the rule
--   status          scheduled -> completed | missed | cancelled
--   completed_via   return_visit (a visit for the same patient was created) or
--                   reported (staff recorded a return seen elsewhere)
--
-- A missed follow-up can still be completed by a later return visit: the
-- patient did come back, late, and the record should say so.
--
-- Additive: a new table and a replaced function. Nothing existing is altered.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS follow_ups (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id            UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
    patient_id          VARCHAR(12) NOT NULL REFERENCES patients(aadhaar_number) ON DELETE CASCADE,
    district_id         UUID NOT NULL REFERENCES districts(id) ON DELETE RESTRICT,
    created_by          UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
    interval_days       SMALLINT NOT NULL CHECK (interval_days BETWEEN 1 AND 90),
    due_at              TIMESTAMPTZ NOT NULL,
    window_ends_at      TIMESTAMPTZ NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'scheduled'
                        CHECK (status IN ('scheduled', 'completed', 'missed', 'cancelled')),
    completed_at        TIMESTAMPTZ,
    completed_via       VARCHAR(20) CHECK (completed_via IN ('return_visit', 'reported')),
    completed_visit_id  UUID REFERENCES visits(id) ON DELETE SET NULL,
    closed_reason       VARCHAR(30) CHECK (closed_reason IN (
                          'no_contact', 'declined', 'moved_away', 'cost', 'transport', 'other',
                          'referred_elsewhere', 'no_longer_needed', 'died', 'entered_in_error')),
    closed_at           TIMESTAMPTZ,
    contact_attempts    SMALLINT NOT NULL DEFAULT 0 CHECK (contact_attempts BETWEEN 0 AND 1000),
    last_contact_at     TIMESTAMPTZ,
    last_contact_result VARCHAR(20) CHECK (last_contact_result IN (
                          'will_come', 'no_answer', 'unreachable', 'declined', 'moved_away')),
    notes               VARCHAR(1000),
    last_updated_by     UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT follow_ups_window_after_due CHECK (window_ends_at >= due_at AND due_at > created_at),
    CONSTRAINT follow_ups_completed_shape CHECK (
      (status = 'completed') = (completed_at IS NOT NULL AND completed_via IS NOT NULL)),
    CONSTRAINT follow_ups_return_visit_named CHECK (
      completed_via IS DISTINCT FROM 'return_visit' OR completed_visit_id IS NOT NULL),
    CONSTRAINT follow_ups_closed_has_reason CHECK (
      status NOT IN ('missed', 'cancelled') OR (closed_reason IS NOT NULL AND closed_at IS NOT NULL))
);

-- One open follow-up per decision.
CREATE UNIQUE INDEX IF NOT EXISTS uq_follow_ups_one_open
    ON follow_ups (visit_id) WHERE status = 'scheduled';
-- The recall list: a district's open follow-ups by due date.
CREATE INDEX IF NOT EXISTS idx_follow_ups_recall
    ON follow_ups (district_id, status, due_at);
-- A return visit looks up its patient's open and missed follow-ups.
CREATE INDEX IF NOT EXISTS idx_follow_ups_patient
    ON follow_ups (patient_id, status);

ALTER TABLE follow_ups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS follow_ups_service_role ON follow_ups;
CREATE POLICY follow_ups_service_role ON follow_ups
    FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE follow_ups IS
  'A doctor''s follow-up decision, scheduled. Completed by the patient''s next visit or by staff recording a return seen elsewhere.';
COMMENT ON COLUMN follow_ups.window_ends_at IS
  'due_at plus grace. A follow-up still scheduled after this counts as missed in follow_up_adherence.';


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
    SELECT v.id, v.created_at, v.assigned_at, v.intake_started_at, v.intake_provenance,
           v.intake_provenance->>'mode' AS intake_mode
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
      sv.intake_mode,
      -- NULL, and so uncounted, wherever the real start is unknown.
      EXTRACT(EPOCH FROM (fa.at - sv.intake_started_at)) / 60.0 AS intake,
      EXTRACT(EPOCH FROM (fr.at - COALESCE(sv.intake_started_at, sv.created_at))) / 60.0 AS registration_to_decision,
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
  ),
  -- Follow-ups whose window has closed. One still inside it has not been kept
  -- or missed yet. A cancelled follow-up (died, referred elsewhere, entered in
  -- error) is not a miss and not a success, so it is left out of both.
  due_follow_ups AS (
    SELECT f.status, f.completed_at, f.completed_via, f.window_ends_at
      FROM follow_ups f
      JOIN scoped_visits sv ON sv.id = f.visit_id
     WHERE f.window_ends_at <= NOW()
       AND f.status <> 'cancelled'
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

    -- The comparison the CHATBOX has to win. Dictating the complaint counts as
    -- manual: it is how the form has always worked.
    'intake_minutes_by_mode', jsonb_build_object(
      'manual', (
        SELECT jsonb_build_object(
          'n',      count(intake),
          'median', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY intake))::numeric, 1),
          'p90',    round((percentile_cont(0.9) WITHIN GROUP (ORDER BY intake))::numeric, 1))
          FROM intervals WHERE intake >= 0 AND intake_mode = 'manual'),
      'voice_assisted', (
        SELECT jsonb_build_object(
          'n',      count(intake),
          'median', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY intake))::numeric, 1),
          'p90',    round((percentile_cont(0.9) WITHIN GROUP (ORDER BY intake))::numeric, 1))
          FROM intervals WHERE intake >= 0 AND intake_mode = 'voice_assisted')),

    'intake_provenance', (
      SELECT jsonb_build_object(
        'recorded',              count(*),
        'with_unconfirmed_defaults', count(*) FILTER (WHERE COALESCE((intake_provenance->'counts'->>'default_unconfirmed')::int, 0) > 0),
        'voice_assisted',        count(*) FILTER (WHERE intake_mode = 'voice_assisted'),
        'voice_fields',          COALESCE(sum((intake_provenance->'counts'->>'voice')::int), 0),
        'voice_fields_confirmed', COALESCE(sum((intake_provenance->'counts'->>'voice_confirmed')::int), 0),
        'voice_without_consent', count(*) FILTER (WHERE intake_mode = 'voice_assisted'
                                   AND (intake_provenance->'voice'->>'consent') IS DISTINCT FROM 'true'))
        FROM scoped_visits WHERE intake_provenance IS NOT NULL),

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

    -- Kept means back within the window. Late returns are counted apart, and
    -- a follow-up nobody closed is a miss: silence is not attendance.
    'follow_up_adherence', (
      SELECT jsonb_build_object(
        'due',      count(*),
        'kept',     count(*) FILTER (WHERE status = 'completed' AND completed_at <= window_ends_at),
        'late',     count(*) FILTER (WHERE status = 'completed' AND completed_at >  window_ends_at),
        'missed',   count(*) FILTER (WHERE status IN ('missed', 'scheduled')),
        'reported', count(*) FILTER (WHERE status = 'completed' AND completed_via = 'reported'),
        'rate',     CASE WHEN count(*) = 0 THEN NULL
                         ELSE round(count(*) FILTER (WHERE status = 'completed' AND completed_at <= window_ends_at)::numeric / count(*), 3)
                    END)
        FROM due_follow_ups),

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
