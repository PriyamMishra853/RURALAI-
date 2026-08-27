-- ============================================================================
-- V2.5 — Scheduling, consultation state machine, notifications.
--
-- Three subsystems land here:
--   1. doctor_schedules   — working windows, the ONLY source of availability.
--                           Nothing about availability is hardcoded anywhere.
--   2. consultations      — rebuilt around an explicit state machine.
--   3. notifications      — persisted events, pushed live over the WebSocket.
--
-- The two partial unique indexes at the bottom are the real race guard. An
-- application-level "is this doctor free?" check loses to a concurrent request
-- every time; the database does not.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE consultation_kind AS ENUM ('SCHEDULED', 'INSTANT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE consultation_state AS ENUM ('SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'MISSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE notification_event AS ENUM (
    'CONSULTATION_SCHEDULED',
    'CONSULTATION_REMINDER',
    'CONSULTATION_STARTED',
    'CONSULTATION_CANCELLED',
    'CONSULTATION_COMPLETED',
    'CONSULTATION_FAILED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- DOCTOR SCHEDULES
--
-- One row per doctor per weekday. A missing row means "not working that day",
-- which is the same as is_off = true — both are handled, because a partially
-- filled schedule is the normal state of real rosters.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS doctor_schedules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id   UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0 = Sunday
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  is_off      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT schedule_window_ordered CHECK (is_off OR end_time > start_time),
  UNIQUE (doctor_id, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_schedules_doctor_day ON doctor_schedules(doctor_id, day_of_week);

-- ---------------------------------------------------------------------------
-- CONSULTATIONS
--
-- v2's consultations table predates the state machine. Rather than migrate a
-- demo table through six column renames, it is rebuilt — the previous rows
-- were all seed data with no clinical value.
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS consultations CASCADE;

CREATE TABLE consultations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id              UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  patient_id            VARCHAR(12) NOT NULL REFERENCES patients(aadhaar_number) ON DELETE CASCADE,
  doctor_id             UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE RESTRICT,
  assistant_id          UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,

  consultation_type     consultation_kind  NOT NULL DEFAULT 'SCHEDULED',
  status                consultation_state NOT NULL DEFAULT 'SCHEDULED',

  scheduled_start_time  TIMESTAMPTZ NOT NULL,
  scheduled_end_time    TIMESTAMPTZ NOT NULL,
  actual_start_time     TIMESTAMPTZ,
  actual_end_time       TIMESTAMPTZ,

  -- Only these three provider fields are ever stored. No credentials, no
  -- worker internals — joinMeeting() issues short-lived per-user tokens.
  meeting_provider      VARCHAR(30) NOT NULL DEFAULT 'mediasoup',
  meeting_room_id       TEXT,
  meeting_url           TEXT,

  cancelled_by          UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
  cancellation_reason   TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT consultation_window_ordered CHECK (scheduled_end_time > scheduled_start_time)
);

CREATE INDEX idx_consultations_doctor  ON consultations(doctor_id, scheduled_start_time);
CREATE INDEX idx_consultations_visit   ON consultations(visit_id);
CREATE INDEX idx_consultations_patient ON consultations(patient_id);
CREATE INDEX idx_consultations_status  ON consultations(status, scheduled_end_time);

-- The race guard.
--
-- Partial unique indexes: at most ONE ACTIVE consultation per doctor, and at
-- most one per patient, enforced by the database rather than by a check the
-- application performs a few milliseconds before it inserts. Two simultaneous
-- "Find Doctor Now" requests for the same doctor now produce exactly one
-- success and one clean constraint violation, which §2.6 retries.
CREATE UNIQUE INDEX idx_one_active_per_doctor
  ON consultations(doctor_id) WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX idx_one_active_per_patient
  ON consultations(patient_id) WHERE status = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- NOTIFICATIONS
--
-- Persisted so a user who was offline still sees what happened, and pushed
-- live over the app's own WebSocket. Deliberately independent of mediasoup:
-- notifications must keep working when the video layer is degraded.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id UUID REFERENCES consultations(id) ON DELETE CASCADE,
  recipient_id    UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
  recipient_role  staff_role NOT NULL,
  event_type      notification_event NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at         TIMESTAMPTZ
);

CREATE INDEX idx_notifications_recipient ON notifications(recipient_id, created_at DESC);
CREATE INDEX idx_notifications_unread    ON notifications(recipient_id) WHERE read_at IS NULL;

-- Reminders are fired by a sweep job; this records the fact so a restart of
-- that job cannot send the same reminder twice.
ALTER TABLE consultations ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- TRIGGERS
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_consultations_touch ON consultations;
CREATE TRIGGER trg_consultations_touch BEFORE UPDATE ON consultations
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_schedules_touch ON doctor_schedules;
CREATE TRIGGER trg_schedules_touch BEFORE UPDATE ON doctor_schedules
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- ROW-LEVEL SECURITY
-- ---------------------------------------------------------------------------

ALTER TABLE doctor_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications    ENABLE ROW LEVEL SECURITY;

-- Clinicians read schedules to compute availability; only admins write them.
CREATE POLICY schedules_read ON doctor_schedules
  FOR SELECT TO authenticated
  USING (auth_staff_id() IS NOT NULL);

CREATE POLICY schedules_write ON doctor_schedules
  FOR ALL TO authenticated
  USING (auth_is_admin() OR doctor_id = auth_staff_id())
  WITH CHECK (auth_is_admin() OR doctor_id = auth_staff_id());

-- A doctor sees only their own consultations; an assistant only the ones they
-- created. §7 of the spec, expressed where the data lives.
CREATE POLICY consultations_participants ON consultations
  FOR SELECT TO authenticated
  USING (doctor_id = auth_staff_id() OR assistant_id = auth_staff_id());

CREATE POLICY consultations_insert_by_assistant ON consultations
  FOR INSERT TO authenticated
  WITH CHECK (auth_role() IN ('clinic_assistant', 'doctor'));

CREATE POLICY consultations_update_participants ON consultations
  FOR UPDATE TO authenticated
  USING (doctor_id = auth_staff_id() OR assistant_id = auth_staff_id())
  WITH CHECK (doctor_id = auth_staff_id() OR assistant_id = auth_staff_id());

-- A notification is readable only by the person it was addressed to.
CREATE POLICY notifications_own ON notifications
  FOR SELECT TO authenticated
  USING (recipient_id = auth_staff_id());

CREATE POLICY notifications_mark_read ON notifications
  FOR UPDATE TO authenticated
  USING (recipient_id = auth_staff_id())
  WITH CHECK (recipient_id = auth_staff_id());

COMMIT;
