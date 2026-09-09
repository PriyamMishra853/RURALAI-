import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import ClinicalUseNotice from '../components/ClinicalUseNotice';
import HealthCardScanner from '../components/HealthCardScanner';
import {
  GENDERS, digitsOnly, formatAadhaar, ageDisplay, validatePatient, toPayload, AADHAAR_RE
} from '../config/patientFields';
import { UserPlus, Search, Loader2, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';

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
  const { t, formatNumber } = useI18n();
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
      .catch(() => setBanner({
        kind: 'error',
        text: t('register.statesFailed', 'Could not load the state list. Check your connection.')
      }));
  }, [t]);

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

  const age = useMemo(() => ageDisplay(form.date_of_birth, t), [form.date_of_birth, t]);
  const aadhaarDigits = digitsOnly(form.aadhaar_number);

  /** Step 1 — is this Aadhaar already on the register at this clinic? */
  const checkAadhaar = async () => {
    if (!AADHAAR_RE.test(aadhaarDigits)) {
      setTouched((t) => ({ ...t, aadhaar_number: true }));
      setErrors((e) => ({ ...e, aadhaar_number: t('validate.aadhaarDigits', 'Must be exactly 12 digits.') }));
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
        setBanner({
          kind: 'error',
          text: err.response?.data?.error || t('register.lookupFailed', 'Could not check that Aadhaar number.')
        });
      }
    } finally {
      setChecking(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    const found = validatePatient(form, t);
    setErrors(found);
    setTouched(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, true])));
    if (Object.keys(found).length) {
      setBanner({ kind: 'error', text: t('register.fixFields', 'Some fields need attention. They are marked below.') });
      return;
    }

    setSaving(true);
    setBanner(null);
    try {
      const res = await api.post('/patients', toPayload(form));
      setBanner({ kind: 'ok', text: t('register.done', '{name} registered.', { name: res.data.full_name }) });
      setTimeout(() => navigate('/assistant/dashboard'), 900);
    } catch (err) {
      // The API returns per-field messages; surface them on the inputs.
      if (err.response?.data?.fields) setErrors(err.response.data.fields);
      setBanner({ kind: 'error', text: err.response?.data?.error || t('register.failed', 'Registration failed.') });
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
          <h1 className="text-lg font-bold text-ink">{t('nav.register', 'Register Patient')}</h1>
          <p className="text-xs text-ink-muted">
            {user?.district
              ? t('assistant.subCentre', '{district} sub-centre', { district: user.district })
              : t('register.yourSubCentre', 'Your sub-centre')}
            {' · '}
            {t('register.aadhaarIsKey', 'the Aadhaar number is the patient’s record number')}
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
          <h2 className="text-sm font-bold text-ink">{t('register.step1', '1. Aadhaar number')}</h2>
          {step === 'details' && (
            <button
              type="button"
              onClick={() => { setStep('aadhaar'); setExisting(null); }}
              className="text-[11px] text-gov-600 hover:underline"
            >
              {t('common.change', 'Change')}
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
            aria-label={t('field.aadhaar', 'Aadhaar number')}
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
              {t('common.check', 'Check')}
            </button>
          )}
        </div>
        {showError('aadhaar_number')
          ? <p className="text-[11px] text-tier-emergency">{showError('aadhaar_number')}</p>
          : (
            <p className="text-[11px] text-ink-subtle">
              {t('register.digitCount', '{count}/12 digits', { count: formatNumber(aadhaarDigits.length) })}
            </p>
          )}

        {/* Already on the register — skip re-typing everything. */}
        {existing && (
          <div className="p-3 rounded-field bg-tier-moderateBg border border-tier-moderate/30 space-y-2">
            <p className="text-xs font-semibold text-tier-moderate">
              {t('register.alreadyRegistered', 'Already registered at this clinic')}
            </p>
            <p className="text-xs text-tier-moderate">
              {existing.full_name}
              {' · '}
              {existing.age_display
                || t('field.ageYears', '{age} yr', { age: formatNumber(existing.age_years) })}
              {' · '}
              {t('gender.' + String(existing.gender || '').toLowerCase(), existing.gender)}
              {' · '}
              {existing.village_line1}
            </p>
            <button
              type="button"
              onClick={() => navigate('/assistant/dashboard')}
              className="text-[11px] font-semibold text-tier-moderate hover:underline flex items-center gap-1"
            >
              {t('register.openExisting', 'Open the existing record')} <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* ---------------- Step 2: Details ---------------- */}
      {step === 'details' && (
        <form onSubmit={submit} className="bg-surface-raised rounded-field border border-line p-5 space-y-5">
          <h2 className="text-sm font-bold text-ink">{t('register.step2', '2. Patient details')}</h2>

          {/* Sits above the fields, after the Aadhaar step, so it can fill them
              in — but it only ever proposes. `set` marks the field touched the
              same way typing does, so validation behaves identically whether a
              value was typed or accepted from a card. */}
          <HealthCardScanner form={form} onApply={set} />

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label={t('field.patientName', 'Patient name')} required error={showError('full_name')}>
              <input
                value={form.full_name}
                onChange={(e) => set('full_name', e.target.value)}
                onBlur={() => blur('full_name')}
                autoComplete="off"
                placeholder={t('field.fullName', 'Full name')}
                className={inputClass(showError('full_name'))}
              />
            </Field>

            <Field label={t('field.gender', 'Gender')} required error={showError('gender')}>
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
                    {t(g.key, g.label)}
                  </button>
                ))}
              </div>
            </Field>

            <Field
              label={t('field.dob', 'Date of birth')}
              required
              error={showError('date_of_birth')}
              hint={t('register.dobHint', 'Age is calculated from this — it is never typed in.')}
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

            <Field label={t('field.age', 'Age')} hint={t('register.ageHint', 'Calculated automatically')}>
              <div className="w-full bg-surface-sunken border border-line rounded-field px-3 py-2.5 text-sm font-semibold text-ink-muted">
                {age || (
                  <span className="font-normal text-ink-subtle">
                    {t('register.enterDob', 'Enter date of birth')}
                  </span>
                )}
              </div>
            </Field>

            <Field
              label={t('field.phoneNumber', 'Phone number')}
              required
              error={showError('phone')}
              hint={t('validate.phoneFormat', '10 digits, starting 6-9.')}
            >
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
            <h3 className="text-xs font-bold text-ink mt-4 mb-3">{t('field.address', 'Address')}</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2 grid gap-2">
                <Field label={t('field.village', 'Village')} required error={showError('village_line1')}>
                  <input
                    value={form.village_line1}
                    onChange={(e) => set('village_line1', e.target.value)}
                    onBlur={() => blur('village_line1')}
                    placeholder={t('register.line1', 'Line 1 — village or hamlet')}
                    className={inputClass(showError('village_line1'))}
                  />
                </Field>
                <input
                  value={form.village_line2}
                  onChange={(e) => set('village_line2', e.target.value)}
                  placeholder={t('register.line2', 'Line 2 — landmark or tola (optional)')}
                  className={inputClass(false)}
                />
              </div>

              <Field label={t('field.state', 'State')} required error={showError('address_state_id')}>
                <select
                  value={form.address_state_id}
                  onChange={(e) => { set('address_state_id', e.target.value); set('address_district', ''); }}
                  onBlur={() => blur('address_state_id')}
                  className={inputClass(showError('address_state_id'))}
                >
                  <option value="">{t('register.selectState', 'Select a state')}</option>
                  <optgroup label={t('register.states', 'States')}>
                    {states.filter((s) => s.region_type === 'state').map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </optgroup>
                  <optgroup label={t('register.unionTerritories', 'Union Territories')}>
                    {states.filter((s) => s.region_type === 'union_territory').map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </optgroup>
                </select>
              </Field>

              <Field
                label={t('field.district', 'District')}
                required
                error={showError('address_district')}
                hint={districts.length
                  ? t('register.districtsSuggested', '{count} districts suggested', { count: formatNumber(districts.length) })
                  : t('register.typeDistrict', 'Type the district name')}
              >
                <input
                  list="district-options"
                  value={form.address_district}
                  onChange={(e) => set('address_district', e.target.value)}
                  onBlur={() => blur('address_district')}
                  disabled={!form.address_state_id}
                  placeholder={form.address_state_id
                    ? t('register.startTyping', 'Start typing…')
                    : t('register.selectStateFirst', 'Select a state first')}
                  className={`${inputClass(showError('address_district'))} disabled:bg-surface-sunken`}
                />
                <datalist id="district-options">
                  {districts.map((d) => <option key={d.id} value={d.name} />)}
                </datalist>
              </Field>

              <Field
                label={t('field.pin', 'PIN code')}
                required
                error={showError('pin_code')}
                hint={t('register.sixDigits', '6 digits')}
              >
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
              {saving ? t('common.saving', 'Saving…') : t('nav.register', 'Register Patient')}
            </button>
            <button
              type="button"
              onClick={() => navigate('/assistant/dashboard')}
              className="px-5 py-2.5 rounded-field border border-line-strong text-ink-muted text-sm font-semibold hover:bg-surface-sunken"
            >
              {t('common.cancel', 'Cancel')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
