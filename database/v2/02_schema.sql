-- ============================================================================
-- V2 SCHEMA — region-scoped, role-based clinical platform
--
-- Changes from v1 that matter:
--   1. `patients.aadhaar_number` is the primary key (per spec §3.8).
--   2. Region hierarchy (states -> districts) is real data, not free text.
--   3. Six roles instead of three, each carrying a region scope.
--   4. Doctors own a caseload; cases are assigned, not globally visible.
--   5. Row-level security is enabled on every table (v1 had zero policies).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------------

-- Six roles. The three from the baseline spec, plus three the region-scoped
-- admin model requires:
--   super_admin    — the developer's own account. Creates state admins.
--                    Never provisioned by the seed; see `npm run seed:root`.
--   state_admin    — manages staff within ONE state.
--   district_admin — manages staff within ONE district.
--   auditor        — read-only on audit logs + aggregate counts. No clinical
--                    data, no staff mutation. Exists so a compliance reviewer
--                    never needs an admin account to do their job.
CREATE TYPE staff_role AS ENUM (
    'super_admin',
    'state_admin',
    'district_admin',
    'doctor',
    'clinic_assistant',
    'auditor'
);

CREATE TYPE staff_status AS ENUM ('active', 'inactive', 'suspended');

CREATE TYPE gender_type AS ENUM ('male', 'female', 'other', 'unknown');

CREATE TYPE risk_level AS ENUM ('low', 'moderate', 'high', 'emergency');

CREATE TYPE visit_status AS ENUM (
    'in_progress',
    'awaiting_ai',
    'awaiting_doctor',
    'in_consultation',
    'completed',
    'referred',
    'cancelled'
);

-- How the patient record came into existence. `emergency_bypass` is the
-- spec's "genuinely urgent case" path: an assistant may open a visit before
-- Aadhaar is captured. Every such row is reconciled later or flagged.
CREATE TYPE registration_mode AS ENUM (
    'standard',
    'abha_ocr',
    'emergency_bypass'
);

CREATE TYPE consultation_status AS ENUM ('waiting', 'active', 'completed', 'cancelled', 'no_show');

CREATE TYPE appointment_status AS ENUM ('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show');

CREATE TYPE document_type AS ENUM ('prescription', 'lab_report', 'abha_card', 'discharge_summary', 'other');

-- ---------------------------------------------------------------------------
-- REGION HIERARCHY
--
-- v1 stored `state` and `district` as free-text columns on every patient, so
-- "Uttar Pradesh", "UP" and "uttar pradesh" were three different regions and
-- no admin scope could be expressed against them. These are now real rows.
-- ---------------------------------------------------------------------------

CREATE TABLE states (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) NOT NULL UNIQUE,
    code        VARCHAR(5)   NOT NULL UNIQUE,   -- ISO 3166-2:IN subdivision code
    region_type VARCHAR(20)  NOT NULL DEFAULT 'state'
                CHECK (region_type IN ('state', 'union_territory')),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE districts (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    state_id   UUID NOT NULL REFERENCES states(id) ON DELETE CASCADE,
    name       VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (state_id, name)
);

CREATE INDEX idx_districts_state ON districts(state_id);

-- ---------------------------------------------------------------------------
-- STAFF
--
-- There is deliberately no self-registration path to this table. Rows are
-- created only by POST /api/admin/users, which requires an admin role.
-- `auth_user_id` links to Supabase Auth; the password lives there, never here.
-- ---------------------------------------------------------------------------

