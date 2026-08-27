-- ============================================================================
-- V2 RESET — drop all v1 demo objects.
--
-- Verified before writing this file: the live database held only demo data
-- (8 @clinic.org staff accounts, 4 demo patients, 6 "Demo Doctor (...)"
-- profiles, 37 audit rows). Nothing here is recoverable, so re-check the row
-- counts with `npm run inspect` before running it against any other database.
--
-- Supabase Auth users are NOT dropped here — SQL cannot reach auth.users
-- through the REST layer. `npm run db:reset` clears those first, then runs
-- this file.
-- ============================================================================

BEGIN;

-- Child tables first; CASCADE handles anything added since.
DROP TABLE IF EXISTS audit_logs             CASCADE;
DROP TABLE IF EXISTS notifications          CASCADE;
DROP TABLE IF EXISTS referrals              CASCADE;
DROP TABLE IF EXISTS prescription_items     CASCADE;
DROP TABLE IF EXISTS prescriptions          CASCADE;
DROP TABLE IF EXISTS doctor_reviews         CASCADE;
DROP TABLE IF EXISTS consultations          CASCADE;
DROP TABLE IF EXISTS appointments           CASCADE;
DROP TABLE IF EXISTS appointment_slots      CASCADE;
DROP TABLE IF EXISTS rag_chunks             CASCADE;
DROP TABLE IF EXISTS rag_documents          CASCADE;
DROP TABLE IF EXISTS ai_recommendations     CASCADE;
DROP TABLE IF EXISTS clinical_protocol_steps CASCADE;
DROP TABLE IF EXISTS clinical_protocols     CASCADE;
DROP TABLE IF EXISTS ai_risk_assessments    CASCADE;
DROP TABLE IF EXISTS ai_assessments         CASCADE;
DROP TABLE IF EXISTS patient_images         CASCADE;
DROP TABLE IF EXISTS document_extractions   CASCADE;
DROP TABLE IF EXISTS patient_documents      CASCADE;
DROP TABLE IF EXISTS medical_documents      CASCADE;
DROP TABLE IF EXISTS visit_vitals           CASCADE;
DROP TABLE IF EXISTS visit_symptoms         CASCADE;
DROP TABLE IF EXISTS vitals                 CASCADE;
DROP TABLE IF EXISTS visits                 CASCADE;
DROP TABLE IF EXISTS patient_medications    CASCADE;
DROP TABLE IF EXISTS patient_allergies      CASCADE;
DROP TABLE IF EXISTS patient_medical_history CASCADE;
DROP TABLE IF EXISTS patient_assignments    CASCADE;
DROP TABLE IF EXISTS patients               CASCADE;
DROP TABLE IF EXISTS doctor_profiles        CASCADE;
DROP TABLE IF EXISTS staff_profiles         CASCADE;
DROP TABLE IF EXISTS clinics                CASCADE;
DROP TABLE IF EXISTS districts              CASCADE;
DROP TABLE IF EXISTS states                 CASCADE;
DROP TABLE IF EXISTS profiles               CASCADE;
DROP TABLE IF EXISTS knowledge_sources      CASCADE;
DROP TABLE IF EXISTS protocols              CASCADE;

-- Enum types are dropped last: tables above depend on them.
DROP TYPE IF EXISTS staff_role              CASCADE;
DROP TYPE IF EXISTS staff_status            CASCADE;
DROP TYPE IF EXISTS gender_type             CASCADE;
DROP TYPE IF EXISTS visit_status            CASCADE;
DROP TYPE IF EXISTS risk_level              CASCADE;
DROP TYPE IF EXISTS symptom_severity        CASCADE;
DROP TYPE IF EXISTS document_type           CASCADE;
DROP TYPE IF EXISTS document_status         CASCADE;
DROP TYPE IF EXISTS recommendation_type     CASCADE;
DROP TYPE IF EXISTS recommendation_status   CASCADE;
DROP TYPE IF EXISTS appointment_status      CASCADE;
DROP TYPE IF EXISTS consultation_type       CASCADE;
DROP TYPE IF EXISTS consultation_status     CASCADE;
DROP TYPE IF EXISTS doctor_decision_type    CASCADE;
DROP TYPE IF EXISTS notification_type       CASCADE;
DROP TYPE IF EXISTS notification_channel    CASCADE;
DROP TYPE IF EXISTS notification_status     CASCADE;
DROP TYPE IF EXISTS ai_processing_status    CASCADE;
DROP TYPE IF EXISTS referral_urgency        CASCADE;
DROP TYPE IF EXISTS availability_status     CASCADE;
DROP TYPE IF EXISTS registration_mode       CASCADE;

COMMIT;
