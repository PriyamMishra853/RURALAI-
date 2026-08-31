import { groq, groqChat, groqTranscribe } from '../config/groq.js';
import { GROQ_SPEECH_MODEL, GROQ_TEXT_MODEL } from '../config/models.js';

/**
 * Speech-to-text with automatic language detection
 * (Hindi, Tamil, Telugu, Marathi, Bengali, Gujarati, English).
 *
 * ── WHY THIS FILE IS DEFENSIVE ────────────────────────────────────────────
 * The previous implementation fabricated clinical data in three places, and
 * every one of them fed the triage engine:
 *
 *   1. When transcription produced nothing, it substituted a fixed Hindi
 *      sentence — "patient has high fever, dry cough and body pain for 3
 *      days" — and returned it as the patient's own words.
 *   2. `extracted_symptoms` defaulted to fever + cough + body pain, so a
 *      failed extraction attached three symptoms nobody reported.
 *   3. The outer catch returned those same invented symptoms on any error.
 *
 * "fever" plus "cough" is a MEDIUM-tier rule in riskEngine.js, so a silent or
 * failed recording could produce a triaged case describing a patient who does
 * not exist. Invented symptoms are worse than no symptoms, because the doctor
 * cannot tell them apart from real ones.
 *
 * Nothing in this file invents content. When speech cannot be transcribed it
 * says so, and the caller must handle that rather than receive a plausible
 * substitute.
 * ──────────────────────────────────────────────────────────────────────────
 */

/**
 * Whisper emits training-data artifacts when given silence or noise — channel
 * sign-offs, URLs, subtitle credits. These are not transcriptions of anything,
 * and in a symptom field they are fabricated clinical input.
 */
const HALLUCINATION_PATTERNS = [
  /^\s*www\.[^\s]+\s*$/i,
  /^\s*https?:\/\/[^\s]+\s*$/i,
  /^\s*thank(s| you)[.!]?\s*$/i,
  /thank(s| you) for watching/i,
  /please subscribe/i,
  /subtitles? by/i,
  /amara\.org/i,
  /^\s*[.।\-–—…]*\s*$/
];

/**
 * True when the transcript is a known artifact rather than speech.
 * Whole-transcript matches only, so a real utterance that happens to contain
 * one of these phrases is not discarded.
 *
 * Exported for testing.
 */
export const looksHallucinated = (text) => {
  const trimmed = (text || '').trim();
  if (!trimmed) return true;
  return HALLUCINATION_PATTERNS.some((p) => p.test(trimmed));
};

/**
 * Detect Whisper's padding hallucination.
 *
 * `no_speech_prob` is not usable for this: on one second of pure digital
 * silence Whisper returned "Thank you." with `no_speech_prob: 0` — fully
 * confident in speech that does not exist.
 *
 * The reliable signal is structural. Whisper pads short audio to a 30-second
 * window, and when it hallucinates it labels the whole padded window rather
 * than the real audio. A segment ending far beyond the reported duration is
 * that artifact. Genuine one-second speech produces a segment ending at about
 * one second, so this does not reject real short utterances.
 *
 * Exported for testing.
 */
export const isPaddingArtifact = (transcription) => {
  const duration = transcription?.duration;
  const segments = transcription?.segments;
  if (!duration || !Array.isArray(segments) || segments.length === 0) return false;
  return segments.some((s) => (s.end ?? 0) > duration + 5);
};

/** Every segment confident there is no speech. Cheap, and sometimes correct. */
const isSilence = (transcription) => {
  const segments = transcription?.segments;
  if (!Array.isArray(segments) || segments.length === 0) return false;
  return segments.every((s) => (s.no_speech_prob ?? 0) > 0.6);
};

const LANGUAGE_NAMES = {
  hi: 'Hindi (हिंदी)',
  en: 'English',
  ta: 'Tamil (தமிழ்)',
  te: 'Telugu (తెలుగు)',
  mr: 'Marathi (मराठी)',
  bn: 'Bengali (বাংলা)',
  gu: 'Gujarati (ગુજરાતી)'
};

const noSpeechResult = (reason) => ({
  ok: false,
  reason,
  detected_language: null,
  transcript: '',
  extracted_symptoms: [],
  warnings: [reason]
});

/**
 * @returns {Promise<{
 *   ok: boolean, reason?: string, detected_language: string|null,
 *   transcript: string, extracted_symptoms: object[], warnings: string[]
 * }>}
 *   `ok: false` means nothing usable was captured. `transcript` is then empty
 *   and `extracted_symptoms` is empty — never a substitute.
 */
