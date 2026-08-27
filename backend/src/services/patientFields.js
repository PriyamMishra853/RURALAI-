/**
 * Validation and derivation for the patient registration fields.
 *
 * Kept out of the controller so the same rules can be unit-tested and so the
 * frontend form and the API cannot drift apart — the regexes here are the
 * authority, and frontend/src/config/patientFields.js mirrors them.
 */

export const AADHAAR_RE = /^[0-9]{12}$/;
export const PHONE_RE   = /^[6-9][0-9]{9}$/;   // Indian mobile: 10 digits, starts 6-9
export const PIN_RE     = /^[1-9][0-9]{5}$/;   // Indian PIN: 6 digits, never starts 0

export const GENDERS = ['male', 'female', 'other'];

/** Strip spaces and hyphens people type into Aadhaar/phone/PIN fields. */
export const digitsOnly = (v) => String(v ?? '').replace(/[\s-]/g, '');

/**
 * Age, derived from date of birth at read time.
 *
 * Never stored. A stored age is wrong the day after registration, and the
 * triage engine applies different thresholds to infants and to the elderly —
 * so a stale age is a clinical error, not a display bug.
 */
export const ageFromDob = (dob) => {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;

  const now = new Date();
  let years = now.getUTCFullYear() - birth.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - birth.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < birth.getUTCDate())) years -= 1;
  return years < 0 ? null : years;
};

/**
 * Human-readable age. Under two years, months matter clinically far more than
 * the integer year does — "0 years" tells a doctor nothing about a neonate.
 */
export const ageDisplay = (dob) => {
  const years = ageFromDob(dob);
  if (years === null) return null;
  if (years >= 2) return `${years} yr`;

  const birth = new Date(dob);
  const now = new Date();
  let months = (now.getUTCFullYear() - birth.getUTCFullYear()) * 12
    + (now.getUTCMonth() - birth.getUTCMonth());
  if (now.getUTCDate() < birth.getUTCDate()) months -= 1;
  months = Math.max(0, months);

  if (months >= 1) return `${months} mo`;
  const days = Math.max(0, Math.floor((now - birth) / 86400000));
  return `${days} d`;
};

/** Attach derived age to a patient row (or array of rows) on the way out. */
export const withAge = (row) => {
  if (Array.isArray(row)) return row.map(withAge);
  if (!row) return row;
  return { ...row, age_years: ageFromDob(row.date_of_birth), age_display: ageDisplay(row.date_of_birth) };
};

/**
 * Validate a registration payload.
 *
 * Returns { valid, errors, value }. `errors` is keyed by field so the form can
 * put each message next to its own input rather than showing one banner.
 */
export const validateRegistration = (body = {}) => {
  const errors = {};

  const aadhaar = digitsOnly(body.aadhaar_number);
  if (!aadhaar) errors.aadhaar_number = 'Aadhaar number is required.';
  else if (!AADHAAR_RE.test(aadhaar)) errors.aadhaar_number = 'Aadhaar must be exactly 12 digits.';

  const fullName = String(body.full_name ?? '').trim();
  if (!fullName) errors.full_name = 'Patient name is required.';
  else if (fullName.length < 2) errors.full_name = 'Enter the full name.';
  else if (fullName.length > 150) errors.full_name = 'Name is too long.';

  const gender = String(body.gender ?? '').toLowerCase();
  if (!gender) errors.gender = 'Gender is required.';
  else if (!GENDERS.includes(gender)) errors.gender = `Gender must be one of: ${GENDERS.join(', ')}.`;

  const dob = String(body.date_of_birth ?? '').trim();
  if (!dob) {
    errors.date_of_birth = 'Date of birth is required.';
  } else {
    const parsed = new Date(dob);
    if (Number.isNaN(parsed.getTime())) {
      errors.date_of_birth = 'Enter a valid date.';
    } else if (parsed > new Date()) {
      errors.date_of_birth = 'Date of birth cannot be in the future.';
    } else if (ageFromDob(dob) > 120) {
      errors.date_of_birth = 'Date of birth is more than 120 years ago — check the year.';
    }
  }

  const village1 = String(body.village_line1 ?? '').trim();
  if (!village1) errors.village_line1 = 'Village is required.';
  else if (village1.length > 150) errors.village_line1 = 'Line 1 is too long.';

  const village2 = String(body.village_line2 ?? '').trim();
  if (village2.length > 150) errors.village_line2 = 'Line 2 is too long.';

  const district = String(body.address_district ?? '').trim();
  if (!district) errors.address_district = 'District is required.';
  else if (district.length > 100) errors.address_district = 'District name is too long.';

  const stateId = String(body.address_state_id ?? '').trim();
  if (!stateId) errors.address_state_id = 'State is required.';

  const pin = digitsOnly(body.pin_code);
  if (!pin) errors.pin_code = 'PIN code is required.';
  else if (!PIN_RE.test(pin)) errors.pin_code = 'PIN code must be 6 digits and cannot start with 0.';

  const phone = digitsOnly(body.phone);
  if (!phone) errors.phone = 'Phone number is required.';
  else if (!PHONE_RE.test(phone)) errors.phone = 'Enter a 10-digit mobile number starting with 6, 7, 8 or 9.';

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: {
      aadhaar_number: aadhaar,
      full_name: fullName,
      gender,
      date_of_birth: dob,
      village_line1: village1,
      village_line2: village2 || null,
      address_district: district,
      address_state_id: stateId,
      pin_code: pin,
      phone
    }
  };
};
