-- ============================================================================
-- The fields the intake form collects, and how the CHATBOX is doing
-- (Roadmap v3, F2 / Phase 2).
--
-- Three fields the CHATBOX hears, and F2 names, had nowhere to be stored, so
-- the form had nowhere to show them and a value said out loud was discarded:
--
--   current medicines   visits.current_medications already existed; the form
--                       simply had no input. No column needed.
--   pregnancy           nothing anywhere. It changes triage and which facility
--                       can receive a referral, so it is recorded per visit —
--                       NULL means nobody asked, which is not the same as "no".
--   blood glucose       visit_vitals.blood_glucose_mgdl already existed and was
--                       validated; again, no input. No column needed.
--
-- And two the manual form has always collected and thrown away: weight and
-- height were typed into the form, validated, and then dropped because
-- visit_vitals had no column for them.
--
-- baseline_metrics() also gains the two CHATBOX measures F2 asks for: how often
-- a heard value had to be corrected rather than merely confirmed, and how many
-- sessions were opened against how many produced anything. Both are counted
-- from intake_provenance, which is already written at every assessment.
--
-- Additive: new nullable columns and a replaced function.
-- ============================================================================

BEGIN;

ALTER TABLE visits
  ADD COLUMN IF NOT EXISTS is_pregnant BOOLEAN;

ALTER TABLE visit_vitals
  ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS height_cm NUMERIC(4,1);

ALTER TABLE visit_vitals DROP CONSTRAINT IF EXISTS visit_vitals_weight_kg_check;
ALTER TABLE visit_vitals ADD CONSTRAINT visit_vitals_weight_kg_check
  CHECK (weight_kg IS NULL OR weight_kg BETWEEN 0.5 AND 500);
ALTER TABLE visit_vitals DROP CONSTRAINT IF EXISTS visit_vitals_height_cm_check;
ALTER TABLE visit_vitals ADD CONSTRAINT visit_vitals_height_cm_check
  CHECK (height_cm IS NULL OR height_cm BETWEEN 20 AND 250);

COMMENT ON COLUMN visits.is_pregnant IS
  'Pregnancy status for this visit. NULL means it was not asked or does not apply — never read as false.';
COMMENT ON COLUMN visit_vitals.weight_kg IS
  'Weight in kilograms. The form collected this from the start; until migration 19 there was no column and it was discarded.';


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
        'voice_fields_corrected', COALESCE(sum((intake_provenance->'counts'->>'voice_edited')::int), 0),
        'voice_sessions_applied', COALESCE(sum((intake_provenance->'voice'->>'sessions')::int), 0),
        'voice_sessions_opened',  COALESCE(sum((intake_provenance->'voice'->>'opened')::int), 0),
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
