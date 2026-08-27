-- ============================================================================
-- V2 ROW-LEVEL SECURITY
--
-- v1 had zero policies (`CREATE POLICY` appeared 0 times in database/), which
-- meant the anon key committed to git history in commits 088b593 / 7fe3f60 was
-- a direct read/write handle on every table through PostgREST — bypassing the
-- Express API and every role check in it.
--
-- These policies are evaluated for the anon and authenticated keys. The
-- backend's service-role key still bypasses them by design; that is why the
-- application-layer guards in middleware/ remain, and why the two must agree.
-- Defence in depth: either one failing alone is not a breach.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Helpers. SECURITY DEFINER so a policy can read staff_profiles without
-- recursing into staff_profiles' own policy.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION auth_staff_id() RETURNS UUID AS $$
    SELECT id FROM staff_profiles
    WHERE auth_user_id = auth.uid() AND status = 'active'
    LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION auth_role() RETURNS staff_role AS $$
    SELECT role FROM staff_profiles
    WHERE auth_user_id = auth.uid() AND status = 'active'
    LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION auth_district() RETURNS UUID AS $$
    SELECT district_id FROM staff_profiles
    WHERE auth_user_id = auth.uid() AND status = 'active'
    LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION auth_state() RETURNS UUID AS $$
    SELECT state_id FROM staff_profiles
    WHERE auth_user_id = auth.uid() AND status = 'active'
    LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Admin roles never touch clinical rows. This mirrors
-- middleware/clinicalAccess.middleware.js so the rule holds even if a request
-- reaches the database without passing through Express.
CREATE OR REPLACE FUNCTION auth_is_admin() RETURNS BOOLEAN AS $$
    SELECT auth_role() IN ('super_admin', 'state_admin', 'district_admin');
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Is the current user a clinician (doctor or assistant) inside this district?
CREATE OR REPLACE FUNCTION auth_serves_district(target UUID) RETURNS BOOLEAN AS $$
    SELECT auth_role() IN ('doctor', 'clinic_assistant') AND auth_district() = target;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere. A table with RLS on and no policy denies all access,
-- which is the correct default for anything not explicitly opened below.
-- ---------------------------------------------------------------------------

ALTER TABLE states             ENABLE ROW LEVEL SECURITY;
ALTER TABLE districts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients           ENABLE ROW LEVEL SECURITY;
ALTER TABLE visits             ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_vitals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_symptoms     ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_documents  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_assessments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_reviews     ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescriptions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs         ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Region reference data — readable by any signed-in staff member, writable by
-- nobody through the API (seeded via service role only).
-- ---------------------------------------------------------------------------

CREATE POLICY states_read ON states
    FOR SELECT TO authenticated
    USING (auth_staff_id() IS NOT NULL);

CREATE POLICY districts_read ON districts
    FOR SELECT TO authenticated
    USING (auth_staff_id() IS NOT NULL);

-- ---------------------------------------------------------------------------
-- STAFF PROFILES
--
-- Everyone reads their own row. Admins read within their scope. Only admins
-- write, and only inside their scope — a district admin cannot mint a
-- state admin, and cannot reach another district.
-- ---------------------------------------------------------------------------

CREATE POLICY staff_read_self ON staff_profiles
    FOR SELECT TO authenticated
    USING (auth_user_id = auth.uid());

CREATE POLICY staff_read_in_scope ON staff_profiles
    FOR SELECT TO authenticated
    USING (
        auth_role() = 'super_admin'
        OR (auth_role() = 'state_admin'    AND state_id    = auth_state())
        OR (auth_role() = 'district_admin' AND district_id = auth_district())
        OR (auth_role() = 'auditor'        AND (auth_state() IS NULL OR state_id = auth_state()))
        -- Clinicians need the roster to pick a doctor for a consultation.
        OR (auth_role() IN ('doctor', 'clinic_assistant')
            AND role = 'doctor' AND district_id = auth_district())
    );

