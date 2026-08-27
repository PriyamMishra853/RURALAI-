import { groq, groqChat } from '../config/groq.js';
import { GROQ_TEXT_MODEL } from '../config/models.js';

/**
 * AI interpretation of an already-transcribed lab report.
 *
 * ocrService.js transcribes what is printed on the page — test names, values,
 * reference ranges. It does not say what those values mean together. This is
 * the second, separate step: given the transcribed panels, what pattern do the
 * abnormal values suggest.
 *
 * Same safety contract as visionService.js:
 *   - every finding is phrased as an appearance ("consistent with"), never a
 *     diagnosis
 *   - confidence is capped at "moderate" — a lab panel without clinical
 *     correlation cannot support more
 *   - the model reasons ONLY from the values it is given; it must not invent
 *     a test that was not transcribed
 */

const SYSTEM_PROMPT = `You are an AI clinical-interpretation assistant for a rural health centre in India, supporting a trained clinic assistant working under remote doctor supervision.

NON-NEGOTIABLE RULES:
1. You do not replace a qualified doctor and must never state a definitive diagnosis. Every finding is phrased as an appearance the pattern is "consistent with", never as "the patient has X".
2. Reason ONLY from the test values you are given. Never invent a test result, a reference range, or a symptom that was not provided.
3. confidence may never exceed "moderate". A lab panel read without clinical correlation cannot support more.
4. If the values given do not form a recognisable pattern, say so plainly rather than speculating.
5. Never name a medicine, a dose, or a treatment. That is a separate, doctor-reviewed step.
6. Always state what a doctor should confirm before any of this becomes a treatment decision.`;

const SCHEMA = `{
  "interpretation_possible": true,
  "overall_impression": "One or two sentences summarising the pattern across all abnormal values, or stating that no clear pattern is present",
  "possible_conditions": [
    {
      "description": "Cautious description of what the pattern is CONSISTENT WITH, e.g. 'consistent with iron-deficiency anaemia'",
      "confidence": "low" | "moderate",
      "supporting_values": ["Which transcribed test/value supports this"],
      "doctor_should_confirm": "What clinical correlation or further test the doctor should check"
    }
  ],
  "urgency_flags": ["Any single value severe enough to need same-day doctor attention, with the value quoted"],
  "recommended_next_step": "PROTOCOL_CARE_DOCTOR_OPTIONAL" | "DOCTOR_REVIEW" | "URGENT_DOCTOR_REVIEW"
}`;

/**
 * @param {object} labData - the `extracted_data` object from processMedicalDocument
 *                           for a lab_report document (panels, abnormal_findings).
 * @param {{age?: number, gender?: string, chief_complaint?: string}} [patientContext]
 */
export const interpretLabReport = async (labData, patientContext = {}) => {
  const panels = Array.isArray(labData?.panels) ? labData.panels : [];
  const abnormal = Array.isArray(labData?.abnormal_findings) ? labData.abnormal_findings : [];
  const totalTests = panels.reduce((n, p) => n + (p.tests?.length || 0), 0);

  if (!totalTests) {
    return unavailable('No test values were transcribed from this report, so there is nothing to interpret.');
  }
  if (!groq) {
    return unavailable('No LLM provider is configured for interpretation.');
  }

  const valuesText = panels
    .map((p) => `${p.panel_name}:\n` + (p.tests || [])
      .map((t) => `  - ${t.name}: ${t.value} ${t.unit} (reference: ${t.reference_range}, flag: ${t.flag})`)
      .join('\n'))
    .join('\n\n');

  const userPrompt = `PATIENT CONTEXT:
- Age: ${patientContext.age ?? 'Not recorded'} | Gender: ${patientContext.gender ?? 'Not recorded'}
- Presenting complaint: ${patientContext.chief_complaint || 'Not recorded'}

TRANSCRIBED TEST VALUES:
${valuesText}

ABNORMAL FINDINGS ALREADY FLAGGED:
${abnormal.length ? abnormal.join('\n') : 'None flagged'}

Interpret this pattern cautiously and return the JSON described in the schema.`;

  try {
    const completion = await groqChat({
      model: GROQ_TEXT_MODEL,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `${SYSTEM_PROMPT}\nReturn strictly a JSON object with this schema:\n${SCHEMA}` },
        { role: 'user', content: userPrompt }
      ]
    });

    const parsed = JSON.parse(completion.choices[0].message.content);
    if (!parsed || !parsed.overall_impression) {
      return unavailable('The interpretation model returned an unusable response.');
    }

    return {
      interpretation_possible: parsed.interpretation_possible !== false,
      overall_impression: parsed.overall_impression,
      possible_conditions: (Array.isArray(parsed.possible_conditions) ? parsed.possible_conditions : [])
        .slice(0, 4)
        .map((c) => ({
          description: c.description || 'Non-specific pattern',
          confidence: c.confidence === 'moderate' ? 'moderate' : 'low',
          supporting_values: Array.isArray(c.supporting_values) ? c.supporting_values : [],
          doctor_should_confirm: c.doctor_should_confirm || ''
        })),
      urgency_flags: Array.isArray(parsed.urgency_flags) ? parsed.urgency_flags : [],
      recommended_next_step: ['PROTOCOL_CARE_DOCTOR_OPTIONAL', 'DOCTOR_REVIEW', 'URGENT_DOCTOR_REVIEW']
        .includes(parsed.recommended_next_step) ? parsed.recommended_next_step : 'DOCTOR_REVIEW',
      engine: GROQ_TEXT_MODEL
    };
  } catch (err) {
    console.warn('Lab interpretation failed:', err.message);
    return unavailable(`Interpretation failed (${err.message}).`);
  }
};

function unavailable(reason) {
  return {
    interpretation_possible: false,
    overall_impression: `${reason} This report has been saved for direct doctor review — no automated interpretation was generated.`,
    possible_conditions: [],
    urgency_flags: [],
    recommended_next_step: 'DOCTOR_REVIEW',
    engine: 'none'
  };
}
