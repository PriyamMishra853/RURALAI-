/**
 * Patient field rules, mirroring backend/src/services/patientFields.js.
 *
 * Duplicated deliberately so the form can validate as the user types instead of
 * waiting for a round trip. The backend copy is the authority — it re-validates
 * everything, because anything in this bundle is editable by whoever holds the
 * browser. If you change a rule, change it in both files.
 *
 * ── Messages, and why `t` is an argument ────────────────────────────────────
 *
 * The rules here are not React, but the messages they return are read by a
 * health worker filling in a form and so have to be in their language. Rather
 * than convert these into hooks, the functions that produce text take `t` as a
 * trailing argument defaulting to `plainT`, which renders the English. A
 * component passes the real translator; a test or a payload builder passes
 * nothing and behaves exactly as before.
 */
import { plainT } from '../i18n/plain.js';

export const AADHAAR_RE = /^[0-9]{12}$/;
export const PHONE_RE   = /^[6-9][0-9]{9}$/;
export const PIN_RE     = /^[1-9][0-9]{5}$/;

/* `value` is the wire format and is compared server-side; only `label` is UI. */
export const GENDERS = [
  { value: 'male',   key: 'gender.male',   label: 'Male' },
  { value: 'female', key: 'gender.female', label: 'Female' },
  { value: 'other',  key: 'gender.other',  label: 'Other' }
];

export const digitsOnly = (v) => String(v ?? '').replace(/\D/g, '');

/** Display Aadhaar as 1234 5678 9012 while keeping the stored value plain. */
export const formatAadhaar = (v) =>
  digitsOnly(v).slice(0, 12).replace(/(\d{4})(?=\d)/g, '$1 ').trim();

export const ageFromDob = (dob) => {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let years = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) years -= 1;
  return years < 0 ? null : years;
};

/** Under two years, months are what matter clinically — "0 years" says nothing. */
export const ageDisplay = (dob, t = plainT) => {
  const years = ageFromDob(dob);
  if (years === null) return null;
  if (years >= 2) return t('age.years', '{count} years', { count: years });

  const birth = new Date(dob);
  const now = new Date();
  let months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
  if (now.getDate() < birth.getDate()) months -= 1;
  months = Math.max(0, months);
  // One key per number rather than an appended English "s" — most of the
  // languages here do not form plurals that way, and several do not mark a
  // counted noun for plural at all.
  if (months >= 1) {
    return months === 1
      ? t('age.month', '{count} month', { count: months })
      : t('age.months', '{count} months', { count: months });
  }

  const days = Math.max(0, Math.floor((now - birth) / 86400000));
  return days === 1
    ? t('age.day', '{count} day', { count: days })
    : t('age.days', '{count} days', { count: days });
};

/** Per-field validation. Returns a { field: message } object; empty means valid. */
export const validatePatient = (form, t = plainT) => {
  const e = {};

  const aadhaar = digitsOnly(form.aadhaar_number);
  if (!aadhaar) e.aadhaar_number = t('validate.aadhaarRequired', 'Aadhaar number is required.');
  else if (!AADHAAR_RE.test(aadhaar)) e.aadhaar_number = t('validate.aadhaarDigits', 'Must be exactly 12 digits.');

  if (!form.full_name?.trim()) e.full_name = t('validate.nameRequired', 'Patient name is required.');
  else if (form.full_name.trim().length < 2) e.full_name = t('validate.nameFull', 'Enter the full name.');

  if (!form.gender) e.gender = t('validate.genderRequired', 'Select a gender.');

  if (!form.date_of_birth) {
    e.date_of_birth = t('validate.dobRequired', 'Date of birth is required.');
  } else {
    const d = new Date(form.date_of_birth);
    if (Number.isNaN(d.getTime())) e.date_of_birth = t('validate.dateInvalid', 'Enter a valid date.');
    else if (d > new Date()) e.date_of_birth = t('validate.dateFuture', 'Cannot be in the future.');
    else if (ageFromDob(form.date_of_birth) > 120) e.date_of_birth = t('validate.dateTooOld', 'More than 120 years ago — check the year.');
  }

  if (!form.village_line1?.trim()) e.village_line1 = t('validate.villageRequired', 'Village is required.');
  if (!form.address_district?.trim()) e.address_district = t('validate.districtRequired', 'District is required.');
  if (!form.address_state_id) e.address_state_id = t('validate.stateRequired', 'Select a state.');

  const pin = digitsOnly(form.pin_code);
  if (!pin) e.pin_code = t('validate.pinRequired', 'PIN code is required.');
  else if (!PIN_RE.test(pin)) e.pin_code = t('validate.pinFormat', '6 digits, cannot start with 0.');

  const phone = digitsOnly(form.phone);
  if (!phone) e.phone = t('validate.phoneRequired', 'Phone number is required.');
  else if (!PHONE_RE.test(phone)) e.phone = t('validate.phoneFormat', '10 digits, starting 6-9.');

  return e;
};

/** The exact payload POST /api/patients expects. */
export const toPayload = (form) => ({
  aadhaar_number: digitsOnly(form.aadhaar_number),
  full_name: form.full_name.trim(),
  gender: form.gender,
  date_of_birth: form.date_of_birth,
  village_line1: form.village_line1.trim(),
  village_line2: form.village_line2?.trim() || null,
  address_district: form.address_district.trim(),
  address_state_id: form.address_state_id,
  pin_code: digitsOnly(form.pin_code),
  phone: digitsOnly(form.phone)
});

/**
 * Masked Aadhaar for on-screen lists: `XXXX XXXX 9012`.
 *
 * The last four digits are enough for staff to tell two records apart, and
 * Aadhaar Act 2016 §29(4) prohibits public display of the full number — a
 * patient list on a shared clinic screen is exactly that situation. The full
 * value is still the record key and is returned by the API; it is shown in
 * full only on the single-patient view.
 */
export const maskAadhaar = (v) => {
  const d = digitsOnly(v);
  return d.length === 12 ? `XXXX XXXX ${d.slice(-4)}` : (d || '—');
};