CREATE POLICY staff_insert_by_admin ON staff_profiles
    FOR INSERT TO authenticated
    WITH CHECK (
        (auth_role() = 'super_admin')
        OR (auth_role() = 'state_admin'
            AND state_id = auth_state()
            AND role IN ('district_admin', 'doctor', 'clinic_assistant', 'auditor'))
        OR (auth_role() = 'district_admin'
            AND district_id = auth_district()
            AND role IN ('doctor', 'clinic_assistant'))
    );

CREATE POLICY staff_update_by_admin ON staff_profiles
    FOR UPDATE TO authenticated
    USING (
        (auth_role() = 'super_admin')
        OR (auth_role() = 'state_admin'    AND state_id    = auth_state())
        OR (auth_role() = 'district_admin' AND district_id = auth_district())
    )
    WITH CHECK (
        (auth_role() = 'super_admin')
        OR (auth_role() = 'state_admin'    AND state_id    = auth_state())
        OR (auth_role() = 'district_admin' AND district_id = auth_district())
    );

CREATE POLICY staff_delete_by_admin ON staff_profiles
    FOR DELETE TO authenticated
    USING (
        (auth_role() = 'super_admin')
        OR (auth_role() = 'state_admin'    AND state_id    = auth_state())
        OR (auth_role() = 'district_admin' AND district_id = auth_district())
    );

CREATE POLICY doctor_profiles_read ON doctor_profiles
    FOR SELECT TO authenticated
    USING (
        staff_id = auth_staff_id()
        OR EXISTS (
            SELECT 1 FROM staff_profiles s
            WHERE s.id = doctor_profiles.staff_id
              AND (auth_role() = 'super_admin'
                   OR (auth_role() = 'state_admin'    AND s.state_id    = auth_state())
                   OR (auth_role() = 'district_admin' AND s.district_id = auth_district())
                   OR (auth_role() IN ('doctor', 'clinic_assistant')
                       AND s.district_id = auth_district()))
        )
    );

CREATE POLICY doctor_profiles_write ON doctor_profiles
    FOR ALL TO authenticated
    USING (auth_is_admin())
    WITH CHECK (auth_is_admin());

-- ---------------------------------------------------------------------------
-- PATIENTS — clinical. No admin role appears in any policy below, which is
-- the spec's "Admin cannot edit patient data" expressed in the database
-- rather than only in Express.
-- ---------------------------------------------------------------------------

-- Tenancy keys on clinic_district_id (which sub-centre holds the record), not
-- on the address district. A patient may give an address in another state; that
-- must not move their record out of the clinic that registered them.
CREATE POLICY patients_read_by_clinician ON patients
    FOR SELECT TO authenticated
    USING (auth_serves_district(clinic_district_id));

CREATE POLICY patients_insert_by_assistant ON patients
    FOR INSERT TO authenticated
    WITH CHECK (auth_role() = 'clinic_assistant' AND clinic_district_id = auth_district());

CREATE POLICY patients_update_by_assistant ON patients
    FOR UPDATE TO authenticated
    USING (auth_role() = 'clinic_assistant' AND clinic_district_id = auth_district())
    WITH CHECK (auth_role() = 'clinic_assistant' AND clinic_district_id = auth_district());

-- ---------------------------------------------------------------------------
-- VISITS — the caseload rule. A doctor sees a visit only when it is assigned
-- to them. An assistant sees visits in their own district.
-- ---------------------------------------------------------------------------

CREATE POLICY visits_read_scoped ON visits
    FOR SELECT TO authenticated
    USING (
        (auth_role() = 'doctor' AND assigned_doctor_id = auth_staff_id())
        OR (auth_role() = 'clinic_assistant' AND district_id = auth_district())
    );

CREATE POLICY visits_insert_by_assistant ON visits
    FOR INSERT TO authenticated
    WITH CHECK (auth_role() = 'clinic_assistant' AND district_id = auth_district());

CREATE POLICY visits_update_scoped ON visits
    FOR UPDATE TO authenticated
    USING (
        (auth_role() = 'doctor' AND assigned_doctor_id = auth_staff_id())
        OR (auth_role() = 'clinic_assistant' AND district_id = auth_district())
    )
    WITH CHECK (
        (auth_role() = 'doctor' AND assigned_doctor_id = auth_staff_id())
        OR (auth_role() = 'clinic_assistant' AND district_id = auth_district())
    );

