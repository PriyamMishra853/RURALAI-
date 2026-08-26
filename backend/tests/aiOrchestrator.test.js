/**
 * Tier-combination tests for the assessment pipeline.
 *
 * The rule tier is a floor; vision and the model may raise it and may never
 * lower it. A model that did not run is not a model that returned LOW —
 * see docs/PHASE1_PRODUCTION_READINESS_PLAN.md §D.6.
 *
 * Groq and the RAG engine are mocked. This suite never makes a network call.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

/** Complete, in-range vitals for an adult — the rule engine returns LOW here. */
const NORMAL_VITALS = {
  spo2: 98,
  temperature: 98.6,
  blood_pressure_systolic: 118,
  pulse: 76
};
const CONTEXT = {
  patient: { name: 'Test Patient', age: 34 },
  visit: { chief_complaint: 'mild headache', symptom_duration: '1 day' },
  vitals: NORMAL_VITALS,
  verifiedDocuments: [],
  imageObservations: []
};

/**
 * Load the orchestrator with a stubbed Groq client. Passing null models "no
 * provider configured"; passing a completion string models a live provider.
 */
const loadOrchestrator = async (groqStub) => {
  jest.resetModules();
  jest.unstable_mockModule('../src/config/groq.js', () => ({ groq: groqStub }));
  jest.unstable_mockModule('../src/services/ragEngine.js', () => ({
    retrieveClinicalProtocols: jest.fn().mockResolvedValue([])
  }));
  return import('../src/services/aiOrchestrator.js');
};

/** A Groq stub whose chat completion resolves to the given assessment object. */
const groqReturning = (assessment) => ({
  chat: {
    completions: {
      create: jest.fn().mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(assessment) } }]
      })
    }
  }
});

const VALID_LLM_RESPONSE = {
  patient_summary: 'Adult presenting with a mild headache. Vitals in range.',
  key_symptoms: ['headache'],
  risk_level: 'LOW',
  first_aid_steps: ['Step 1: Rest in a quiet room.'],
  warnings: []
};

beforeEach(() => {
  jest.resetModules();
});

describe('degraded AI fails safe to MEDIUM', () => {
  it('floors a LOW case at MEDIUM when no LLM provider is configured', async () => {
    const { runFullPatientAssessment } = await loadOrchestrator(null);
    const result = await runFullPatientAssessment(CONTEXT);

    expect(result.rule_tier).toBe('LOW');
    expect(result.risk_level).toBe('MEDIUM');
    expect(result.degraded).toBe(true);
    expect(result.requires_doctor).toBe(true);
    expect(result.recommended_next_action).toBe('DOCTOR_REVIEW');
    expect(result.warnings.join(' ')).toMatch(/not assessed by the model/i);
  });

  it('floors a LOW case at MEDIUM when the LLM call throws', async () => {
    const groq = {
      chat: { completions: { create: jest.fn().mockRejectedValue(new Error('503 upstream')) } }
    };
    const { runFullPatientAssessment } = await loadOrchestrator(groq);
    const result = await runFullPatientAssessment(CONTEXT);

    expect(result.risk_level).toBe('MEDIUM');
    expect(result.degraded).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/503 upstream/);
  });

  it('floors a LOW case at MEDIUM when the LLM returns an off-schema response', async () => {
    const { runFullPatientAssessment } = await loadOrchestrator(groqReturning({ nonsense: true }));
    const result = await runFullPatientAssessment(CONTEXT);

    expect(result.risk_level).toBe('MEDIUM');
    expect(result.degraded).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/schema/i);
  });

  it('does not mark a successful assessment as degraded', async () => {
    const { runFullPatientAssessment } = await loadOrchestrator(groqReturning(VALID_LLM_RESPONSE));
    const result = await runFullPatientAssessment(CONTEXT);

    expect(result.degraded).toBe(false);
    expect(result.risk_level).toBe('LOW');
    expect(result.generated_by).toBe('groq-llama-3.3-70b');
  });
});

