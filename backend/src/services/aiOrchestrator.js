import { groq, groqChat } from '../config/groq.js';
import { getDiseaseCandidates } from './aiInferenceClient.js';
import { GROQ_TEXT_MODEL } from '../config/models.js';
import { retrieveClinicalProtocols } from './ragEngine.js';
import { calculateRiskLevel } from './riskEngine.js';
import { assertRuleSourced, formatMedicationLine, selectMedications } from './formularyService.js';

/**
 * Full AI Patient Assessment Pipeline:
 * Patient context + verified OCR documents + wound-photo vision observations
 *   -> Protocol retrieval (RAG) -> Groq LLM synthesis -> Rule-engine risk override
 *
 * Every case is triaged HIGH / MEDIUM / LOW. The deterministic rule engine
 * always overrides the LLM's risk output, and vision severity can only raise
 * (never lower) the final level.
 */

const SYSTEM_PROMPT = `You are an AI clinical-assistance system for rural village health centres in India, supporting trained clinic assistants who work under remote doctor supervision.

NON-NEGOTIABLE SAFETY & LEGAL RULES:
1. You do not replace a qualified doctor and must never state a definitive diagnosis.
2. Never fabricate patient information, findings, sources, or protocols. If information is missing, list it under missing_information.
3. First-aid steps must be simple, numbered, specific actions a trained assistant can perform (positioning, wound cleaning, dressing, cold sponging, encouraging fluids, monitoring intervals) — never naming a medicine.
4. NEVER name a medicine, a dose, a frequency or a duration. Not even an over-the-counter one, and not even when the retrieved protocol mentions it. Medication is selected by a separate rules engine from a formulary signed by a registered practitioner; anything you write about medicine is discarded. Omit the topic entirely.
5. NEVER suggest antibiotics, steroids, opioids, or any prescription-only (Schedule H/H1/X) drug. Starting those without a registered doctor's prescription is illegal in India.
6. Base protocol guidance only on the retrieved approved protocols provided to you.
7. Clearly separate: patient observations, AI assistance, and decisions reserved for the doctor.`;

const RISK_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2 };

