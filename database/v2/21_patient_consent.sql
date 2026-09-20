-- ============================================================================
-- Patient consent (Roadmap v3, Phase 3).
--
-- Phase 3's scope names three consents and keeps them apart on purpose:
--
--   treatment            being seen, assessed and treated here
--   share_with_facility  this record leaving the clinic — the hospital it is
--                        referred to, another district, an export
--   training             the record being used to improve the models
--
-- Bundling them would make the third free-riding on the first, which is the
-- failure mode the DPDP Act 2023 and every ethics committee look for. Agreeing
-- to be treated is not agreeing to be a training example.
--
-- What is recorded is what would be needed to show the consent was informed:
-- the purpose, the language it was explained in, how it was taken (spoken,
-- written, thumb impression), the version of the wording that was read out,
-- and who recorded it. A consent nobody can reconstruct is not evidence of
-- anything.
--
-- Withdrawal is a state, not a deletion: the record has to show that consent
-- existed and then ended, and when.
--
-- Sharing consent expires — 180 days by default — because a patient agreeing
-- in March that their record may go to a hospital is not agreeing to every
-- disclosure for the rest of their life. Treatment and training consent run
-- until withdrawn.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS patient_consents (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id       VARCHAR(12) NOT NULL REFERENCES patients(aadhaar_number) ON DELETE CASCADE,
    district_id      UUID NOT NULL REFERENCES districts(id) ON DELETE RESTRICT,
    purpose          VARCHAR(30) NOT NULL
                     CHECK (purpose IN ('treatment', 'share_with_facility', 'training')),
    status           VARCHAR(20) NOT NULL DEFAULT 'granted'
                     CHECK (status IN ('granted', 'withdrawn')),
    -- How it was taken. A thumb impression is how a patient who cannot write
    -- consents, and recording it as "written" would misdescribe the evidence.
    method           VARCHAR(20) NOT NULL
                     CHECK (method IN ('verbal', 'written', 'thumb_impression')),
    -- The language it was explained in. Consent obtained in a language the
    -- patient does not read is not informed consent.
    language         VARCHAR(12) NOT NULL,
    -- Which wording was read out, so a later reader knows what was agreed to.
    wording_version  VARCHAR(20) NOT NULL,
    granted_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at       TIMESTAMPTZ,
    withdrawn_at     TIMESTAMPTZ,
    withdrawn_reason VARCHAR(200),
    recorded_by      UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
    withdrawn_by     UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
    note             VARCHAR(500),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT patient_consents_withdrawn_shape CHECK (
      (status = 'withdrawn') = (withdrawn_at IS NOT NULL)),
    CONSTRAINT patient_consents_expiry_after_grant CHECK (
      expires_at IS NULL OR expires_at > granted_at)
);

-- One live consent per purpose. A second grant replaces the first by
-- withdrawing it, so the history stays readable.
CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_consents_active
    ON patient_consents (patient_id, purpose) WHERE status = 'granted';
CREATE INDEX IF NOT EXISTS idx_patient_consents_patient
    ON patient_consents (patient_id, status);

ALTER TABLE patient_consents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS patient_consents_service ON patient_consents;
CREATE POLICY patient_consents_service ON patient_consents
    FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE patient_consents IS
  'What a patient has agreed to, per purpose, with what it would take to show the agreement was informed. Withdrawal is a state, never a delete.';
COMMENT ON COLUMN patient_consents.expires_at IS
  'Sharing consent expires (180 days by default). Treatment and training consent run until withdrawn.';


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

    -- Governance, not clinical: how many patients have agreed to what. Phase 5
    -- cannot start without training consent, and sharing a record outside the
    -- clinic needs its own. Counted over patients registered in scope.
    'consent', (
      SELECT jsonb_build_object(
        'patients',            count(DISTINCT p.aadhaar_number),
        'treatment',           count(DISTINCT c.patient_id) FILTER (WHERE c.purpose = 'treatment'),
        'share_with_facility', count(DISTINCT c.patient_id) FILTER (WHERE c.purpose = 'share_with_facility'),
        'training',            count(DISTINCT c.patient_id) FILTER (WHERE c.purpose = 'training'))
        FROM patients p
        LEFT JOIN patient_consents c
               ON c.patient_id = p.aadhaar_number
              AND c.status = 'granted'
              AND (c.expires_at IS NULL OR c.expires_at > NOW())
       WHERE (scope_district IS NULL OR p.clinic_district_id = scope_district)
         AND (scope_state    IS NULL OR p.clinic_district_id IN (
               SELECT d.id FROM districts d WHERE d.state_id = scope_state))),

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
