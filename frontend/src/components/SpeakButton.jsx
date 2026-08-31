import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Volume2, Square, AlertCircle, Loader2 } from 'lucide-react';
import api from '../services/api';
import { cn } from './ui';

/**
 * Read an AI assessment aloud — spec §3.6.
 *
 * Uses the browser's own SpeechSynthesis rather than a cloud TTS service, for
 * three reasons that matter at a village sub-centre:
 *   - it works offline, which is exactly when a data link is worst
 *   - it costs nothing per play, so an assistant can replay it freely
 *   - the patient's clinical text never leaves the device to be synthesised
 *
 * Either language, on demand. The assessment is generated in English, so
 * Hindi playback needs the text translated first — a Hindi voice reading
 * English words produces something neither the assistant nor the patient can
 * follow. Each passage is translated once and kept, so replaying costs
 * nothing.
 *
 * Which language to use is not a preference to guess at: the assistant is
 * standing with the patient and knows. The recorded language only decides
 * which button starts selected.
 */

const LANG_TAG = {
  Hindi: 'hi-IN',
  Urdu: 'ur-IN',
  English: 'en-IN',
  Awadhi: 'hi-IN',      // no distinct voice exists; Hindi is the closest match
  Bhojpuri: 'hi-IN',
  Braj: 'hi-IN',
  Bundeli: 'hi-IN'
};

const supported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

