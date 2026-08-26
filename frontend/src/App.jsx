import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';

import SidebarLayout from './components/SidebarLayout';
import CursorGradient from './components/CursorGradient';

import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';

import AssistantDashboard from './pages/AssistantDashboard';
import PatientRegistrationPage from './pages/PatientRegistrationPage';
import PatientAssessmentVisitPage from './pages/PatientAssessmentVisitPage';

import DoctorQueueDashboard from './pages/DoctorQueueDashboard';
import DoctorCaseViewPage from './pages/DoctorCaseViewPage';

import AdminDashboard from './pages/AdminDashboard';

function ProtectedRoute({ children, allowedRoles }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <div className="min-h-screen relative font-sans">
        {/* Interactive Cursor-Following Radial Gradient */}
        <CursorGradient />

        <SidebarLayout>
          <Routes>
            {/* Public Routes */}
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            {/* No public /register. Staff accounts are created by an Admin
                via the admin console — see docs/PHASE1_PRODUCTION_READINESS_PLAN.md §C.3. */}

            {/* Clinic Assistant Routes */}
            <Route
              path="/assistant/dashboard"
              element={
                <ProtectedRoute allowedRoles={['CLINIC_ASSISTANT', 'ADMIN']}>
                  <AssistantDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/assistant/patients/new"
              element={
                <ProtectedRoute allowedRoles={['CLINIC_ASSISTANT', 'ADMIN']}>
                  <PatientRegistrationPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/assistant/assessment/:id"
              element={
                <ProtectedRoute allowedRoles={['CLINIC_ASSISTANT', 'ADMIN']}>
                  <PatientAssessmentVisitPage />
                </ProtectedRoute>
              }
            />

            {/* Doctor Routes */}
            <Route
              path="/doctor/queue"
              element={
                <ProtectedRoute allowedRoles={['DOCTOR', 'ADMIN']}>
                  <DoctorQueueDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/doctor/cases/:id"
              element={
                <ProtectedRoute allowedRoles={['DOCTOR', 'ADMIN']}>
                  <DoctorCaseViewPage />
                </ProtectedRoute>
              }
            />

            {/* Admin Routes */}
            <Route
              path="/admin/dashboard"
              element={
                <ProtectedRoute allowedRoles={['ADMIN']}>
                  <AdminDashboard />
                </ProtectedRoute>
              }
            />

            {/* Fallback Catch-all */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </SidebarLayout>
      </div>
    </AuthProvider>
  );
}