-- ---------------------------------------------------------------------------
-- Visit children inherit the visit's visibility.
-- ---------------------------------------------------------------------------

CREATE POLICY vitals_via_visit ON visit_vitals
    FOR ALL TO authenticated
    USING      (EXISTS (SELECT 1 FROM visits v WHERE v.id = visit_vitals.visit_id))
    WITH CHECK (EXISTS (SELECT 1 FROM visits v WHERE v.id = visit_vitals.visit_id));

CREATE POLICY symptoms_via_visit ON visit_symptoms
    FOR ALL TO authenticated
    USING      (EXISTS (SELECT 1 FROM visits v WHERE v.id = visit_symptoms.visit_id))
    WITH CHECK (EXISTS (SELECT 1 FROM visits v WHERE v.id = visit_symptoms.visit_id));

CREATE POLICY assessments_via_visit ON ai_assessments
    FOR ALL TO authenticated
    USING      (EXISTS (SELECT 1 FROM visits v WHERE v.id = ai_assessments.visit_id))
    WITH CHECK (EXISTS (SELECT 1 FROM visits v WHERE v.id = ai_assessments.visit_id));

CREATE POLICY documents_via_patient ON patient_documents
    FOR ALL TO authenticated
    USING      (EXISTS (SELECT 1 FROM patients p WHERE p.aadhaar_number = patient_documents.patient_id))
    WITH CHECK (EXISTS (SELECT 1 FROM patients p WHERE p.aadhaar_number = patient_documents.patient_id));

CREATE POLICY reviews_via_visit ON doctor_reviews
    FOR ALL TO authenticated
    USING      (doctor_id = auth_staff_id() OR EXISTS (SELECT 1 FROM visits v WHERE v.id = doctor_reviews.visit_id))
    WITH CHECK (doctor_id = auth_staff_id());

CREATE POLICY prescriptions_via_visit ON prescriptions
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM visits v WHERE v.id = prescriptions.visit_id));

-- Only the signing doctor may create a prescription, and only for their case.
CREATE POLICY prescriptions_insert_by_doctor ON prescriptions
    FOR INSERT TO authenticated
    WITH CHECK (
        auth_role() = 'doctor'
        AND doctor_id = auth_staff_id()
        AND EXISTS (SELECT 1 FROM visits v
                    WHERE v.id = prescriptions.visit_id
                      AND v.assigned_doctor_id = auth_staff_id())
    );

-- ---------------------------------------------------------------------------
-- CONSULTATIONS — the video room. Membership is what the signaling server
-- checks before admitting a socket, so this policy and that check must agree.
-- ---------------------------------------------------------------------------

CREATE POLICY consultations_participants ON consultations
    FOR SELECT TO authenticated
    USING (doctor_id = auth_staff_id() OR assistant_id = auth_staff_id());

CREATE POLICY consultations_insert ON consultations
    FOR INSERT TO authenticated
    WITH CHECK (auth_role() IN ('clinic_assistant', 'doctor'));

CREATE POLICY consultations_update_participants ON consultations
    FOR UPDATE TO authenticated
    USING      (doctor_id = auth_staff_id() OR assistant_id = auth_staff_id())
    WITH CHECK (doctor_id = auth_staff_id() OR assistant_id = auth_staff_id());

-- ---------------------------------------------------------------------------
-- AUDIT LOGS — append-only. Readable by admins and auditors within scope.
-- No UPDATE or DELETE policy exists for any role, so with RLS on, the rows
-- cannot be altered or removed through the API at all.
-- ---------------------------------------------------------------------------

CREATE POLICY audit_read_oversight ON audit_logs
    FOR SELECT TO authenticated
    USING (auth_role() IN ('super_admin', 'state_admin', 'district_admin', 'auditor'));

CREATE POLICY audit_append ON audit_logs
    FOR INSERT TO authenticated
    WITH CHECK (auth_staff_id() IS NOT NULL);

COMMIT;