export default function SpeakButton({ text, language = 'Hindi', label = 'Read aloud', className, size = 'md' }) {
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState(null);
  const [voices, setVoices] = useState([]);
  const [spokenLang, setSpokenLang] = useState(language === 'English' ? 'English' : 'Hindi');
  const [translating, setTranslating] = useState(false);
  const utteranceRef = useRef(null);
  // Keyed on the passage as well as the language, so a new assessment does not
  // replay the previous case's translation.
  const cacheRef = useRef({ source: null, byLang: {} });

  useEffect(() => {
    if (!supported()) return undefined;

    // Voices load asynchronously on most browsers; the first call often
    // returns an empty list.
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  // Cancel on unmount. Without this, navigating away mid-sentence leaves the
  // browser talking over the next screen.
  useEffect(() => () => {
    if (supported()) window.speechSynthesis.cancel();
  }, []);

  const stop = useCallback(() => {
    if (supported()) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  /** The passage in `target`, reusing anything already translated. */
  const textFor = useCallback(async (target) => {
    const source = String(text || '').trim();
    if (target === 'English') return source;

    if (cacheRef.current.source !== source) cacheRef.current = { source, byLang: {} };
    if (cacheRef.current.byLang[target]) return cacheRef.current.byLang[target];

    setTranslating(true);
    try {
      const res = await api.post('/voice/translate', { text: source, target });
      const out = res.data?.text || source;
      cacheRef.current.byLang[target] = out;
      // The server returns the original with a reason rather than an error, so
      // the button still reads something usable. Say why it stayed English.
      if (res.data?.ok === false && res.data?.reason) setError(res.data.reason);
      return out;
    } catch {
      setError('Could not translate — reading the English text.');
      return source;
    } finally {
      setTranslating(false);
    }
  }, [text]);

  const speak = useCallback(async (target) => {
    if (!supported()) {
      setError('This browser cannot read text aloud.');
      return;
    }
    if (!text?.trim()) return;

    window.speechSynthesis.cancel();
    setError(null);

    const spoken = await textFor(target);
    if (!spoken) return;

    // If translation failed the passage is still English, so read it with an
    // English voice rather than mispronouncing it with a Hindi one.
    const translated = target !== 'English' && spoken !== String(text || '').trim();
    const tag = translated ? (LANG_TAG[target] || 'hi-IN') : 'en-IN';

    const utterance = new SpeechSynthesisUtterance(spoken);
    utterance.lang = tag;
    // Slower than default: this is clinical instruction being read to someone
    // who may be writing it down or repeating it to a patient.
    utterance.rate = 0.92;
    utterance.pitch = 1;

    const match =
      voices.find((v) => v.lang === tag) ||
      voices.find((v) => v.lang?.startsWith(tag.split('-')[0])) ||
      voices.find((v) => v.lang?.startsWith('en'));
    if (match) utterance.voice = match;

    utterance.onend = () => setSpeaking(false);
    utterance.onerror = (e) => {
      // 'interrupted' and 'canceled' are what a deliberate stop looks like;
      // reporting those as failures would be wrong.
      if (e.error !== 'interrupted' && e.error !== 'canceled') {
        setError('Playback failed on this device.');
      }
      setSpeaking(false);
    };

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  }, [text, voices, textFor]);

  if (!supported()) return null;

  const LANGS = [
    { key: 'English', label: 'English' },
    { key: 'Hindi', label: 'हिन्दी' }
  ];
  const hasVoiceFor = (lang) =>
    voices.some((v) => v.lang?.startsWith((LANG_TAG[lang] || 'en-IN').split('-')[0]));

  const press = (lang) => {
    if (speaking && lang === spokenLang) { stop(); return; }
    setSpokenLang(lang);
    speak(lang);
  };

  return (
    <div className={cn('inline-flex flex-col items-start gap-1', className)}>
      {/* Both languages are offered as buttons rather than a toggle plus a
          play control: it is one press either way, and the assistant can see
          which languages exist without opening anything. */}
      <div className="inline-flex flex-wrap items-center gap-2">
        {LANGS.map((l) => {
          const active = speaking && spokenLang === l.key;
          const busy = translating && spokenLang === l.key;
          return (
            <button
              key={l.key}
              type="button"
              onClick={() => press(l.key)}
              disabled={!text?.trim() || (translating && spokenLang !== l.key)}
              aria-label={active ? `Stop reading in ${l.label}` : `${label} in ${l.label}`}
              className={cn(
                'inline-flex items-center gap-2 rounded-field font-semibold transition-colors disabled:opacity-40',
                size === 'sm' ? 'px-3 py-1.5 text-[11px]' : 'px-4 py-2.5 text-xs min-h-[2.5rem]',
                active
                  ? 'bg-tier-emergency text-white hover:opacity-90'
                  : 'bg-gov-600 hover:bg-gov-700 dark:bg-gov-500 dark:hover:bg-gov-400 dark:text-gov-950 text-white shadow-sm'
              )}
            >
              {busy
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Translating…</>
                : active
                  ? <><Square className="w-3.5 h-3.5 fill-current" /> Stop</>
                  : <><Volume2 className="w-4 h-4" /> {l.label}</>}
            </button>
          );
        })}
      </div>

      {error && (
        <span className="text-[10px] text-tier-emergency flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {error}
        </span>
      )}

      {/* Said plainly rather than silently reading Hindi text in an English
          voice, which is close to unintelligible. */}
      {!error && !hasVoiceFor('Hindi') && (
        <span className="text-[10px] text-ink-subtle">
          No Hindi voice installed on this device — Hindi will read in the default voice.
        </span>
      )}
    </div>
  );
}

/**
 * Turn a tier workflow into a sentence sequence worth listening to.
 *
 * Deliberately not the raw JSON or the whole summary: an assistant listening
 * while holding a patient needs the tier, what to do now, and what to watch
 * for — in that order. Medication is read only when it was actually issued.
 */
export function assessmentToSpeech(workflow, assessment) {
  if (!workflow) return '';
  const parts = [];

  const tierWord = { LOW: 'low risk', MEDIUM: 'medium risk', HIGH: 'high risk' }[workflow.tier] || 'assessed';
  parts.push(`This case is ${tierWord}.`);

  if (workflow.headline) parts.push(workflow.headline + '.');

  if (workflow.first_aid?.length) {
    parts.push('First aid steps.');
    workflow.first_aid.forEach((s, i) => parts.push(`Step ${i + 1}. ${String(s).replace(/^Step \d+:\s*/i, '')}`));
  }

  if (workflow.medication?.emitted && workflow.medication.items?.length) {
    parts.push('Medication.');
    workflow.medication.items.forEach((m) => {
      parts.push([m.drug || m.name, m.dose, m.frequency, m.duration].filter(Boolean).join(', ') + '.');
    });
  } else if (workflow.medication?.reason) {
    parts.push(workflow.medication.reason);
  }

  if (workflow.precautions?.items?.length) {
    parts.push('Precautions.');
    workflow.precautions.items.forEach((p) => parts.push(String(p) + '.'));
  }

  if (workflow.tier === 'HIGH' && workflow.referral?.primary) {
    parts.push(`Refer immediately to ${workflow.referral.primary.name}.`);
    parts.push('Call one zero eight for an ambulance. Confirm bed availability by phone before moving the patient.');
  }

  if (workflow.tier === 'MEDIUM' && workflow.consultation) {
    parts.push(`A ${workflow.consultation.speciality} doctor must see this patient on video before treatment.`);
  }

  return parts.join(' ');
}
