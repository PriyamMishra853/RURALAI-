import { groqChat, groqAvailable } from '../config/groq.js';
import { GROQ_TEXT_MODEL } from '../config/models.js';
import { reconcileWithForm } from '../services/intakeExtractionRules.js';

/**
 * CHATBOX voice intake: turning what was said into a form proposal.
 *
 * Roadmap v3, F2. The assistant speaks, the existing speech service returns a
 * transcript, and this turns that transcript into fields the assistant can
 * accept or correct in the manual form. intakeExtractionRules.js decides what
 * is allowed through; this file only asks the model and hands the answer over.
 *
 * ── Stateless on purpose ───────────────────────────────────────────────────
 *
 * Nothing here writes to the database. No transcript is stored, no draft is
 * persisted, no audio is kept. Storing any of that means consent capture, a
 * retention policy and a migration — real work that F2 specifies and that has
 * not been done, and a half-built version of it would be a recording nobody
 * agreed to. Until then the proposal lives in the assistant's browser until
 * they submit the form, which is the path of record either way.
 *
 * ── Failure returns people to the form ─────────────────────────────────────
 *
 * A provider error, an unparseable answer or a missing key is answered with
 * 200 and ok:false, never a 500 and never a spinner. The assistant is standing
 * in front of a patient: the only acceptable failure is one that hands them
 * back the form they could already have been typing into. This matches what
 * the speech endpoint beside it already does.
 */

const MAX_TRANSCRIPT = 4000;

/**
 * The model is told the field names and told, twice, that omitting a field is
 * correct. The rules module enforces this anyway — anything invented is
 * dropped there — but a prompt that invites a guess wastes a round trip
 * producing values that will be thrown away.
 */
const SYSTEM_PROMPT = `You convert what a clinic assistant said out loud into fields of an intake form in an Indian rural clinic. The speech may mix English with Hindi or Marathi.

Return ONLY a JSON object with any of these keys:
  chief_complaint       what the patient came with, in the speaker's words
  symptoms              other symptoms mentioned
  symptom_duration      how long, exactly as said, e.g. "three days"
  medical_history       known conditions
  known_allergies       allergies
  current_medications   medicines the patient is taking now
  is_pregnant           true or false, ONLY if pregnancy was actually mentioned
  blood_pressure        as said, e.g. "140/90" or "one forty by ninety"
  temperature_f         Fahrenheit
  pulse_bpm             beats per minute
  spo2_percent          oxygen saturation
  respiratory_rate      breaths per minute
  blood_glucose_mgdl    mg/dL

RULES:
- Include a key ONLY if the speaker actually said it. Omitting a key is correct and expected.
- Never guess, never infer, never fill a field from context. An absent field is fine; an invented one is a fabricated clinical observation.
- Never convert between units. Report the number as it was said.
- Never add a diagnosis, a risk level, a medicine or advice. You are transcribing into fields, not practising medicine.
- If the speech is unclear or you heard nothing usable, return {}.`;

const failed = (reason) => ({
  ok: false,
  reason,
  fallback: 'manual',
  accept: {},
  skipped: [],
  questions: [],
  dropped: []
});

/**
 * POST /api/ai/intake-extract
 *   { transcript, typed?: { ...fields, vitals: {...} } }
 *
 * `typed` is whatever the assistant has already entered. It is sent so the
 * rules module can refuse to overwrite it, and it is never stored.
 */
export const extractIntake = async (req, res) => {
  const transcript = String(req.body?.transcript || '').trim();

  if (!transcript) {
    return res.status(400).json({ error: 'There is nothing to read yet. Speak, then try again.' });
  }
  if (transcript.length > MAX_TRANSCRIPT) {
    return res.status(400).json({ error: 'That is too long to read in one go. Say it in shorter pieces.' });
  }
  if (!groqAvailable()) {
    return res.json(failed('The reader is not configured on this deployment.'));
  }

  let parsed;
  try {
    const completion = await groqChat({
      model: GROQ_TEXT_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: transcript }
      ]
    });

    const content = completion?.choices?.[0]?.message?.content;
    if (!content) return res.json(failed('The reader returned nothing.'));
    parsed = JSON.parse(content);
  } catch (err) {
    // Includes a malformed answer: JSON.parse throwing is a provider problem
    // from the assistant's point of view, and the answer is the same either
    // way — go back to the form.
    console.warn('intake extraction failed:', err.message);
    return res.json(failed('The reader could not be reached. Type the details instead.'));
  }

  const { accept, skipped, questions, dropped, vitalErrors } = reconcileWithForm({
    typed: req.body?.typed || {},
    extracted: parsed
  });

  return res.json({
    ok: true,
    accept,
    skipped,
    questions,
    dropped,
    vital_errors: vitalErrors,
    model: GROQ_TEXT_MODEL,
    // Said plainly in the payload, because a client that forgets it would be
    // putting unconfirmed values into a clinical record.
    note: 'Every value is a proposal. Nothing is recorded until the assistant confirms it in the form.'
  });
};