export const runFullPatientAssessment = async (patientContext) => {
  const {
    patient = {},
    visit = {},
    vitals = {},
    verifiedDocuments = [],
    imageObservations = []
  } = patientContext;

  // ---- Merge OCR document data ----
  const ocrMedications = verifiedDocuments.flatMap((d) => d.medications || []);
  const ocrHistoryConditions = verifiedDocuments.flatMap((d) => d.medical_history_conditions || []);
  const ocrAllergies = verifiedDocuments.flatMap((d) => d.allergies_noted || []);
  const ocrDiagnosisNotes = verifiedDocuments.map((d) => d.diagnosis_notes).filter(Boolean);

  const combinedSymptoms = [visit.chief_complaint, visit.symptoms].filter(Boolean).join('. ');
  const combinedHistory = [visit.medical_history, ...ocrHistoryConditions, ...ocrDiagnosisNotes].filter(Boolean).join(', ');
  const combinedAllergies = [visit.allergies, ...ocrAllergies].filter(Boolean).join(', ');

  // ---- 1. Deterministic risk triage (HIGH / MEDIUM / LOW) ----
  // The rule tier is a floor. Every source below may raise it and none may
  // lower it — final_tier = MAX(rule_tier, vision_tier, model_tier).
  const riskResult = calculateRiskLevel(vitals, combinedSymptoms, combinedHistory, patient);
  const ruleTier = riskResult.riskLevel;
  let finalRiskLevel = ruleTier;
  const riskWarnings = [...riskResult.warnings];

  // Vision severity can raise (never lower) the triage level
  for (const obs of imageObservations) {
    const sev = obs.severity_impression;
    if (sev && RISK_RANK[sev] > RISK_RANK[finalRiskLevel]) {
      finalRiskLevel = sev;
      riskWarnings.push(`Wound photograph observation raised triage to ${sev}: ${obs.cautious_summary || 'visible concerning features'}`);
    }
  }

  // ---- 1b. Statistical disease candidates (pipeline 1) ----
  //
  // A ranked candidate list from the Bernoulli NB model trained on 244,938
  // labelled symptom vectors. It is given to the LLM as evidence to reason
  // over, NOT as an answer: the model may re-rank and reject candidates, but
  // it may not introduce a disease outside this list. That bound is what keeps
  // the final output traceable back to the training data instead of to the
  // language model's imagination.
  //
  // Unavailable service => empty list => the prompt simply says so. It must
  // never be confused with "no disease found".
  let diseaseCandidates = null;
  try {
    diseaseCandidates = await getDiseaseCandidates({
      text: combinedSymptoms,
      topK: 5
    });
  } catch (err) {
    console.warn('Disease candidate lookup failed:', err.message);
  }

  const candidateBlock = diseaseCandidates?.ok
    ? diseaseCandidates.candidates
        .map((c) => `- ${c.disease} (model confidence ${(c.confidence * 100).toFixed(1)}%)`)
        .join(String.fromCharCode(10))
    : null;

  // ---- 2. Retrieve approved clinical protocols ----
  const retrievedProtocols = await retrieveClinicalProtocols(
    `${combinedSymptoms} ${ocrDiagnosisNotes.join(' ')} ${imageObservations.map((o) => o.cautious_summary || '').join(' ')}`,
    3
  );

  // ---- 3. Build the LLM prompt ----
  const userPrompt = `
PATIENT DEMOGRAPHICS:
- Name: ${patient.name || 'Not recorded'} | Age: ${patient.age ?? 'Not recorded'} | Gender: ${patient.gender || 'Not recorded'}
- Village: ${patient.village || 'Not recorded'} | Preferred language: ${patient.preferred_language || 'Hindi'}

STATISTICAL DISEASE CANDIDATES (Bernoulli NB over 244,938 labelled symptom vectors):
${candidateBlock || '- None. The recorded symptoms did not match the clinical vocabulary, or the model was unavailable. Do NOT treat this as evidence of good health.'}
${diseaseCandidates?.matched_symptoms?.length
  ? `Symptoms the model recognised: ${diseaseCandidates.matched_symptoms.map((m) => m.symptom).join(', ')}`
  : ''}

PRESENTING SYMPTOMS (reported by clinic assistant):
- Chief complaint: ${combinedSymptoms || 'Not recorded'}
- Symptom duration: ${visit.symptom_duration || 'Not recorded'}
- Known medical history: ${combinedHistory || 'None reported'}
- Known allergies: ${combinedAllergies || 'None reported'}
- Current medications: ${visit.current_medications || 'None reported'}

RECORDED VITALS:
- Temperature: ${vitals.temperature ? `${vitals.temperature} °F` : 'Not recorded'}
- Blood pressure: ${vitals.blood_pressure_systolic ? `${vitals.blood_pressure_systolic}/${vitals.blood_pressure_diastolic || '?'} mmHg` : 'Not recorded'}
- Pulse: ${vitals.pulse ? `${vitals.pulse} bpm` : 'Not recorded'}
- SpO2: ${vitals.spo2 ? `${vitals.spo2}%` : 'Not recorded'}
- Respiratory rate: ${vitals.respiratory_rate ? `${vitals.respiratory_rate}/min` : 'Not recorded'}

VERIFIED OCR DOCUMENT DATA (${verifiedDocuments.length} document(s), human-verified):
- Medications on record: ${JSON.stringify(ocrMedications)}
- Diagnosis notes from documents: ${JSON.stringify(ocrDiagnosisNotes)}

WOUND / INJURY PHOTO OBSERVATIONS (${imageObservations.length} photo(s), computer vision, non-diagnostic):
${imageObservations.length === 0 ? '- None uploaded' : imageObservations.map((o, i) => `- Photo ${i + 1} [severity impression: ${o.severity_impression || 'N/A'}]: ${o.cautious_summary || 'No summary'} | Features: ${(o.observable_features || []).join('; ')}`).join('\n')}

RETRIEVED APPROVED CLINICAL PROTOCOLS (MoHFW):
${retrievedProtocols.map((p) => `- ${p.title} (v${p.version}, ${p.source}):\n  ${p.content}\n  Steps: ${(p.steps || []).join(' -> ')}`).join('\n') || '- None retrieved'}

RULE-ENGINE TRIAGE (already final — do not change it):
- Risk level: ${finalRiskLevel}
- Reasoning: ${riskResult.riskReasoning}
- Warnings: ${JSON.stringify(riskWarnings)}

TASK: Produce the doctor-ready clinical handoff. Return strictly a valid JSON object:
{
  "patient_summary": "Structured narrative combining symptoms, vitals, OCR history and photo observations",
  "key_symptoms": ["..."],
  "duration": "symptom duration",
  "important_history": ["history item incl. OCR findings"],
  "missing_information": ["information not recorded"],
  "observations": ["non-diagnostic clinical observation"],
  "risk_level": "${finalRiskLevel}",
  "first_aid_steps": ["Step 1: <specific action>", "Step 2: ..."],
  "protocol_matches": [{ "title": "...", "source": "...", "version": "...", "guidance": "..." }],
  "warnings": ["warning sign the assistant must watch for"],
  "recommended_next_action": "${finalRiskLevel === 'HIGH' ? (riskResult.immediateReferral ? 'EMERGENCY_HOSPITAL_REFERRAL' : 'URGENT_DOCTOR_REVIEW') : finalRiskLevel === 'MEDIUM' ? 'DOCTOR_REVIEW' : 'PROTOCOL_CARE_DOCTOR_OPTIONAL'}",
  "requires_doctor": ${riskResult.requiresDoctor || finalRiskLevel !== 'LOW'}
}`;

  // ---- 4. Deterministic fallback assessment (used when the LLM is down) ----
  const protocolFirstAid = retrievedProtocols[0]?.steps?.length
    ? retrievedProtocols[0].steps.map((s, i) => `Step ${i + 1}: ${s}`)
    : [
        'Step 1: Seat the patient comfortably in a ventilated area and reassure them.',
        'Step 2: Re-check and record temperature, pulse, blood pressure and SpO2.',
        'Step 3: Offer sips of clean drinking water and keep the patient hydrated. Any medicine comes from the medication section below, not from these steps.',
        'Step 4: Re-check vital signs every 2 hours and record any change.',
        'Step 5: Escalate to the doctor immediately if breathing difficulty, chest pain, or drowsiness develops.'
      ];

  let finalAssessment = {
    patient_summary: `${patient.name || 'Patient'} presents with ${combinedSymptoms || 'reported symptoms'} (duration: ${visit.symptom_duration || 'not recorded'}). Vitals — Temp: ${vitals.temperature || 'N/R'}°F, BP: ${vitals.blood_pressure_systolic || 'N/R'}/${vitals.blood_pressure_diastolic || 'N/R'} mmHg, SpO2: ${vitals.spo2 || 'N/R'}%, Pulse: ${vitals.pulse || 'N/R'} bpm. ${ocrMedications.length > 0 ? `Verified documents list ${ocrMedications.length} prior medication(s).` : 'No prior prescription documents on record.'} ${imageObservations.length > 0 ? `${imageObservations.length} wound photograph(s) attached with computer-vision observations.` : ''}`,
    key_symptoms: combinedSymptoms ? combinedSymptoms.split(/[,.]/).map((s) => s.trim()).filter(Boolean).slice(0, 6) : [],
    duration: visit.symptom_duration || 'Not recorded',
    important_history: combinedHistory ? [combinedHistory] : ['No chronic conditions reported'],
    missing_information: [
      ...(vitals.spo2 ? [] : ['SpO2 not recorded']),
      ...(vitals.temperature ? [] : ['Temperature not recorded']),
      ...(vitals.blood_pressure_systolic ? [] : ['Blood pressure not recorded'])
    ],
    observations: [
      'Assessment generated from recorded vitals, verified documents and photo observations.',
      ...imageObservations.map((o) => o.cautious_summary).filter(Boolean)
    ],
    risk_level: finalRiskLevel,
    first_aid_steps: protocolFirstAid,
    protocol_matches: retrievedProtocols.map((p) => ({
      title: p.title,
      source: p.source,
      version: p.version,
      guidance: p.content
    })),
    warnings: Array.from(new Set(riskWarnings)),
    recommended_next_action: finalRiskLevel === 'HIGH' ? (riskResult.immediateReferral ? 'EMERGENCY_HOSPITAL_REFERRAL' : 'URGENT_DOCTOR_REVIEW') : finalRiskLevel === 'MEDIUM' ? 'DOCTOR_REVIEW' : 'PROTOCOL_CARE_DOCTOR_OPTIONAL',
    requires_doctor: riskResult.requiresDoctor || finalRiskLevel !== 'LOW',
    generated_by: 'rule-engine-fallback'
  };

  // ---- 5. Groq LLM synthesis ----
  //
  // Degraded AI fails safe to MEDIUM, never LOW. A missing key, a timeout, a
  // malformed response — all of them mean the case was never actually
  // assessed by the model, and an unassessed case must reach a doctor. The
  // previous behaviour kept whatever the rules produced, so an outage during
  // the demo would have silently returned LOW cases with no model input.
  let degradedReason = null;

  if (!groq) {
    degradedReason = 'No LLM provider is configured';
  } else {
    try {
      const chatCompletion = await groqChat({
        model: GROQ_TEXT_MODEL,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ]
      });

      const parsed = JSON.parse(chatCompletion.choices[0].message.content);
      if (parsed && parsed.patient_summary) {
        // The model may raise the tier and can never lower it.
        const modelTier = RISK_RANK[parsed.risk_level] !== undefined ? parsed.risk_level : null;
        if (modelTier && RISK_RANK[modelTier] > RISK_RANK[finalRiskLevel]) {
          riskWarnings.push(`Model assessment raised triage from ${finalRiskLevel} to ${modelTier}.`);
          finalRiskLevel = modelTier;
        }

        finalAssessment = {
          ...finalAssessment,
          ...parsed,
          risk_level: finalRiskLevel,
          warnings: Array.from(new Set([...(parsed.warnings || []), ...riskWarnings])),
          generated_by: `groq:${GROQ_TEXT_MODEL}`
        };
      } else {
        degradedReason = 'LLM response did not match the required schema';
      }
    } catch (llmErr) {
      degradedReason = `LLM assessment failed (${llmErr.message})`;
      console.warn('Groq LLM assessment failed, using rule-engine assessment:', llmErr.message);
    }
  }

  if (degradedReason && finalRiskLevel === 'LOW') {
    finalRiskLevel = 'MEDIUM';
    riskWarnings.push(
      `${degradedReason} — triage floored at MEDIUM for doctor review. This case was not assessed by the model.`
    );
  }

  // ---- 6. Re-derive everything that depends on the final tier ----
  // finalRiskLevel may have moved since the fallback object was built, so these
  // must be recomputed rather than left at their earlier values.
  finalAssessment.risk_level = finalRiskLevel;
  finalAssessment.warnings = Array.from(new Set([...(finalAssessment.warnings || []), ...riskWarnings]));
  finalAssessment.requires_doctor = riskResult.requiresDoctor || finalRiskLevel !== 'LOW';
  // Statistical evidence, kept SEPARATE from the model's prose.
  //
  // The system prompt forbids stating a definitive diagnosis, so the LLM uses
  // these candidates to reason but never names them in the summary — which is
  // correct, and also means a doctor could not see what the trained model
  // actually contributed. Attaching them here preserves the product's core
  // separation: this block is AI assistance, clearly labelled, and the doctor
  // still makes the decision.
  finalAssessment.disease_candidates = diseaseCandidates?.ok
    ? {
        source: 'bernoulli_nb over 244,938 labelled symptom vectors',
        top5_accuracy: diseaseCandidates.model_top5_accuracy,
        recognised_symptoms: (diseaseCandidates.matched_symptoms || []).map((m) => m.symptom),
        candidates: diseaseCandidates.candidates,
        note: 'Ranked candidates from a statistical model. Not a diagnosis.'
      }
    : {
        source: 'unavailable',
        candidates: [],
        note: diseaseCandidates?.reason
          || 'The disease model was unreachable. Absence of candidates is not evidence of good health.'
      };

  finalAssessment.recommended_next_action =
    finalRiskLevel === 'HIGH'
      ? riskResult.immediateReferral
        ? 'EMERGENCY_HOSPITAL_REFERRAL'
        : 'URGENT_DOCTOR_REVIEW'
      : finalRiskLevel === 'MEDIUM'
        ? 'DOCTOR_REVIEW'
        : 'PROTOCOL_CARE_DOCTOR_OPTIONAL';

  // ---- 7. Medication: formulary only, never the model ----
  //
  // Whatever the model returned on this subject is discarded rather than
  // merged. A model that ignores its instructions must not be able to reach a
  // health worker with a dose, so the field is overwritten unconditionally.
  delete finalAssessment.supportive_medication_guidance;

  const formulary = selectMedications({
    tier: finalRiskLevel,
    patient,
    symptoms: combinedSymptoms,
    history: combinedHistory,
    allergies: combinedAllergies
  });
  assertRuleSourced(formulary.medications);

  finalAssessment.medications = formulary.medications;
  finalAssessment.supportive_medication_guidance = formulary.medications.map(formatMedicationLine);
  finalAssessment.medication_suppressed = formulary.suppressed;
  finalAssessment.medication_notices = formulary.notices;
  finalAssessment.medication_source = 'formulary-rules-engine';

  // ---- 8. Attach immutable safety metadata ----
  finalAssessment.rule_tier = ruleTier;
  finalAssessment.degraded = Boolean(degradedReason);
  finalAssessment.missing_data = riskResult.missingData;
  finalAssessment.immediate_referral = riskResult.immediateReferral || false;
  finalAssessment.risk_reasoning = riskResult.riskReasoning;
  finalAssessment.image_observations = imageObservations;
  finalAssessment.verified_document_count = verifiedDocuments.length;
  finalAssessment.legal_disclaimer =
    'AI-generated clinical assistance for a trained clinic assistant working under remote doctor supervision. This is not a diagnosis or a prescription. All medication guidance requires approval by a Registered Medical Practitioner before administration.';

  return finalAssessment;
};
