-- RuralAI — full database setup.
-- Paste this whole file into the Supabase SQL Editor and run it.
-- Generated 2026-08-26T09:26Z from schema.sql + migrations/.
-- Safe to re-run: every statement is guarded or idempotent.

-- ========== 1. Base schema (28 tables) ==========
-- full_schema.sql
-- Virtual Village Clinic MVP - Complete PostgreSQL Database Schema (29 Tables)
-- Ready for execution in Supabase SQL Editor or automated migration script.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. ENUM TYPES
-- ============================================================================

DO $$ BEGIN
    CREATE TYPE staff_role AS ENUM (
        'clinic_assistant',
        'doctor',
        'admin'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE staff_status AS ENUM (
        'active',
        'inactive',
        'suspended'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE gender_type AS ENUM (
        'male',
        'female',
        'other',
        'unknown'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE visit_status AS ENUM (
        'open',
        'ai_processing',
        'awaiting_doctor',
        'consultation_scheduled',
        'under_consultation',
        'completed',
        'referred',
        'cancelled'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE risk_level AS ENUM (
        'low',
        'medium',
        'high'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE symptom_severity AS ENUM (
        'mild',
        'moderate',
        'severe'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE document_type AS ENUM (
        'prescription',
        'medical_report',
        'lab_report',
        'discharge_summary',
        'identity_document',
        'other'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE document_status AS ENUM (
        'uploaded',
        'processing',
        'extracted',
        'verified',
        'failed'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE recommendation_type AS ENUM (
        'first_aid',
        'medicine',
        'monitoring',
        'referral',
        'doctor_consultation'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE recommendation_status AS ENUM (
        'ai_suggested',
        'doctor_approved',
        'doctor_modified',
        'rejected'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE appointment_status AS ENUM (
        'scheduled',
        'confirmed',
        'in_progress',
        'completed',
        'cancelled',
        'no_show'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE consultation_type AS ENUM (
        'video',
        'audio'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE consultation_status AS ENUM (
        'waiting',
        'active',
        'completed',
        'cancelled'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE doctor_decision_type AS ENUM (
        'continue_protocol',
        'prescription',
        'additional_test',
        'follow_up',
        'hospital_referral',
        'emergency_referral'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE notification_type AS ENUM (
        'high_risk',
        'appointment',
        'consultation',
        'doctor_assignment',
        'system',
        'document',
        'ai_assessment'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE notification_channel AS ENUM (
        'in_app',
        'email'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE notification_status AS ENUM (
        'pending',
        'sent',
        'read',
        'failed'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE ai_processing_status AS ENUM (
        'queued',
        'processing',
        'completed',
        'failed'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE referral_urgency AS ENUM (
        'immediate',
        'urgent',
        'routine'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE availability_status AS ENUM (
        'available',
        'unavailable'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============================================================================
-- 2. STAFF & DOCTOR PROFILES
-- ============================================================================

CREATE TABLE IF NOT EXISTS staff_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(150) NOT NULL,
    role staff_role NOT NULL DEFAULT 'clinic_assistant',
    phone VARCHAR(20),
    email VARCHAR(255) NOT NULL UNIQUE,
    status staff_status NOT NULL DEFAULT 'active',
    preferred_language VARCHAR(50) DEFAULT 'English',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS doctor_profiles (
    staff_id UUID PRIMARY KEY REFERENCES staff_profiles(id) ON DELETE CASCADE,
    registration_number VARCHAR(100) NOT NULL UNIQUE,
    specialization VARCHAR(150) NOT NULL,
    qualification VARCHAR(255),
    years_of_experience INTEGER CHECK (years_of_experience >= 0),
    consultation_language VARCHAR(100),
    is_available_for_consultation BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 3. PATIENTS & MEDICAL HISTORY
-- ============================================================================

CREATE TABLE IF NOT EXISTS patients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_code VARCHAR(30) NOT NULL UNIQUE,
    full_name VARCHAR(150) NOT NULL,
    date_of_birth DATE,
    age_years INTEGER CHECK (age_years >= 0 AND age_years <= 150),
    gender gender_type NOT NULL DEFAULT 'unknown',
    phone VARCHAR(20),
    village VARCHAR(150) NOT NULL,
    district VARCHAR(150),
    state VARCHAR(100) NOT NULL DEFAULT 'Uttar Pradesh',
    preferred_language VARCHAR(50) NOT NULL DEFAULT 'Hindi',
    emergency_contact_name VARCHAR(150),
    emergency_contact_phone VARCHAR(20),
    created_by UUID REFERENCES staff_profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS patient_medical_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    condition_name VARCHAR(255) NOT NULL,
    diagnosed_date DATE,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    notes TEXT,
    recorded_by UUID REFERENCES staff_profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS patient_allergies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    allergen VARCHAR(255) NOT NULL,
    reaction VARCHAR(255),
    severity VARCHAR(50),
    notes TEXT,
    recorded_by UUID REFERENCES staff_profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS patient_medications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    medicine_name VARCHAR(255) NOT NULL,
    strength VARCHAR(100),
    dosage VARCHAR(100),
    frequency VARCHAR(100),
    route VARCHAR(100),
    start_date DATE,
    end_date DATE,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    source VARCHAR(100),
    notes TEXT,
    recorded_by UUID REFERENCES staff_profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 4. VISITS, SYMPTOMS, VITALS & MEDIA METADATA
-- ============================================================================

CREATE TABLE IF NOT EXISTS visits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_code VARCHAR(30) NOT NULL UNIQUE,
    patient_id UUID NOT NULL REFERENCES patients(id),
    assistant_id UUID REFERENCES staff_profiles(id),
    status visit_status NOT NULL DEFAULT 'open',
    chief_complaint TEXT NOT NULL,
    symptom_onset_date DATE,
    preferred_consultation_language VARCHAR(50),
    risk_level risk_level,
    risk_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS visit_symptoms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
    symptom_name VARCHAR(255) NOT NULL,
    duration_value INTEGER,
    duration_unit VARCHAR(20),
    severity symptom_severity,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS visit_vitals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id UUID NOT NULL UNIQUE REFERENCES visits(id) ON DELETE CASCADE,
    temperature_celsius NUMERIC(4,1),
    systolic_bp INTEGER,
    diastolic_bp INTEGER,
    pulse_bpm INTEGER,
    oxygen_saturation INTEGER,
    respiratory_rate INTEGER,
    weight_kg NUMERIC(5,2),
    height_cm NUMERIC(5,2),
    recorded_by UUID REFERENCES staff_profiles(id),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS patient_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    visit_id UUID REFERENCES visits(id) ON DELETE SET NULL,
    document_type document_type NOT NULL,
    original_file_name VARCHAR(255) NOT NULL,
    storage_bucket VARCHAR(100) NOT NULL,
    storage_path TEXT NOT NULL UNIQUE,
    mime_type VARCHAR(100) NOT NULL,
    file_size_bytes BIGINT,
    status document_status NOT NULL DEFAULT 'uploaded',
    uploaded_by UUID REFERENCES staff_profiles(id),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS document_extractions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL UNIQUE REFERENCES patient_documents(id) ON DELETE CASCADE,
    extracted_text TEXT NOT NULL,
    structured_data JSONB,
    ocr_engine VARCHAR(100) NOT NULL,
    confidence NUMERIC(5,4),
    verified_by UUID REFERENCES staff_profiles(id),
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS patient_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    visit_id UUID REFERENCES visits(id) ON DELETE CASCADE,
    image_type VARCHAR(100) NOT NULL,
    storage_bucket VARCHAR(100) NOT NULL,
    storage_path TEXT NOT NULL UNIQUE,
    mime_type VARCHAR(100) NOT NULL,
    uploaded_by UUID REFERENCES staff_profiles(id),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 5. AI ASSESSMENTS & RECOMMENDATIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
    model_provider VARCHAR(100) NOT NULL,
    model_name VARCHAR(150) NOT NULL,
    processing_status ai_processing_status NOT NULL DEFAULT 'completed',
    patient_summary TEXT,
    preliminary_assessment TEXT,
    identified_symptoms JSONB,
    identified_risk_factors JSONB,
    red_flags JSONB,
    uncertainty_notes TEXT,
    ai_raw_output JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ai_risk_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ai_assessment_id UUID NOT NULL UNIQUE REFERENCES ai_assessments(id) ON DELETE CASCADE,
    risk_level risk_level NOT NULL,
    confidence NUMERIC(5,4),
    reason TEXT NOT NULL,
    red_flags JSONB,
    recommended_action TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clinical_protocols (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    protocol_code VARCHAR(100) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    description TEXT,
    source_organization VARCHAR(255) NOT NULL,
    source_document VARCHAR(255) NOT NULL,
    source_url TEXT,
    version VARCHAR(50) NOT NULL,
    effective_date DATE,
    review_date DATE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clinical_protocol_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    protocol_id UUID NOT NULL REFERENCES clinical_protocols(id) ON DELETE CASCADE,
    step_number INTEGER NOT NULL,
    instruction TEXT NOT NULL,
    warning TEXT,
    requires_doctor_approval BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE(protocol_id, step_number)
);

CREATE TABLE IF NOT EXISTS ai_recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ai_assessment_id UUID NOT NULL REFERENCES ai_assessments(id) ON DELETE CASCADE,
    recommendation_type recommendation_type NOT NULL,
    title VARCHAR(255) NOT NULL,
    recommendation TEXT NOT NULL,
    safety_warning TEXT,
    source_protocol_id UUID REFERENCES clinical_protocols(id) ON DELETE SET NULL,
    status recommendation_status NOT NULL DEFAULT 'ai_suggested',
    doctor_id UUID REFERENCES staff_profiles(id),
    doctor_notes TEXT,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rag_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    protocol_id UUID REFERENCES clinical_protocols(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    source_organization VARCHAR(255) NOT NULL,
    source_url TEXT,
    document_version VARCHAR(50),
    document_type VARCHAR(100),
    published_date DATE,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS rag_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    qdrant_collection VARCHAR(150) NOT NULL,
    qdrant_point_id UUID NOT NULL UNIQUE,
    token_count INTEGER,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(document_id, chunk_index)
);

-- ============================================================================
-- 6. APPOINTMENT SLOTS, APPOINTMENTS & CONSULTATIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS appointment_slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doctor_id UUID NOT NULL REFERENCES doctor_profiles(staff_id) ON DELETE CASCADE,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    status availability_status NOT NULL DEFAULT 'available',
    UNIQUE(doctor_id, start_time, end_time)
);

CREATE TABLE IF NOT EXISTS appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_code VARCHAR(30) NOT NULL UNIQUE,
    patient_id UUID NOT NULL REFERENCES patients(id),
    visit_id UUID NOT NULL REFERENCES visits(id),
    doctor_id UUID NOT NULL REFERENCES doctor_profiles(staff_id),
    slot_id UUID REFERENCES appointment_slots(id),
    risk_level risk_level NOT NULL,
    status appointment_status NOT NULL DEFAULT 'scheduled',
    reason TEXT,
    booked_by UUID REFERENCES staff_profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consultations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id UUID REFERENCES appointments(id) ON DELETE CASCADE,
    visit_id UUID REFERENCES visits(id) ON DELETE CASCADE,
    consultation_type consultation_type NOT NULL DEFAULT 'video',
    status consultation_status NOT NULL DEFAULT 'waiting',
    meeting_room_id VARCHAR(255),
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 7. DOCTOR DECISIONS, PRESCRIPTIONS & REFERRALS
-- ============================================================================

CREATE TABLE IF NOT EXISTS doctor_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consultation_id UUID NOT NULL UNIQUE REFERENCES consultations(id) ON DELETE CASCADE,
    doctor_id UUID REFERENCES doctor_profiles(staff_id),
    decision_type doctor_decision_type NOT NULL,
    clinical_notes TEXT NOT NULL,
    diagnosis TEXT,
    follow_up_date DATE,
    referral_facility VARCHAR(255),
    referral_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prescriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consultation_id UUID REFERENCES consultations(id) ON DELETE CASCADE,
    visit_id UUID REFERENCES visits(id) ON DELETE CASCADE,
    doctor_id UUID REFERENCES doctor_profiles(staff_id),
    prescription_number VARCHAR(50) NOT NULL UNIQUE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prescription_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prescription_id UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
    medicine_name VARCHAR(255) NOT NULL,
    strength VARCHAR(100),
    dosage VARCHAR(100) NOT NULL,
    frequency VARCHAR(100) NOT NULL,
    route VARCHAR(100),
    duration_value INTEGER,
    duration_unit VARCHAR(20),
    instructions TEXT
);

CREATE TABLE IF NOT EXISTS referrals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id UUID NOT NULL REFERENCES visits(id),
    doctor_id UUID REFERENCES doctor_profiles(staff_id),
    referral_urgency referral_urgency NOT NULL,
    destination_facility VARCHAR(255) NOT NULL,
    reason TEXT NOT NULL,
    referral_instructions TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 8. NOTIFICATIONS & AUDIT LOGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id UUID REFERENCES staff_profiles(id) ON DELETE CASCADE,
    notification_type notification_type NOT NULL,
    channel notification_channel NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    visit_id UUID REFERENCES visits(id) ON DELETE SET NULL,
    appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
    status notification_status NOT NULL DEFAULT 'pending',
    sent_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID,
    old_data JSONB,
    new_data JSONB,
    ip_address INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 9. INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_patients_patient_code ON patients(patient_code);
CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(full_name);
CREATE INDEX IF NOT EXISTS idx_visits_patient ON visits(patient_id);
CREATE INDEX IF NOT EXISTS idx_visits_status ON visits(status);
CREATE INDEX IF NOT EXISTS idx_visits_risk ON visits(risk_level);

-- ========== 2. Migration 001 — medication rule sourcing ==========
-- Medication may never be model-authored.
--
-- Plan §D.2 and §B.3: a medication recommendation must point at the formulary
-- rule it came from. Enforcing this in the database rather than in application
-- code means a compromised service-role key, a future controller that forgets
-- the check, or a direct SQL insert still cannot store a medication that no
-- signed rule produced.
--
-- NOT YET APPLIED — the database was unreachable when this was written.
-- Apply with: psql "$DATABASE_URL" -f database/migrations/001_medication_rule_source.sql

ALTER TABLE ai_recommendations
  ADD COLUMN IF NOT EXISTS rule_source_id VARCHAR(64);

-- Strict: no grandfather clause. An earlier draft exempted rows created before
-- a cutoff date, which on a fresh database exempts everything inserted today —
-- a permanent hole rather than a migration aid. If this is ever applied to a
-- database that already holds medication rows, backfill or delete them first.
ALTER TABLE ai_recommendations
  DROP CONSTRAINT IF EXISTS medicine_requires_rule_source;

ALTER TABLE ai_recommendations
  ADD CONSTRAINT medicine_requires_rule_source
  CHECK (
    recommendation_type <> 'medicine'
    OR rule_source_id IS NOT NULL
  );

COMMENT ON CONSTRAINT medicine_requires_rule_source ON ai_recommendations IS
  'A medication recommendation must name the formulary rule that produced it. Never relax this to make an insert succeed — fix the caller.';

CREATE INDEX IF NOT EXISTS idx_ai_recommendations_rule_source
  ON ai_recommendations (rule_source_id)
  WHERE recommendation_type = 'medicine';
