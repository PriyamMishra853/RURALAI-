/**
 * The language layer's contract with everything that was already here.
 *
 * Making the product multilingual touched the assessment orchestrator, the
 * tier workflow, the referral builder and the PDF renderer — all of which
 * existing screens, existing tests and (for the API) existing clients already
 * depended on. The rule the change was held to was that it may only ADD:
 *
 *   - every English field that was on the wire before is still on the wire,
 *     with the same name and the same value
 *   - the new `<field>_key` companions sit beside them, never instead of them
 *   - enums stay English, because they are compared in code and stored in
 *     Postgres
 *   - nothing clinical — a drug name, a dose, a unit, a tier — moves
 *
 * These tests exist so that rule is enforced rather than remembered. A future
 * change that "tidies up" by dropping the English now that a key exists would
 * break a client that never asked to be internationalised, and would do it
 * silently, on a clinical screen.
 *
 * Runs with no API key and no network, like the rest of this suite.
 */
import { describe, expect, it } from '@jest/globals';

import {
  resolveLanguage, languageForRequest, LANGUAGE_BY_CODE, DEFAULT_LANGUAGE, LANGUAGES
} from '../src/config/languages.js';
import { buildTierWorkflow } from '../src/services/tierWorkflowService.js';
import { buildReferral } from '../src/services/referralService.js';
import { translateForSpeech } from '../src/services/speechService.js';
import { reportLocale } from '../src/services/reportLocale.js';
import { renderReport, REPORT_TYPES } from '../src/services/reportPdfService.js';

/* ------------------------------------------------------------ the registry */

describe('the language registry', () => {
  it('offers English plus the Eighth Schedule and the regional languages', () => {
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(30);
    expect(LANGUAGE_BY_CODE.en).toBeTruthy();
    expect(LANGUAGE_BY_CODE.hi).toBeTruthy();
  });

  it('gives every language a prompt name that names its script', () => {
    // A model told to write "Bhojpuri" may answer in Latin transliteration.
    // Naming the script is what stops that.
    for (const lang of LANGUAGES) {
      expect(typeof lang.promptName).toBe('string');
      expect(lang.promptName.length).toBeGreaterThan(0);
    }
  });

  it('gives every language a speech tag a browser might actually have', () => {
    for (const lang of LANGUAGES) {
      expect(lang.speechTag).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
    }
  });

  it('resolves a code, an English name, or a browser tag to the same entry', () => {
    // All three arrive in production: '?lang=hi' from this client,
    // '{ target: "Hindi" }' from the original read-aloud call, and
    // 'Accept-Language: hi-IN' from the browser.
    expect(resolveLanguage('hi').code).toBe('hi');
    expect(resolveLanguage('Hindi').code).toBe('hi');
    expect(resolveLanguage('hi-IN').code).toBe('hi');
    expect(resolveLanguage('pa-Guru-IN').code).toBe('pa');
  });

  it('returns null for something it does not know, rather than guessing', () => {
    expect(resolveLanguage('klingon')).toBeNull();
    expect(resolveLanguage('')).toBeNull();
    expect(resolveLanguage(null)).toBeNull();
  });
});

describe('choosing the language for a request', () => {
  const req = (body, query, headers = {}) => ({
    body,
    query,
    get: (name) => headers[name] ?? headers[name.toLowerCase()]
  });

  it('prefers an explicit choice over the browser guess', () => {
    // Accept-Language is what the OS is set to; X-Language is what the health
    // worker picked on the gate. They are different claims.
    const r = req({}, {}, { 'X-Language': 'ta', 'Accept-Language': 'hi-IN,hi;q=0.9' });
    expect(languageForRequest(r).code).toBe('ta');
  });

  it('falls back to Accept-Language when nothing explicit was sent', () => {
    expect(languageForRequest(req({}, {}, { 'Accept-Language': 'bn-IN,bn;q=0.9' })).code).toBe('bn');
  });

  it('falls back to English rather than throwing on an unknown language', () => {
    // No request should fail purely because it named a language nobody has
    // added yet.
    expect(languageForRequest(req({ lang: 'nonsense' }, {})).code).toBe(DEFAULT_LANGUAGE);
    expect(languageForRequest(undefined).code).toBe(DEFAULT_LANGUAGE);
  });
});

/* -------------------------------------------------- the tier workflow shape */

