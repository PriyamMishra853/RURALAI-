import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { homeFor } from '../config/roles';
import { ShieldAlert } from 'lucide-react';

/**
 * Route guard.
 *
 * This decides what to *render*, not what a user may reach — every API call is
 * authorised again on the server. Its job is to stop the app showing a doctor
 * an admin console it would only fail to populate.
 */
export default function RequireRole({ roles, children }) {
  const { user, token, ready } = useAuth();
  const location = useLocation();

  // Wait for the stored session to be revalidated, or a suspended account
  // flashes its old dashboard before being redirected.
  if (!ready) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-sm text-ink-muted">
        Checking your session…
      </div>
    );
  }

  if (!token || !user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (roles && !roles.includes(user.role)) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-4">
        <div className="max-w-sm text-center space-y-3">
          <div className="w-10 h-10 rounded-field bg-tier-moderateBg text-tier-moderate border border-amber-100 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <h2 className="text-base font-bold text-ink">Not available for your role</h2>
          <p className="text-xs text-ink-muted">
            This area is restricted. Your account is signed in, but the role assigned
            to it does not include this section.
          </p>
          <a
            href={homeFor(user.role)}
            className="inline-block px-4 py-2 rounded-field bg-gov-600 hover:bg-gov-700 text-white text-xs font-semibold"
          >
            Go to your dashboard
          </a>
        </div>
      </div>
    );
  }

  return children;
}
