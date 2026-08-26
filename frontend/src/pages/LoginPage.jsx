import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ClinicalUseNotice from '../components/ClinicalUseNotice';
import { ArrowRight, Lock, Eye, EyeOff } from 'lucide-react';

const DEMO_ACCOUNTS = [
  { label: 'Clinic Assistant', email: 'assistant@clinic.org', password: 'Assist@123' },
  { label: 'Doctor — General Medicine', email: 'doctor@clinic.org', password: 'Doctor@123' },
  { label: 'Doctor — Pediatrics', email: 'dr.priya@clinic.org', password: 'Priya@1234' },
  { label: 'Doctor — Cardiology', email: 'dr.arjun@clinic.org', password: 'Arjun@1234' },
  { label: 'Doctor — Dermatology', email: 'dr.kavita@clinic.org', password: 'Kavita@1234' },
  { label: 'Doctor — Orthopedics', email: 'dr.sanjay@clinic.org', password: 'Sanjay@1234' },
  { label: 'Doctor — General Medicine', email: 'dr.meera@clinic.org', password: 'Meera@1234' },
  { label: 'Administrator', email: 'admin@clinic.org', password: 'Admin@123' }
];

const HOME_BY_ROLE = {
  DOCTOR: '/doctor/queue',
  ADMIN: '/admin/dashboard',
  CLINIC_ASSISTANT: '/assistant/dashboard'
};

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const { loginUser, loading } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const userProfile = await loginUser(email, password);
      navigate(HOME_BY_ROLE[userProfile.role] || '/assistant/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Sign-in failed. Check your email and password.');
    }
  };

  const fillDemo = (account) => {
    setEmail(account.email);
    setPassword(account.password);
    setError('');
  };

  return (
    <div className="min-h-[85vh] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md p-8 rounded-lg border border-slate-200 shadow-sm space-y-6">

        <ClinicalUseNotice variant="card" />

        <div className="text-center space-y-2">
          <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center mx-auto">
            <Lock className="w-5 h-5" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">Staff Sign In</h2>
          <p className="text-xs text-slate-500">
            Sign in with your registered email and password. Your dashboard is determined by your registered role.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Email address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@clinic.org"
              className="w-full bg-white border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="Your password"
                className="w-full bg-white border border-slate-300 rounded-lg px-3.5 py-2.5 pr-10 text-sm text-slate-900 focus:border-blue-500 outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">{error}</div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold text-sm shadow-sm transition-colors flex items-center justify-center gap-2"
          >
            {loading ? 'Verifying credentials...' : 'Sign In'} <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="border-t border-slate-200 pt-4 space-y-2">
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Demo accounts (click to fill)</p>
          <div className="grid grid-cols-3 gap-2">
            {DEMO_ACCOUNTS.map((acc) => (
              <button
                key={acc.email}
                type="button"
                onClick={() => fillDemo(acc)}
                className="px-2 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-blue-50 hover:border-blue-200 text-[11px] font-semibold text-slate-700 transition-colors"
              >
                {acc.label}
              </button>
            ))}
          </div>
        </div>

        <div className="text-center text-xs text-slate-500">
          Staff accounts are issued by your administrator.
        </div>
      </div>
    </div>
  );
}
