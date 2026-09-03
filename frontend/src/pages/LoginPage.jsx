import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Lock, Eye, EyeOff, ShieldCheck, Info, Activity } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { describeTransportFailure } from '../services/api';
import { homeFor } from '../config/roles';
import { Button, Input, Alert, Card } from '../components/ui';

/**
 * Staff sign-in.
 *
 * One form for every role. There is no sign-up form and no route that could
 * reach one: doctor and clinic assistant accounts are government-assigned, so
 * they exist only because an administrator created them. The API has no
 * registration endpoint for a form to call.
 *
 * The administrator signs in here too — there is no separate visible door.
 * A distinct "admin login" link would advertise the existence of the account
 * the spec asks to keep quiet.
 */

const DEMO_ASSISTANT = import.meta.env.VITE_DEMO_ASSISTANT_EMAIL;
const DEMO_DOCTOR = import.meta.env.VITE_DEMO_DOCTOR_EMAIL;
const SHOW_DEMO = import.meta.env.VITE_DEMO_MODE === 'true' && Boolean(DEMO_ASSISTANT);

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const { loginUser, loading } = useAuth();
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const profile = await loginUser(email, password);
      navigate(profile.home || homeFor(profile.role), { replace: true });
    } catch (err) {
      /*
       * A request that never arrived is not a wrong password.
       *
       * `err.response` is absent when the browser blocked the request before it
       * reached the API — the usual cause being the page opened on a Vercel
       * deployment URL rather than the production domain, which the backend's
       * CORS list does not include. Reporting that as "check your email and
       * password" sends someone to re-check credentials that were correct all
       * along, which has already cost real time here.
       */
      // A request that never arrived is not a wrong password. The client
      // names the host and distinguishes a timeout from being offline, which
      // is the difference between "your network dropped" and "this build is
      // pointed at the wrong address".
      if (!err.response) {
        setError(describeTransportFailure(err));
        return;
      }
      setError(err.response.data?.error || `Sign-in failed (HTTP ${err.response.status}).`);
    }
  };

  return (
    <div className="min-h-screen bg-surface-sunken flex flex-col">
      <div className="h-1 tricolour-rule" aria-hidden="true" />

      <div className="flex-1 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-md"
        >
          <Link to="/" className="flex items-center justify-center gap-2.5 mb-6 group">
            <span className="w-10 h-10 rounded-field bg-gov-600 dark:bg-gov-500 text-white dark:text-gov-950 flex items-center justify-center">
              <Activity className="w-5 h-5" />
            </span>
            <span>
              <span className="block text-sm font-bold text-ink group-hover:text-gov-600 transition-colors">
                Rural Health Grid
              </span>
              <span className="block text-[10px] text-ink-subtle uppercase tracking-wider">
                Village Tele-Clinic Network
              </span>
            </span>
          </Link>

          <Card className="p-6 sm:p-8">
            <div className="text-center mb-6">
              <span className="w-11 h-11 rounded-field bg-gov-50 dark:bg-gov-100 text-gov-600 dark:text-gov-500 flex items-center justify-center mx-auto">
                <Lock className="w-5 h-5" />
              </span>
              <h1 className="mt-3 font-display text-xl font-bold text-ink">Staff Sign In</h1>
              <p className="mt-1 text-xs text-ink-muted leading-relaxed">
                Your dashboard and the records you can reach are determined by the role
                your administrator assigned to this account.
              </p>
            </div>

            <form onSubmit={submit} className="space-y-4">
              <Input
                label="Email address"
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@clinic.gov.in"
              />

              <div>
                <label htmlFor="password" className="label">
                  Password <span className="text-tier-emergency">*</span>
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    placeholder="Your password"
                    className="field pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-ink-subtle hover:text-ink"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {error && <Alert tone="danger">{error}</Alert>}

              <Button type="submit" size="lg" loading={loading} className="w-full">
                {loading ? 'Verifying…' : 'Sign In'}
                {!loading && <ArrowRight className="w-4 h-4" />}
              </Button>
            </form>

            {SHOW_DEMO && (
              <div className="mt-6 pt-5 border-t border-line">
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink-subtle flex items-center gap-1.5">
                  <Info className="w-3 h-3" /> Demo build
                </p>
                <div className="mt-2 grid gap-2">
                  {[
                    { label: 'Clinic Assistant', value: DEMO_ASSISTANT },
                    { label: 'Doctor', value: DEMO_DOCTOR }
                  ].filter((a) => a.value).map((acc) => (
                    <button
                      key={acc.value}
                      type="button"
                      onClick={() => { setEmail(acc.value); setPassword(''); setError(''); }}
                      className="px-3 py-2 rounded-field border border-line bg-surface-sunken hover:border-gov-300 text-left transition-colors"
                    >
                      <span className="block text-[11px] font-bold text-ink">{acc.label}</span>
                      <span className="block text-[10px] text-ink-subtle truncate">{acc.value}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[10px] text-ink-subtle leading-relaxed">
                  Passwords are in <code className="font-mono">database/v2/DEMO_CREDENTIALS.md</code>,
                  which is gitignored. Administrator accounts are never listed here.
                </p>
              </div>
            )}

            <div className="mt-6 pt-5 border-t border-line flex items-start gap-2 text-[11px] text-ink-subtle">
              <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                Staff accounts are issued by an administrator. There is no public sign-up —
                doctor and clinic assistant roles are assigned, not self-selected.
              </p>
            </div>
          </Card>

          <p className="mt-4 text-center text-[11px] text-ink-subtle">
            <Link to="/" className="hover:text-ink transition-colors">← Back to the public site</Link>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
