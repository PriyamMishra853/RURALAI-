/**
 * What a patient has agreed to (Roadmap v3, Phase 3).
 *
 * Three consents, kept apart, because they are three different questions:
 *
 *   treatment            may we see, assess and treat you here
 *   share_with_facility  may this record leave this clinic
 *   training             may this record be used to improve the models
 *
 * A patient who says yes to being treated has not said yes to the other two,
 * and a system that treats one tick as all three is not recording consent, it
 * is manufacturing it.
 *
 * Pure: no database, no clock of its own.
 */

export const PURPOSES = ['treatment', 'share_with_facility', 'training'];
export const METHODS = ['verbal', 'written', 'thumb_impression'];
export const STATUSES = ['granted', 'withdrawn'];

/**
 * The wording read out to the patient. Stored with each consent, so a later
 * reader knows what was actually agreed to rather than what the current
 * version of the screen happens to say.
 */
export const WORDING_VERSION = 'v1-2026-09';

export const WORDING = {
  treatment: 'We will record your health details to examine and treat you here. A doctor sees them.',
  share_with_facility: 'If you are sent to a hospital or another clinic, we may send your record with you, so they do not have to start again.',
  training: 'We may use your record, with your name and Aadhaar removed, to improve the system for other patients. Saying no changes nothing about your care.'
};

/**
 * Sharing consent expires. A patient agreeing in March that their record may
 * go to a hospital is not agreeing to every disclosure for the rest of their
 * life. Treatment and training consent run until they are withdrawn.
 */
export const EXPIRY_DAYS = { share_with_facility: 180 };

const DAY_MS = 24 * 60 * 60 * 1000;

const trimmed = (value, max) => {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
};

export const isActive = (consent, now = new Date()) => {
  if (!consent || consent.status !== 'granted') return false;
  if (!consent.expires_at) return true;
  return new Date(consent.expires_at).getTime() > now.getTime();
};

export const buildConsent = ({ patientId, districtId, purpose, method, language, note, recordedBy, now = new Date() }) => {
  if (!PURPOSES.includes(purpose)) return { ok: false, status: 400, error: `purpose must be one of: ${PURPOSES.join(', ')}` };
  if (!METHODS.includes(method)) return { ok: false, status: 400, error: `method must be one of: ${METHODS.join(', ')}` };
  const lang = trimmed(language, 12);
  // The language is not cosmetic: consent taken in a language the patient does
  // not speak is not informed consent, and the record has to say which it was.
  if (!lang) return { ok: false, status: 400, error: 'Record the language the consent was explained in.' };
  if (!patientId || !districtId) return { ok: false, status: 400, error: 'A patient and district are required.' };

  const days = EXPIRY_DAYS[purpose];
  return {
    ok: true,
    value: {
      patient_id: patientId,
      district_id: districtId,
      purpose,
      status: 'granted',
      method,
      language: lang,
      wording_version: WORDING_VERSION,
      granted_at: now.toISOString(),
      expires_at: days ? new Date(now.getTime() + days * DAY_MS).toISOString() : null,
      recorded_by: recordedBy || null,
      note: trimmed(note, 500)
    }
  };
};

export const planWithdrawal = ({ consent, reason, withdrawnBy, now = new Date() }) => {
  if (!consent) return { ok: false, status: 404, error: 'No such consent.' };
  if (consent.status === 'withdrawn') return { ok: false, status: 409, error: 'That consent was already withdrawn.' };
  return {
    ok: true,
    patch: {
      status: 'withdrawn',
      withdrawn_at: now.toISOString(),
      withdrawn_reason: trimmed(reason, 200),
      withdrawn_by: withdrawnBy || null
    }
  };
};

/**
 * What is true right now, per purpose — the shape a screen or a gate needs.
 * An expired consent reads as absent, never as granted.
 */
export const consentState = (consents = [], now = new Date()) => {
  const state = {};
  for (const purpose of PURPOSES) {
    const active = consents.find((c) => c.purpose === purpose && isActive(c, now)) || null;
    const withdrawn = consents
      .filter((c) => c.purpose === purpose && c.status === 'withdrawn')
      .sort((a, b) => new Date(b.withdrawn_at) - new Date(a.withdrawn_at))[0] || null;
    const expired = consents.find((c) => c.purpose === purpose && c.status === 'granted' && !isActive(c, now)) || null;
    state[purpose] = {
      granted: Boolean(active),
      since: active?.granted_at || null,
      expires_at: active?.expires_at || null,
      method: active?.method || null,
      language: active?.language || null,
      wording_version: active?.wording_version || null,
      // Why it is not granted, when it is not: never asked, expired, withdrawn.
      reason: active ? null : expired ? 'expired' : withdrawn ? 'withdrawn' : 'never_asked',
      last_change: active?.granted_at || withdrawn?.withdrawn_at || expired?.expires_at || null
    };
  }
  return state;
};

/** The gate a disclosure passes through. Returns null when it may proceed. */
export const refusalForSharing = (consents = [], now = new Date()) => {
  const state = consentState(consents, now)[
    'share_with_facility'];
  if (state.granted) return null;
  const because = {
    never_asked: 'This patient has not been asked whether their record may leave the clinic.',
    expired: 'The patient\'s sharing consent has expired. Ask again before sending the record on.',
    withdrawn: 'The patient withdrew consent for their record to leave the clinic.'
  };
  return because[state.reason] || because.never_asked;
};
