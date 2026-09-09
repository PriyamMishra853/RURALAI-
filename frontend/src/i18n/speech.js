/**
 * Which voice to use for which language.
 *
 * Separate from `intlTag` in languages.js because the two answer different
 * questions. `intlTag` asks "how does this locale format a number", and its
 * answer is about region. This asks "which installed voice will produce
 * something a speaker of this language can follow", and its answer is about
 * mutual intelligibility.
 *
 * Most of the languages this product offers have no speech voice on any
 * platform. That is not a reason to refuse to read a clinical instruction
 * aloud: a Bhojpuri or Awadhi speaker follows a Hindi voice comfortably, and a
 * Tulu speaker follows Kannada. Falling back to an English voice reading
 * Devanagari — which is what the previous hardcoded map did for everything it
 * did not know — is the one option that helps nobody.
 *
 * Kept in step with backend/src/config/languages.js, whose `speechTag` field
 * holds the same mapping for the server side of read-aloud.
 */

const SPEECH_TAG = {
  en: 'en-IN',
  hi: 'hi-IN',
  bn: 'bn-IN',
  te: 'te-IN',
  mr: 'mr-IN',
  ta: 'ta-IN',
  gu: 'gu-IN',
  ur: 'ur-IN',
  kn: 'kn-IN',
  or: 'or-IN',
  ml: 'ml-IN',
  pa: 'pa-IN',
  as: 'as-IN',
  ne: 'ne-NP',

  // No voice of their own anywhere. Mapped to the nearest language a speaker
  // will actually understand, not to the nearest language code.
  mai: 'hi-IN',
  sa: 'hi-IN',
  doi: 'hi-IN',
  brx: 'hi-IN',
  sat: 'hi-IN',
  bho: 'hi-IN',
  awa: 'hi-IN',
  mag: 'hi-IN',
  raj: 'hi-IN',
  hne: 'hi-IN',
  bgc: 'hi-IN',
  kok: 'mr-IN',
  tcy: 'kn-IN',
  mni: 'bn-IN',
  ks: 'ur-IN',
  sd: 'ur-IN',
  kha: 'en-IN',
  lus: 'en-IN'
};

/** The BCP-47 tag to request a voice with. Defaults to Indian English. */
export const speechTag = (code) => SPEECH_TAG[code] || 'en-IN';

/**
 * True when the language is read by a voice belonging to a different language.
 *
 * Worth surfacing: an assistant should know the Awadhi passage they are about
 * to play to a patient is coming out in a Hindi voice, so they are not
 * surprised by it mid-consultation.
 */
export const usesBorrowedVoice = (code) =>
  Boolean(SPEECH_TAG[code]) && SPEECH_TAG[code].split('-')[0] !== code;
