-- ============================================================================
-- Baseline outcome metrics (Roadmap v3, Phase 0).
--
-- Every later phase claims to improve something the problem statement names —
-- earlier consultation, less waiting, better referral completion, better
-- follow-up. A claim of improvement needs a before, and the before has to be
-- recorded before the change, not reconstructed after it.
--
-- So this measures what the platform already records, and nothing it would
-- have to guess:
--
--   intake_minutes                registration -> first AI assessment
--   registration_to_decision      registration -> first doctor decision
--   handoff_to_decision           handed to a doctor -> that doctor's decision
--   instant_consult_wait          instant consultation requested -> call started
--   scheduled_consult_start_delay scheduled start -> call actually started
--
-- Two outcomes the PS names are deliberately NOT here, because the platform
-- cannot measure them yet and a made-up proxy would be worse than a gap:
--
--   referral completion  a facility referral records what was shown and has no
--                        status, so nobody knows whether the patient arrived
--   follow-up adherence  a follow-up decision stores a day count that nothing
--                        acts on
--
-- The count of follow-up decisions IS returned — it is the size of the problem
-- Phase 4 exists to fix.
--
-- Demo data is excluded by default. Every seeded visit is synthetic, and a
-- baseline computed from invented timings describes nothing.
--
-- Additive: one new function, no table or column changes. Scope is passed in
-- rather than read from the session, exactly as admin_analytics() does.
-- ============================================================================

BEGIN;

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

    -- Negative means the call started early; that is kept, not clipped.
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
       WHERE r.decision = 'follow_up')
  );
$$;

COMMIT;