export const transcribeAndExtractSymptoms = async (audioBuffer, requestedLanguage = 'AUTO') => {
  if (!audioBuffer || audioBuffer.length === 0) {
    return noSpeechResult('No audio was received.');
  }
  if (!groq) {
    return noSpeechResult('Speech transcription is unavailable — no provider is configured.');
  }

  const warnings = [];
  let transcriptText = '';
  let detectedLang = null;

  // ---- 1. Transcribe ----
  try {
    const fileObj = new File([audioBuffer], 'speech.webm', { type: 'audio/webm' });
    const transcription = await groqTranscribe({
      file: fileObj,
      model: GROQ_SPEECH_MODEL,
      // No leading prompt naming symptoms or languages: priming Whisper with
      // clinical vocabulary makes it more likely to emit that vocabulary from
      // unclear audio, which is the failure mode this file exists to prevent.
      response_format: 'verbose_json',
      ...(requestedLanguage && requestedLanguage !== 'AUTO' && requestedLanguage.length === 2
        ? { language: requestedLanguage }
        : {})
    });

    if (isSilence(transcription) || isPaddingArtifact(transcription)) {
      return noSpeechResult('No speech detected in the recording. Ask the patient to speak again.');
    }

    transcriptText = (transcription.text || '').trim();
    detectedLang = LANGUAGE_NAMES[transcription.language] || transcription.language || null;
  } catch (sttErr) {
    console.warn('Groq Whisper STT failed:', sttErr.message);
    return noSpeechResult(`Speech transcription failed: ${sttErr.message}`);
  }

  if (looksHallucinated(transcriptText)) {
    return noSpeechResult(
      'No intelligible speech detected. The recording produced only background artefacts.'
    );
  }

  // ---- 2. Structure the transcript ----
  // The transcript is authoritative. This step only extracts structure from
  // words that were actually said; it may never add a symptom.
  let extractedSymptoms = [];
  try {
    const response = await groqChat({
      model: GROQ_TEXT_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You convert a transcribed patient voice note into structured JSON.

RULES:
- Extract ONLY symptoms explicitly stated in the transcript.
- Never infer, add, or complete a symptom that was not said.
- If the transcript mentions no symptom, return an empty array. An empty array is a correct answer.
- Omit a field rather than guessing its value.

Return strictly:
{
  "detected_language": "language name",
  "extracted_symptoms": [
    { "symptom": "...", "duration": "...", "severity": "mild" | "moderate" | "severe", "location": "..." }
  ]
}`
        },
        { role: 'user', content: `Transcript:\n${transcriptText}` }
      ]
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    if (Array.isArray(parsed?.extracted_symptoms)) {
      extractedSymptoms = parsed.extracted_symptoms;
    }
    if (parsed?.detected_language && !detectedLang) detectedLang = parsed.detected_language;
  } catch (err) {
    console.warn('Symptom structuring failed:', err.message);
    warnings.push(
      'The transcript was captured but could not be structured automatically. Enter the symptoms manually.'
    );
  }

  return {
    ok: true,
    detected_language: detectedLang,
    transcript: transcriptText,
    extracted_symptoms: extractedSymptoms,
    warnings
  };
};

/**
 * Translate assessment text for the read-aloud control.
 *
 * Scoped deliberately narrowly. This exists so a health worker can play the
 * assessment back to a patient in Hindi, and the text it receives is text the
 * system generated — a summary, first-aid steps, precautions. It is not a
 * general translation service and must never invent clinical content: the
 * prompt forbids adding, removing or "improving" anything, because a
 * translation that helpfully adds a dose is a fabricated instruction that
 * nobody proofread.
 *
 * Returns the original text on failure rather than an error. The read-aloud
 * button should still read something the assistant can use.
 */
export const translateForSpeech = async (text, target = 'Hindi') => {
  const source = String(text || '').trim();
  if (!source) return { ok: false, text: '', reason: 'Nothing to translate.' };
  if (source.length > 6000) {
    return { ok: false, text: source, reason: 'That passage is too long to translate.' };
  }

  const LANGS = { Hindi: 'Hindi (Devanagari script)', English: 'English' };
  const targetName = LANGS[target];
  if (!targetName) return { ok: false, text: source, reason: `Unsupported language: ${target}` };

  try {
    const completion = await groqChat({
      model: GROQ_TEXT_MODEL,
      temperature: 0,
      max_tokens: 2000,
      messages: [
        {
          role: 'system',
          content: `You translate clinical guidance for a rural health worker in India into ${targetName}.

RULES:
- Translate faithfully. Do NOT add, remove, summarise or improve anything.
- Never introduce a medicine, a dose, a diagnosis or advice that is not in the source. The source has been through clinical safety checks; anything you add has not.
- Keep numbers, units, times and measurements exactly as written.
- Keep an English clinical term in English if there is no everyday equivalent a patient would recognise.
- Use simple everyday language a patient can follow, not formal or literary register.
- Reply with the translation only. No preamble, no notes, no quotes.`
        },
        { role: 'user', content: source }
      ]
    });

    const out = completion?.choices?.[0]?.message?.content?.trim();
    if (!out) return { ok: false, text: source, reason: 'The translation came back empty.' };
    return { ok: true, text: out, target };
  } catch (err) {
    console.warn('translation failed:', err.message);
    return { ok: false, text: source, reason: 'Translation is unavailable right now.' };
  }
};