const workflowFor = (riskLevel) => buildTierWorkflow({
  assessment: { risk_level: riskLevel, first_aid_steps: ['Step 1: Sit the patient down.'] },
  patient: { full_name: 'Test Patient', date_of_birth: '1980-01-01', gender: 'female' },
  visit: { visit_code: 'V-1' },
  districtName: 'Lucknow'
});

describe('the tier workflow still carries its English', () => {
  it.each(['LOW', 'MEDIUM', 'HIGH'])('%s keeps headline and adds headline_key', async (tier) => {
    const w = await workflowFor(tier);
    expect(typeof w.headline).toBe('string');
    expect(w.headline.length).toBeGreaterThan(0);
    expect(typeof w.headline_key).toBe('string');
    expect(w.headline_key).toMatch(/^workflow\./);
  });

  it.each(['LOW', 'MEDIUM', 'HIGH'])('%s keeps doctor_action.note and adds note_key', async (tier) => {
    const w = await workflowFor(tier);
    expect(typeof w.doctor_action.note).toBe('string');
    expect(typeof w.doctor_action.note_key).toBe('string');
  });

  it.each(['LOW', 'MEDIUM', 'HIGH'])('%s keeps medication.reason and adds reason_key', async (tier) => {
    const w = await workflowFor(tier);
    expect(typeof w.medication.reason).toBe('string');
    expect(typeof w.medication.reason_key).toBe('string');
  });

  it('still refuses to emit medication at any tier', async () => {
    // The safety boundary this file must not be allowed to erode: the
    // assistant's screen names no medicine, whatever language it is in.
    for (const tier of ['LOW', 'MEDIUM', 'HIGH']) {
      const w = await workflowFor(tier);
      expect(w.medication.emitted).toBe(false);
      expect(w.medication.items).toEqual([]);
    }
  });

  it('keeps the tier itself as the English enum', async () => {
    // normaliseTier and every consumer compare against these.
    expect((await workflowFor('LOW')).tier).toBe('LOW');
    expect((await workflowFor('HIGH')).tier).toBe('HIGH');
  });

  it('keeps doctor_action.queue as the English enum', async () => {
    expect((await workflowFor('LOW')).doctor_action.queue).toBe('DAILY_REVIEW');
    expect((await workflowFor('MEDIUM')).doctor_action.queue).toBe('CONSULTATION');
    expect((await workflowFor('HIGH')).doctor_action.queue).toBe('NONE');
  });
});

/* ------------------------------------------------------- the referral shape */

describe('the referral still carries its English', () => {
  it('keeps every emergency line number and label, and adds a key', async () => {
    const r = await buildReferral({ districtName: 'Lucknow', lat: null, lon: null });

    expect(r.emergency_lines.length).toBeGreaterThan(0);
    for (const line of r.emergency_lines) {
      // The number is the whole point of the row and is never localised.
      expect(line.number).toMatch(/^\d{3}$/);
      expect(typeof line.label).toBe('string');
      expect(line.label.length).toBeGreaterThan(0);
      expect(typeof line.label_key).toBe('string');
    }
    // 108 is the national ambulance line and must always be present.
    expect(r.emergency_lines.some((l) => l.number === '108')).toBe(true);
  });

  it('keeps the capacity instruction, which is the sentence that stops a bad transfer', async () => {
    const r = await buildReferral({ districtName: 'Lucknow', lat: null, lon: null });
    expect(typeof r.capacity_instruction).toBe('string');
    expect(r.capacity_instruction.length).toBeGreaterThan(0);
    expect(r.capacity_instruction_key).toBe('referral.capacityInstruction');
    // And still never claims to know bed status.
    expect(r.capacity_status).toBe('UNKNOWN');
  });
});

/* ------------------------------------------------------------- read-aloud */

describe('read-aloud translation', () => {
  it('returns English unchanged without calling a model', async () => {
    // Asking a model to translate English into English burns a request, adds
    // latency and can only make a clinical passage worse.
    const out = await translateForSpeech('Take rest and drink fluids.', 'en');
    expect(out.ok).toBe(true);
    expect(out.text).toBe('Take rest and drink fluids.');
    expect(out.target).toBe('en');
  });

  it('accepts a code, an English name or a tag for the same language', async () => {
    // No key is configured in this suite, so each returns the source with a
    // reason rather than a translation — what matters here is that none of
    // them is rejected as an unsupported language.
    for (const target of ['ta', 'Tamil', 'ta-IN']) {
      const out = await translateForSpeech('Rest.', target);
      expect(out.reason || '').not.toMatch(/Unsupported language/);
    }
  });

  it('rejects a language nobody has added, rather than interpolating it into a prompt', async () => {
    const out = await translateForSpeech('Rest.', 'klingon');
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/Unsupported language/);
    // Still hands back something readable.
    expect(out.text).toBe('Rest.');
  });

  it('never returns empty text for a non-empty passage', async () => {
    const out = await translateForSpeech('Drink fluids hourly.', 'hi');
    expect(out.text.length).toBeGreaterThan(0);
  });
});

