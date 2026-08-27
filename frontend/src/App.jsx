import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { RealtimeProvider } from './context/RealtimeContext';
import { ThemeProvider } from './context/ThemeContext';

import AppShell from './components/AppShell';
import RequireRole from './components/RequireRole';
import ErrorBoundary from './components/ErrorBoundary';
import { ROLES, ADMIN_ROLES } from './config/roles';

import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';

import AssistantDashboard from './pages/AssistantDashboard';
import PatientRegistrationPage from './pages/PatientRegistrationPage';
import PatientAssessmentVisitPage from './pages/PatientAssessmentVisitPage';

import DoctorQueueDashboard from './pages/DoctorQueueDashboard';
import DoctorCaseViewPage from './pages/DoctorCaseViewPage';

import AdminDashboard from './pages/AdminDashboard';
import CallPage from './pages/CallPage';

/**
 * Route table.
 *
 * The clinical routes previously listed 'ADMIN' alongside CLINIC_ASSISTANT and
 * DOCTOR, which contradicted the spec's "Admin cannot edit patient data" — and
 * contradicted the backend, which blocks every admin role from those endpoints.
 * No admin role appears on a clinical route below.
 */

const ASSISTANT_ONLY = [ROLES.CLINIC_ASSISTANT];
const DOCTOR_ONLY = [ROLES.DOCTOR];
const OVERSIGHT = [...ADMIN_ROLES, ROLES.AUDITOR];

export default function App() {
  return (
    <ThemeProvider>
    <AuthProvider>
      <RealtimeProvider>
      <div className="min-h-screen relative font-sans">

        <AppShell>
          {/* A crash in one page must not blank the whole app. */}
          <ErrorBoundary label="This page">
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            {/*
              There is deliberately no /register route. Doctor and clinic
              assistant accounts are created by an administrator through the
              admin console; the API has no registration endpoint to call.
            */}

            <Route path="/assistant/dashboard" element={
              <RequireRole roles={ASSISTANT_ONLY}><AssistantDashboard /></RequireRole>
            } />
            <Route path="/assistant/patients/new" element={
              <RequireRole roles={ASSISTANT_ONLY}><PatientRegistrationPage /></RequireRole>
            } />
            <Route path="/assistant/assessment/:id" element={
              <RequireRole roles={ASSISTANT_ONLY}><PatientAssessmentVisitPage /></RequireRole>
            } />

            <Route path="/doctor/queue" element={
              <RequireRole roles={DOCTOR_ONLY}><DoctorQueueDashboard /></RequireRole>
            } />
            <Route path="/doctor/cases/:id" element={
              <RequireRole roles={DOCTOR_ONLY}><DoctorCaseViewPage /></RequireRole>
            } />

            {/* The call screen is shared: both participants of a consultation
                reach the same route, and the server decides who may join. */}
            <Route path="/call/:id" element={
              <RequireRole roles={[ROLES.DOCTOR, ROLES.CLINIC_ASSISTANT]}><CallPage /></RequireRole>
            } />

            <Route path="/admin/dashboard" element={
              <RequireRole roles={ADMIN_ROLES}><AdminDashboard /></RequireRole>
            } />
            {/* Auditors reach the log view but nothing that mutates. */}
            <Route path="/admin/audit" element={
              <RequireRole roles={OVERSIGHT}><AdminDashboard auditOnly /></RequireRole>
            } />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </ErrorBoundary>
        </AppShell>
      </div>
      </RealtimeProvider>
    </AuthProvider>
    </ThemeProvider>
  );
}