CREATE TABLE staff_profiles (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID UNIQUE,                    -- auth.users.id
    full_name    VARCHAR(150) NOT NULL,
    email        VARCHAR(255) NOT NULL UNIQUE,
    phone        VARCHAR(20),
    role         staff_role   NOT NULL,
    status       staff_status NOT NULL DEFAULT 'active',

    -- Region scope. Meaning depends on role:
    --   super_admin    — both NULL (nationwide)
    --   state_admin    — state_id set, district_id NULL
    --   district_admin — both set
    --   doctor         — both set (the district they serve)
    --   clinic_assistant — both set (the sub-centre they staff)
    state_id     UUID REFERENCES states(id)    ON DELETE RESTRICT,
    district_id  UUID REFERENCES districts(id) ON DELETE RESTRICT,

    preferred_language VARCHAR(50) NOT NULL DEFAULT 'Hindi',
    is_demo      BOOLEAN NOT NULL DEFAULT FALSE,

    created_by   UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- A scoped admin without its scope would silently widen to nationwide.
    CONSTRAINT staff_scope_matches_role CHECK (
        (role = 'super_admin'      AND state_id IS NULL AND district_id IS NULL) OR
        (role = 'auditor'          AND district_id IS NULL) OR
        (role = 'state_admin'      AND state_id IS NOT NULL AND district_id IS NULL) OR
        (role = 'district_admin'   AND state_id IS NOT NULL AND district_id IS NOT NULL) OR
        (role = 'doctor'           AND state_id IS NOT NULL AND district_id IS NOT NULL) OR
        (role = 'clinic_assistant' AND state_id IS NOT NULL AND district_id IS NOT NULL)
    )
);

CREATE INDEX idx_staff_role      ON staff_profiles(role);
CREATE INDEX idx_staff_district  ON staff_profiles(district_id);
CREATE INDEX idx_staff_state     ON staff_profiles(state_id);
CREATE INDEX idx_staff_auth_user ON staff_profiles(auth_user_id);

