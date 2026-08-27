import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import ClinicalUseNotice from '../components/ClinicalUseNotice';
import {
  GENDERS, digitsOnly, formatAadhaar, ageDisplay, validatePatient, toPayload, AADHAAR_RE
} from '../config/patientFields';
import { UserPlus, Search, Loader2, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';

/**
 * Patient registration.
 *
 * Six fields, nothing else:
 *   1. Aadhaar (12 digits) — the primary key. No separate patient code.
 *   2. Name          4. Date of birth (age is shown live, never typed)
 *   3. Gender        5. Address: village x2, district, state, PIN
 *                    6. Phone (10 digits)
 *
 * Aadhaar is checked against the register before the rest of the form opens.
 * A returning patient is the common case at a village sub-centre, and typing
 * eight fields only to hit "already registered" is the slowest possible way to
 * discover that.
 */

const EMPTY = {
  aadhaar_number: '', full_name: '', gender: '', date_of_birth: '',
  village_line1: '', village_line2: '', address_district: '',
  address_state_id: '', pin_code: '', phone: ''
};

function Field({ label, error, hint, required, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-ink-muted mb-1">
        {label} {required && <span className="text-tier-emergency">*</span>}
      </label>
      {children}
      {error
        ? <p className="mt-1 text-[11px] text-tier-emergency flex items-center gap-1"><AlertCircle className="w-3 h-3" />{error}</p>
        : hint && <p className="mt-1 text-[11px] text-ink-subtle">{hint}</p>}
    </div>
  );
}

const inputClass = (bad) =>
  `w-full bg-surface-raised border rounded-field px-3 py-2.5 text-sm text-ink outline-none transition-colors ${
    bad ? 'border-tier-emergency/40 focus:border-red-500' : 'border-line-strong focus:border-gov-500'
  }`;

export default function PatientRegistrationPage() {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [states, setStates] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [step, setStep] = useState('aadhaar');   // 'aadhaar' -> 'details'
  const [checking, setChecking] = useState(false);
  const [existing, setExisting] = useState(null);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState(null);
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    api.get('/regions/states')
      .then((r) => setStates(r.data.states || []))
      .catch(() => setBanner({ kind: 'error', text: 'Could not load the state list. Check your connection.' }));
  }, []);

  // District suggestions follow the selected state. Seeded for UP only, so this
  // is a datalist rather than a select — any Indian district must be enterable.
  useEffect(() => {
    if (!form.address_state_id) { setDistricts([]); return; }
    api.get('/regions/districts', { params: { stateId: form.address_state_id } })
      .then((r) => setDistricts(r.data.districts || []))
      .catch(() => setDistricts([]));
  }, [form.address_state_id]);

  const set = useCallback((key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  }, []);

  const blur = (key) => setTouched((t) => ({ ...t, [key]: true }));
  const showError = (key) => (touched[key] ? errors[key] : undefined);

  const age = useMemo(() => ageDisplay(form.date_of_birth), [form.date_of_birth]);
  const aadhaarDigits = digitsOnly(form.aadhaar_number);

  /** Step 1 — is this Aadhaar already on the register at this clinic? */
  const checkAadhaar = async () => {
    if (!AADHAAR_RE.test(aadhaarDigits)) {
      setTouched((t) => ({ ...t, aadhaar_number: true }));
      setErrors((e) => ({ ...e, aadhaar_number: 'Must be exactly 12 digits.' }));
      return;
    }
    setChecking(true);
    setExisting(null);
    setBanner(null);
    try {
      const res = await api.post('/patients/lookup', { aadhaar_number: aadhaarDigits });
      setExisting(res.data);   // already registered — offer the record instead
    } catch (err) {
      if (err.response?.status === 404) {
        setStep('details');    // not on the register: continue to the form
      } else {
        setBanner({ kind: 'error', text: err.response?.data?.error || 'Could not check that Aadhaar number.' });
      }
    } finally {
      setChecking(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    const found = validatePatient(form);
    setErrors(found);
    setTouched(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, true])));
    if (Object.keys(found).length) {
      setBanner({ kind: 'error', text: 'Some fields need attention. They are marked below.' });
      return;
    }

    setSaving(true);
    setBanner(null);
    try {
      const res = await api.post('/patients', toPayload(form));
      setBanner({ kind: 'ok', text: `${res.data.full_name} registered.` });
      setTimeout(() => navigate('/assistant/dashboard'), 900);
    } catch (err) {
      // The API returns per-field messages; surface them on the inputs.
      if (err.response?.data?.fields) setErrors(err.response.data.fields);
      setBanner({ kind: 'error', text: err.response?.data?.error || 'Registration failed.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-5">
      <ClinicalUseNotice variant="card" />

      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-field bg-gov-50 text-gov-600 border border-gov-200 flex items-center justify-center">
          <UserPlus className="w-4 h-4" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-ink">Register Patient</h1>
          <p className="text-xs text-ink-muted">
            {user?.district ? `${user.district} sub-centre` : 'Your sub-centre'} · the Aadhaar number is the patient's record number
          </p>
        </div>
      </div>

      {banner && (
        <div
          role="alert"
          className={`p-3 rounded-field border text-xs flex items-center gap-2 ${
            banner.kind === 'ok'
              ? 'bg-tier-lowBg border-tier-low/30 text-tier-low'
              : 'bg-tier-emergencyBg border-tier-emergency/30 text-tier-emergency'
          }`}
        >
          {banner.kind === 'ok' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {banner.text}
        </div>
      )}

      {/* ---------------- Step 1: Aadhaar ---------------- */}
      <div className="bg-surface-raised rounded-field border border-line p-5 space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-bold text-ink">1. Aadhaar number</h2>
          {step === 'details' && (
            <button
              type="button"
              onClick={() => { setStep('aadhaar'); setExisting(null); }}
              className="text-[11px] text-gov-600 hover:underline"
            >
              Change
            </button>
          )}
        </div>

        <div className="flex gap-2">
          <input
            inputMode="numeric"
            autoComplete="off"
            value={formatAadhaar(form.aadhaar_number)}
            onChange={(e) => { set('aadhaar_number', digitsOnly(e.target.value).slice(0, 12)); setExisting(null); }}
            onBlur={() => blur('aadhaar_number')}
            disabled={step === 'details'}
            placeholder="1234 5678 9012"
            aria-label="Aadhaar number"
            className={`${inputClass(showError('aadhaar_number'))} font-mono tracking-wider disabled:bg-surface-sunken disabled:text-ink-muted`}
          />
          {step === 'aadhaar' && (
            <button
              type="button"
              onClick={checkAadhaar}
              disabled={checking || aadhaarDigits.length !== 12}
              className="px-4 py-2.5 rounded-field bg-gov-600 hover:bg-gov-700 disabled:opacity-50 text-white text-sm font-semibold flex items-center gap-2 shrink-0"
            >
              {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Check
            </button>
          )}
        </div>
        {showError('aadhaar_number')
          ? <p className="text-[11px] text-tier-emergency">{showError('aadhaar_number')}</p>
          : <p className="text-[11px] text-ink-subtle">{aadhaarDigits.length}/12 digits</p>}

        {/* Already on the register — skip re-typing everything. */}
        {existing && (
          <div className="p-3 rounded-field bg-tier-moderateBg border border-tier-moderate/30 space-y-2">
            <p className="text-xs font-semibold text-tier-moderate">Already registered at this clinic</p>
            <p className="text-xs text-tier-moderate">
              {existing.full_name} · {existing.age_display || `${existing.age_years} yr`} · {existing.gender} · {existing.village_line1}
            </p>
            <button
              type="button"
              onClick={() => navigate('/assistant/dashboard')}
              className="text-[11px] font-semibold text-tier-moderate hover:underline flex items-center gap-1"
            >
              Open the existing record <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* ---------------- Step 2: Details ---------------- */}
      {step === 'details' && (
        <form onSubmit={submit} className="bg-surface-raised rounded-field border border-line p-5 space-y-5">
          <h2 className="text-sm font-bold text-ink">2. Patient details</h2>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Patient name" required error={showError('full_name')}>
              <input
                value={form.full_name}
                onChange={(e) => set('full_name', e.target.value)}
                onBlur={() => blur('full_name')}
                autoComplete="off"
                placeholder="Full name"
                className={inputClass(showError('full_name'))}
              />
            </Field>

            <Field label="Gender" required error={showError('gender')}>
              <div className="flex gap-2">
                {GENDERS.map((g) => (
                  <button
                    key={g.value}
                    type="button"
                    onClick={() => { set('gender', g.value); blur('gender'); }}
                    className={`flex-1 py-2.5 rounded-field border text-sm font-semibold transition-colors ${
                      form.gender === g.value
                        ? 'bg-gov-600 border-blue-600 text-white'
                        : 'bg-surface-raised border-line-strong text-ink-muted hover:border-gov-300'
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </Field>

            <Field
              label="Date of birth"
              required
              error={showError('date_of_birth')}
              hint="Age is calculated from this — it is never typed in."
            >
              <input
                type="date"
                value={form.date_of_birth}
                onChange={(e) => set('date_of_birth', e.target.value)}
                onBlur={() => blur('date_of_birth')}
                max={new Date().toISOString().slice(0, 10)}
                className={inputClass(showError('date_of_birth'))}
              />
            </Field>

            <Field label="Age" hint="Calculated automatically">
              <div className="w-full bg-surface-sunken border border-line rounded-field px-3 py-2.5 text-sm font-semibold text-ink-muted">
                {age || <span className="font-normal text-ink-subtle">Enter date of birth</span>}
              </div>
            </Field>

            <Field label="Phone number" required error={showError('phone')} hint="10 digits, starting 6-9">
              <div className="flex">
                <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-line-strong bg-surface-sunken text-sm text-ink-muted">
                  +91
                </span>
                <input
                  inputMode="numeric"
                  autoComplete="off"
                  value={form.phone}
                  onChange={(e) => set('phone', digitsOnly(e.target.value).slice(0, 10))}
                  onBlur={() => blur('phone')}
                  placeholder="9876543210"
                  className={`${inputClass(showError('phone'))} rounded-l-none font-mono`}
                />
              </div>
            </Field>
          </div>

          <div className="pt-1 border-t border-line">
            <h3 className="text-xs font-bold text-ink mt-4 mb-3">Address</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2 grid gap-2">
                <Field label="Village" required error={showError('village_line1')}>
                  <input
                    value={form.village_line1}
                    onChange={(e) => set('village_line1', e.target.value)}
                    onBlur={() => blur('village_line1')}
                    placeholder="Line 1 — village or hamlet"
                    className={inputClass(showError('village_line1'))}
                  />
                </Field>
                <input
                  value={form.village_line2}
                  onChange={(e) => set('village_line2', e.target.value)}
                  placeholder="Line 2 — landmark or tola (optional)"
                  className={inputClass(false)}
                />
              </div>

              <Field label="State" required error={showError('address_state_id')}>
                <select
                  value={form.address_state_id}
                  onChange={(e) => { set('address_state_id', e.target.value); set('address_district', ''); }}
                  onBlur={() => blur('address_state_id')}
                  className={inputClass(showError('address_state_id'))}
                >
                  <option value="">Select a state</option>
                  <optgroup label="States">
                    {states.filter((s) => s.region_type === 'state').map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Union Territories">
                    {states.filter((s) => s.region_type === 'union_territory').map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </optgroup>
                </select>
              </Field>

              <Field
                label="District"
                required
                error={showError('address_district')}
                hint={districts.length ? `${districts.length} districts suggested` : 'Type the district name'}
              >
                <input
                  list="district-options"
                  value={form.address_district}
                  onChange={(e) => set('address_district', e.target.value)}
                  onBlur={() => blur('address_district')}
                  disabled={!form.address_state_id}
                  placeholder={form.address_state_id ? 'Start typing…' : 'Select a state first'}
                  className={`${inputClass(showError('address_district'))} disabled:bg-surface-sunken`}
                />
                <datalist id="district-options">
                  {districts.map((d) => <option key={d.id} value={d.name} />)}
                </datalist>
              </Field>

              <Field label="PIN code" required error={showError('pin_code')} hint="6 digits">
                <input
                  inputMode="numeric"
                  value={form.pin_code}
                  onChange={(e) => set('pin_code', digitsOnly(e.target.value).slice(0, 6))}
                  onBlur={() => blur('pin_code')}
                  placeholder="282001"
                  className={`${inputClass(showError('pin_code'))} font-mono`}
                />
              </Field>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 rounded-field bg-gov-600 hover:bg-gov-700 disabled:opacity-60 text-white text-sm font-semibold flex items-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {saving ? 'Saving…' : 'Register patient'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/assistant/dashboard')}
              className="px-5 py-2.5 rounded-field border border-line-strong text-ink-muted text-sm font-semibold hover:bg-surface-sunken"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
