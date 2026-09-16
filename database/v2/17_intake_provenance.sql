-- ============================================================================
-- Intake provenance and a real intake start (Roadmap v3, Phase 2).
--
-- Two defects found in production data, not in theory:
--
--   intake_minutes measured nothing. It ran from visits.created_at to the first
--   assessment, but the visit row is created lazily AT the first assessment or
--   document upload. On the 30 real visits it had a median of 11 seconds and 25
--   of them were under a minute. The CHATBOX has to beat manual intake time,
--   and there was no manual intake time to beat.
--
--   Defaults were stored as measurements. The form opens at 98.6 F, 120/80,
--   78 bpm, 98 %, 16/min, and every field the assistant never touched is saved
--   into visit_vitals exactly like a reading. Nothing could tell them apart —
--   which is the first thing a learning system (Phase 5) needs to be able to do.
--
-- So visits gain:
--   intake_started_at   when the assistant began on the patient, derived from
--                       the client's elapsed time (never its clock)
--   intake_provenance   per field: typed, dictated, voice or default, and
--                       whether a person confirmed it; the intake mode; whether
--                       voice consent was recorded
--
-- baseline_metrics() now measures intake only where the start is known. Older
-- visits are left out of intake time rather than counted with a number that is
-- known to be wrong. registration_to_decision uses the real start when there
-- is one. Both columns are additive and nullable; nothing reads them to decide
-- anything clinical.
-- ============================================================================

BEGIN;

ALTER TABLE visits
  ADD COLUMN IF NOT EXISTS intake_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS intake_provenance JSONB;

-- The server writes intake_started_at a moment after the insert, from its own
-- clock, so a few minutes of slack either side is clock difference, not data.
ALTER TABLE visits DROP CONSTRAINT IF EXISTS visits_intake_started_at_sane;
ALTER TABLE visits ADD CONSTRAINT visits_intake_started_at_sane CHECK (
  intake_started_at IS NULL
  OR intake_started_at BETWEEN created_at - INTERVAL '4 hours 5 minutes'
                           AND created_at + INTERVAL '5 minutes'
);

ALTER TABLE visits DROP CONSTRAINT IF EXISTS visits_intake_provenance_shape;
ALTER TABLE visits ADD CONSTRAINT visits_intake_provenance_shape CHECK (
  intake_provenance IS NULL
  OR (jsonb_typeof(intake_provenance) = 'object'
      AND intake_provenance->>'mode' IN ('manual', 'voice_assisted')
      AND jsonb_typeof(intake_provenance->'fields') = 'object')
);

COMMENT ON COLUMN visits.intake_started_at IS
  'When the assistant began the intake: the server time at visit creation minus the elapsed time the client measured. NULL for visits before migration 17, and for visits opened from an earlier session.';
COMMENT ON COLUMN visits.intake_provenance IS
  'Per field: source (typed | dictated | voice | default) and whether a person confirmed it, as the form stood at the latest assessment. A default stays a default even when confirmed as measured. Written by intakeProvenanceRules.normaliseProvenance.';


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
