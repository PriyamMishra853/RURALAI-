import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Volume2, Square, AlertCircle } from 'lucide-react';
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
 * Language follows the patient's recorded preference where a voice exists for
 * it. Hindi voices are common on Android; if none is installed the browser
 * falls back to its default voice rather than failing silently, and the button
 * says so.
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
  const utteranceRef = useRef(null);

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

  const speak = useCallback(() => {
    if (!supported()) {
      setError('This browser cannot read text aloud.');
      return;
    }
    if (!text?.trim()) return;

    window.speechSynthesis.cancel();
    setError(null);

    const tag = LANG_TAG[language] || 'en-IN';
    const utterance = new SpeechSynthesisUtterance(text);
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
  }, [text, language, voices]);

  if (!supported()) return null;

  const hasVoiceForLanguage = voices.some((v) => v.lang?.startsWith((LANG_TAG[language] || 'en-IN').split('-')[0]));

  return (
    <div className={cn('inline-flex flex-col items-start gap-1', className)}>
      <button
        type="button"
        onClick={speaking ? stop : speak}
        disabled={!text?.trim()}
        aria-label={speaking ? 'Stop reading' : `${label} in ${language}`}
        className={cn(
          'inline-flex items-center gap-2 rounded-field font-semibold transition-colors disabled:opacity-40',
          size === 'sm' ? 'px-3 py-1.5 text-[11px]' : 'px-4 py-2.5 text-xs min-h-[2.5rem]',
          speaking
            ? 'bg-tier-emergency text-white hover:opacity-90'
            : 'bg-gov-600 hover:bg-gov-700 dark:bg-gov-500 dark:hover:bg-gov-400 dark:text-gov-950 text-white shadow-sm'
        )}
      >
        {speaking
          ? <><Square className="w-3.5 h-3.5 fill-current" /> Stop</>
          : <><Volume2 className="w-4 h-4" /> {label}</>}
      </button>

      {error && (
        <span className="text-[10px] text-tier-emergency flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {error}
        </span>
      )}

      {/* Said plainly rather than silently reading Hindi text in an English
          voice, which is close to unintelligible. */}
      {!error && !hasVoiceForLanguage && language !== 'English' && (
        <span className="text-[10px] text-ink-subtle">
          No {language} voice installed — will read in the default voice.
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