CREATE TABLE doctor_profiles (
    staff_id                   UUID PRIMARY KEY REFERENCES staff_profiles(id) ON DELETE CASCADE,
    registration_number        VARCHAR(100) NOT NULL UNIQUE,  -- NMC / state council
    specialization             VARCHAR(150) NOT NULL,
    qualification              VARCHAR(255),
    years_of_experience        INTEGER CHECK (years_of_experience >= 0),
    consultation_languages     TEXT[] NOT NULL DEFAULT ARRAY['Hindi', 'English'],
    is_available_for_consultation BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- PATIENTS
--
-- Per spec §3.8 the Aadhaar number is the primary key, stored as given.
--
-- Recorded for whoever operates this later: raw Aadhaar at rest is restricted
-- under the Aadhaar Act 2016 §29 and the DPDP Act 2023, and UIDAI's standard
-- pattern is a hash plus last-4 for display. This column was specified
-- explicitly and is implemented as specified. The API never returns it in a
-- URL and never writes it into audit_logs.new_data.
-- ---------------------------------------------------------------------------

CREATE TABLE patients (
    -- The Aadhaar number IS the identifier. There is no separate patient_code:
    -- a second human-facing key was one more thing to type, print and mistype,
    -- and staff already ask for Aadhaar at the counter.
    aadhaar_number VARCHAR(12) PRIMARY KEY
                   CHECK (aadhaar_number ~ '^[0-9]{12}$'),

    full_name      VARCHAR(150) NOT NULL CHECK (length(trim(full_name)) >= 2),
    gender         gender_type  NOT NULL,

    -- Date of birth is captured; age is DERIVED, never stored.
    -- A stored age is wrong the day after it is entered, and the triage engine
    -- treats paediatric and geriatric thresholds differently — so a stale age
    -- is a clinical error, not a cosmetic one. The API computes it per request.
    date_of_birth  DATE NOT NULL
                   CHECK (date_of_birth <= CURRENT_DATE
                          AND date_of_birth >= CURRENT_DATE - INTERVAL '120 years'),

    -- --- Address ---
    -- Two lines, because a village address is routinely "Rampur Kalan" plus a
    -- landmark or tola that does not fit one field.
    village_line1  VARCHAR(150) NOT NULL,
    village_line2  VARCHAR(150),
    -- Free text, not a foreign key: district masters exist only for Uttar
    -- Pradesh, and a patient may give an address anywhere in India. The UI
    -- offers seeded districts as suggestions and accepts anything else.
    address_district VARCHAR(100) NOT NULL,
    address_state_id UUID NOT NULL REFERENCES states(id) ON DELETE RESTRICT,
    pin_code       CHAR(6) NOT NULL CHECK (pin_code ~ '^[1-9][0-9]{5}$'),

    phone          VARCHAR(10) NOT NULL CHECK (phone ~ '^[6-9][0-9]{9}$'),

    -- --- Tenancy, not address ---
    -- The sub-centre that registered this patient. Address and jurisdiction are
    -- different things: a migrant worker seen in Ballia may give a Bihar
    -- address. RLS and every district filter key on THIS column.
    clinic_district_id UUID NOT NULL REFERENCES districts(id) ON DELETE RESTRICT,
    clinic_state_id    UUID NOT NULL REFERENCES states(id)    ON DELETE RESTRICT,

    -- Populated by ABHA card OCR when that path is used; never typed.
    abha_number    VARCHAR(17) UNIQUE,

    registration_mode registration_mode NOT NULL DEFAULT 'standard',
    reconciled_at  TIMESTAMPTZ,

    is_demo        BOOLEAN NOT NULL DEFAULT FALSE,
    registered_by  UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_patients_clinic_district ON patients(clinic_district_id);
CREATE INDEX idx_patients_address_state   ON patients(address_state_id);
CREATE INDEX idx_patients_abha            ON patients(abha_number);
CREATE INDEX idx_patients_name            ON patients(lower(full_name));
CREATE INDEX idx_patients_phone           ON patients(phone);

-- ---------------------------------------------------------------------------
-- CASELOAD
--
-- The spec's "doctors review only their assigned cases" lives here. A visit
-- carries the doctor it was assigned to; the queue filters on it.
-- ---------------------------------------------------------------------------

CREATE TABLE visits (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_code     VARCHAR(30) NOT NULL UNIQUE,
    patient_id     VARCHAR(12) NOT NULL REFERENCES patients(aadhaar_number) ON DELETE CASCADE,

    assistant_id   UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
    -- NULL until triage assigns a doctor. Indexed: this is the doctor queue.
    assigned_doctor_id UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
    assigned_at    TIMESTAMPTZ,

    district_id    UUID NOT NULL REFERENCES districts(id) ON DELETE RESTRICT,

    chief_complaint    TEXT,
    symptom_duration   VARCHAR(100),
    current_medications TEXT,
    status         visit_status NOT NULL DEFAULT 'in_progress',
    risk_level     risk_level,

    -- Day-wise queue grouping. Generated so it can never drift from created_at.
    visit_date     DATE GENERATED ALWAYS AS ((created_at AT TIME ZONE 'Asia/Kolkata')::date) STORED,

    is_demo        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_visits_patient  ON visits(patient_id);
CREATE INDEX idx_visits_district ON visits(district_id);
-- The doctor queue query: assigned to me, on this date, worst risk first.
CREATE INDEX idx_visits_doctor_queue ON visits(assigned_doctor_id, visit_date, risk_level);

CREATE TABLE visit_vitals (
    id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
    temperature_f           NUMERIC(4,1) CHECK (temperature_f BETWEEN 80 AND 115),
    blood_pressure_systolic  INTEGER CHECK (blood_pressure_systolic BETWEEN 40 AND 300),
    blood_pressure_diastolic INTEGER CHECK (blood_pressure_diastolic BETWEEN 20 AND 200),
    pulse_bpm               INTEGER CHECK (pulse_bpm BETWEEN 20 AND 250),
    spo2_percent            INTEGER CHECK (spo2_percent BETWEEN 50 AND 100),
    respiratory_rate        INTEGER CHECK (respiratory_rate BETWEEN 5 AND 80),
    blood_glucose_mgdl      INTEGER CHECK (blood_glucose_mgdl BETWEEN 20 AND 800),
    recorded_by             UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
    recorded_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vitals_visit ON visit_vitals(visit_id);

CREATE TABLE visit_symptoms (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id    UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    source      VARCHAR(20) NOT NULL DEFAULT 'typed'
                CHECK (source IN ('typed', 'speech', 'ocr')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_symptoms_visit ON visit_symptoms(visit_id);

CREATE TABLE patient_documents (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id    VARCHAR(12) NOT NULL REFERENCES patients(aadhaar_number) ON DELETE CASCADE,
    visit_id      UUID REFERENCES visits(id) ON DELETE SET NULL,
    document_type document_type NOT NULL DEFAULT 'other',
    storage_path  TEXT,
    mime_type     VARCHAR(100),
    ocr_text      TEXT,
    -- Mandatory human verification: extractions are not clinical input until
    -- an assistant confirms them.
    verified_by   UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
    verified_at   TIMESTAMPTZ,
    extracted_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    uploaded_by   UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_documents_patient ON patient_documents(patient_id);
CREATE INDEX idx_documents_visit   ON patient_documents(visit_id);

CREATE TABLE ai_assessments (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id       UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
    risk_level     risk_level NOT NULL,
    patient_summary TEXT,
    first_aid_steps  JSONB NOT NULL DEFAULT '[]'::jsonb,
    protocol_matches JSONB NOT NULL DEFAULT '[]'::jsonb,
    warnings         JSONB NOT NULL DEFAULT '[]'::jsonb,
    missing_information JSONB NOT NULL DEFAULT '[]'::jsonb,
    recommended_next_action VARCHAR(60),
    requires_doctor  BOOLEAN NOT NULL DEFAULT TRUE,
    generated_by     VARCHAR(120),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_assessments_visit ON ai_assessments(visit_id);

CREATE TABLE consultations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id        UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
    doctor_id       UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE RESTRICT,
    assistant_id    UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
    status          consultation_status NOT NULL DEFAULT 'waiting',
    -- Unguessable. v1 used `room_<patient_code>_<timestamp>`, which was both
    -- predictable and leaked through an unauthenticated endpoint.
    meeting_room_id UUID NOT NULL DEFAULT gen_random_uuid(),
    scheduled_for   TIMESTAMPTZ,
    started_at      TIMESTAMPTZ,
    ended_at        TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_consultations_visit  ON consultations(visit_id);
CREATE INDEX idx_consultations_doctor ON consultations(doctor_id);
CREATE UNIQUE INDEX idx_consultations_room ON consultations(meeting_room_id);

CREATE TABLE doctor_reviews (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id      UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
    doctor_id     UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE RESTRICT,
    decision      VARCHAR(40) NOT NULL,
    clinical_notes TEXT,
    agreed_with_ai BOOLEAN,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reviews_visit ON doctor_reviews(visit_id);

CREATE TABLE prescriptions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id        UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
    doctor_id       UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE RESTRICT,
    prescription_code VARCHAR(40) NOT NULL UNIQUE,
    items           JSONB NOT NULL DEFAULT '[]'::jsonb,
    advice          TEXT,
    signed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_prescriptions_visit ON prescriptions(visit_id);

-- ---------------------------------------------------------------------------
-- AUDIT
--
-- Append-only by policy (see 03_rls.sql): no role may UPDATE or DELETE.
-- ---------------------------------------------------------------------------

CREATE TABLE audit_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id    UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
    actor_role  staff_role,
    action      VARCHAR(80) NOT NULL,
    entity_type VARCHAR(60),
    entity_id   TEXT,
    metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address  INET,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_actor   ON audit_logs(actor_id);
CREATE INDEX idx_audit_action  ON audit_logs(action);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_staff_touch    BEFORE UPDATE ON staff_profiles
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_patients_touch BEFORE UPDATE ON patients
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_visits_touch   BEFORE UPDATE ON visits
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_doctor_touch   BEFORE UPDATE ON doctor_profiles
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMIT;