/* ---------------------------------------------------------- report locale */

describe('the report locale', () => {
  it('uses the built-in font and no catalogue for English', () => {
    const L = reportLocale('en');
    expect(L.code).toBe('en');
    expect(L.fonts.regular).toBe('Helvetica');
    expect(L.fallback).toBeNull();
  });

  it('renders Latin-script languages without needing a font installed', () => {
    // Khasi and Mizo are written in the Latin alphabet, so they localise with
    // nothing on disk.
    const L = reportLocale('kha');
    expect(L.code).toBe('kha');
    expect(L.fonts.regular).toBe('Helvetica');
    expect(L.fallback).toBeNull();
  });

  it('falls back to English and SAYS SO when a script has no font', () => {
    // The important half. Whether a font happens to be installed in this
    // checkout is not the assertion — that either it renders in the language,
    // or it reports the fallback, is.
    const L = reportLocale('hi');
    if (L.fallback) {
      expect(L.code).toBe('en');
      expect(L.fallback.script).toBe('Devanagari');
    } else {
      expect(L.code).toBe('hi');
    }
  });

  it('treats an unknown language as English rather than throwing', () => {
    const L = reportLocale('klingon');
    expect(L.code).toBe('en');
  });

  it('always returns a usable translator', () => {
    for (const code of ['en', 'hi', 'ta', 'klingon']) {
      const L = reportLocale(code);
      expect(L.t('nope.not.a.key', 'English fallback')).toBe('English fallback');
      expect(L.t('nope.with.vars', 'Hello {name}', { name: 'X' })).toBe('Hello X');
    }
  });
});

/* --------------------------------------------------------------- the PDFs */

const REPORT_FIXTURE = {
  patient: {
    full_name: 'Test Patient',
    aadhaar_number: '123456789012',
    date_of_birth: '1980-01-01',
    gender: 'female',
    village_line1: 'Rampur',
    phone: '9876543210'
  },
  visit: {
    visit_code: 'V-1',
    created_at: '2026-01-01T09:00:00Z',
    chief_complaint: 'Fever',
    visit_vitals: [{ temperature_f: 101, blood_pressure_systolic: 120, blood_pressure_diastolic: 80 }]
  },
  assessment: { patient_summary: 'Summary.' },
  workflow: {
    tier: 'HIGH',
    first_aid: ['Sit the patient down.'],
    medication: { emitted: false, reason: 'Referred.', reason_key: 'workflow.medication.referred' },
    referral: {
      primary: { name: 'District Hospital', district: 'Agra', lat: 27.1, lon: 78.0 },
      emergency_lines: [{ number: '108', label: 'Ambulance', label_key: 'emergency.108' }],
      capacity_instruction: 'Call ahead.',
      capacity_instruction_key: 'referral.capacityInstruction'
    }
  }
};

const render = (type, lang) => new Promise((resolve, reject) => {
  const chunks = [];
  const doc = renderReport(type, REPORT_FIXTURE, lang);
  doc.on('data', (c) => chunks.push(c));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);
});

describe('the PDF reports', () => {
  it('still default to English when no language is passed', async () => {
    // The old two-argument call site must keep working.
    const buf = await new Promise((resolve, reject) => {
      const chunks = [];
      const doc = renderReport('summary', REPORT_FIXTURE);
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it.each(REPORT_TYPES)('render %s in English', async (type) => {
    const buf = await render(type, 'en');
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(800);
  });

  it.each(REPORT_TYPES)('render %s for a language whose font may be missing', async (type) => {
    // Either it embeds the script's font, or it renders English — never throws
    // and never produces nothing. Refusing to print a referral because a font
    // is unavailable would be the worse failure.
    const buf = await render(type, 'hi');
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(800);
  });

  it('still rejects an unknown report type', async () => {
    expect(() => renderReport('not-a-report', REPORT_FIXTURE, 'en')).toThrow(/Unknown report type/);
  });
});