describe('final tier is the maximum of every source', () => {
  it('lets the model raise the tier above the rule tier', async () => {
    const groq = groqReturning({ ...VALID_LLM_RESPONSE, risk_level: 'HIGH' });
    const { runFullPatientAssessment } = await loadOrchestrator(groq);
    const result = await runFullPatientAssessment(CONTEXT);

    expect(result.rule_tier).toBe('LOW');
    expect(result.risk_level).toBe('HIGH');
    expect(result.recommended_next_action).toBe('URGENT_DOCTOR_REVIEW');
    expect(result.warnings.join(' ')).toMatch(/raised triage from LOW to HIGH/);
  });

  it('does not let the model lower the tier below the rule tier', async () => {
    const groq = groqReturning({ ...VALID_LLM_RESPONSE, risk_level: 'LOW' });
    const { runFullPatientAssessment } = await loadOrchestrator(groq);
    const result = await runFullPatientAssessment({
      ...CONTEXT,
      vitals: { ...NORMAL_VITALS, spo2: 85 } // critical hypoxemia
    });

    expect(result.rule_tier).toBe('HIGH');
    expect(result.risk_level).toBe('HIGH');
    expect(result.immediate_referral).toBe(true);
    expect(result.recommended_next_action).toBe('EMERGENCY_HOSPITAL_REFERRAL');
  });

  it('lets a wound photograph raise the tier', async () => {
    const { runFullPatientAssessment } = await loadOrchestrator(groqReturning(VALID_LLM_RESPONSE));
    const result = await runFullPatientAssessment({
      ...CONTEXT,
      imageObservations: [{ severity_impression: 'HIGH', cautious_summary: 'signs of infection' }]
    });

    expect(result.risk_level).toBe('HIGH');
    expect(result.warnings.join(' ')).toMatch(/raised triage to HIGH/);
  });

  it('carries the missing-vitals list through to the assessment', async () => {
    const { runFullPatientAssessment } = await loadOrchestrator(groqReturning(VALID_LLM_RESPONSE));
    const result = await runFullPatientAssessment({ ...CONTEXT, vitals: {} });

    expect(result.risk_level).toBe('MEDIUM');
    expect(result.missing_data).toContain('SpO2 not recorded');
    expect(result.missing_data).toContain('Blood pressure not recorded');
  });
});

describe('medication is never model-authored', () => {
  /** A model ignoring its instructions and prescribing an antibiotic. */
  const ROGUE_LLM_RESPONSE = {
    ...VALID_LLM_RESPONSE,
    supportive_medication_guidance: [
      'Amoxicillin 500 mg three times daily for 5 days — subject to doctor approval',
      'Prednisolone 20 mg once daily'
    ]
  };

  beforeEach(() => {
    process.env.REQUIRE_SIGNED_FORMULARY = 'false';
  });
  afterEach(() => {
    delete process.env.REQUIRE_SIGNED_FORMULARY;
  });

  it('discards medication the model authored, even when it looks plausible', async () => {
    const { runFullPatientAssessment } = await loadOrchestrator(groqReturning(ROGUE_LLM_RESPONSE));
    const result = await runFullPatientAssessment(CONTEXT);

    const rendered = (result.supportive_medication_guidance || []).join(' ');
    expect(rendered).not.toMatch(/Amoxicillin/i);
    expect(rendered).not.toMatch(/Prednisolone/i);
    expect(result.medication_source).toBe('formulary-rules-engine');
  });

  it('stamps every surviving medication with a formulary rule id', async () => {
    const { runFullPatientAssessment } = await loadOrchestrator(groqReturning(ROGUE_LLM_RESPONSE));
    const result = await runFullPatientAssessment({
      ...CONTEXT,
      visit: { chief_complaint: 'fever', symptom_duration: '1 day' }
    });

    for (const med of result.medications) {
      expect(med.rule_source_id).toMatch(/^FORM-/);
    }
  });

  it('emits no medication at all for a HIGH-risk case', async () => {
    const { runFullPatientAssessment } = await loadOrchestrator(groqReturning(ROGUE_LLM_RESPONSE));
    const result = await runFullPatientAssessment({
      ...CONTEXT,
      vitals: { ...NORMAL_VITALS, spo2: 85 }
    });

    expect(result.risk_level).toBe('HIGH');
    expect(result.medications).toEqual([]);
    expect(result.supportive_medication_guidance).toEqual([]);
  });
});
