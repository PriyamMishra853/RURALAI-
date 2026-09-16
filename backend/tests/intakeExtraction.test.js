/**
 * The CHATBOX endpoint: what it does with the model's answer, and what it does
 * when there isn't one.
 *
 * intakeExtractionRules.test.js pins which values may reach the form. These pin
 * the endpoint's two obligations: that nothing is stored, and that every
 * failure hands the assistant back to the manual form rather than leaving them
 * watching a spinner in front of a patient.
 */
import { describe, expect, it, beforeEach, jest } from '@jest/globals';

const model = { reply: null, throws: null, calls: [] };

jest.unstable_mockModule('../src/config/groq.js', () => ({
  groqAvailable: () => model.available !== false,
  groq: { pooled: true },
  groqChat: async (params) => {
    model.calls.push(params);
    if (model.throws) throw model.throws;
    return { choices: [{ message: { content: model.reply } }] };
  }
}));

const { extractIntake } = await import('../src/controllers/intake.controller.js');

const mockRes = () => {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; if (res.statusCode == null) res.statusCode = 200; return res; };
  return res;
};

const req = (body) => ({ body });

beforeEach(() => {
  model.reply = '{}';
  model.throws = null;
  model.available = true;
  model.calls.length = 0;
});

describe('before the model is asked', () => {
  it('refuses an empty transcript without spending a request', async () => {
    const res = mockRes();
    await extractIntake(req({ transcript: '   ' }), res);
    expect(res.statusCode).toBe(400);
    expect(model.calls).toHaveLength(0);
  });

  it('refuses a transcript too long to read in one go', async () => {
    const res = mockRes();
    await extractIntake(req({ transcript: 'a'.repeat(5000) }), res);
    expect(res.statusCode).toBe(400);
    expect(model.calls).toHaveLength(0);
  });
});

describe('a normal reading', () => {
  it('turns what was said into a proposal for the form', async () => {
    model.reply = JSON.stringify({
      chief_complaint: 'Thirst and frequent urination',
      symptom_duration: 'three days',
      blood_pressure: 'one forty by ninety',
      pulse_bpm: 96
    });

    const res = mockRes();
    await extractIntake(req({ transcript: 'Ram Naresh, sixty-eight, thirst for three days, BP one forty by ninety' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.accept.chief_complaint.value).toBe('Thirst and frequent urination');
    expect(res.body.accept.symptom_duration_value.value).toBe(3);
    expect(res.body.accept.blood_pressure_systolic.value).toBe(140);
    expect(res.body.accept.pulse_bpm.value).toBe(96);
  });

  it('marks everything unconfirmed, whatever the model sounded like', async () => {
    model.reply = JSON.stringify({ chief_complaint: 'Fever', pulse_bpm: 96 });

    const res = mockRes();
    await extractIntake(req({ transcript: 'fever, pulse ninety six' }), res);

    for (const field of Object.values(res.body.accept)) {
      expect(field.confirmed).toBe(false);
      expect(field.source).toBe('voice');
    }
  });

  it('will not overwrite what the assistant already typed', async () => {
    model.reply = JSON.stringify({ chief_complaint: 'Fever' });

    const res = mockRes();
    await extractIntake(req({ transcript: 'fever', typed: { chief_complaint: 'Chest pain' } }), res);

    expect(res.body.accept.chief_complaint).toBeUndefined();
    expect(res.body.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'chief_complaint', reason: 'typed' })
    ]));
  });

  it('drops a diagnosis the model volunteered', async () => {
    model.reply = JSON.stringify({ chief_complaint: 'Fever', diagnosis: 'Malaria', risk_level: 'high' });

    const res = mockRes();
    await extractIntake(req({ transcript: 'fever since two days' }), res);

    expect(res.body.accept.diagnosis).toBeUndefined();
    expect(res.body.accept.risk_level).toBeUndefined();
    expect(res.body.dropped).toEqual(expect.arrayContaining(['diagnosis', 'risk_level']));
  });
});

describe('when there is no answer', () => {
  it('hands the assistant back to the form when the provider fails', async () => {
    model.throws = new Error('connect ETIMEDOUT');

    const res = mockRes();
    await extractIntake(req({ transcript: 'fever for two days' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.fallback).toBe('manual');
    expect(res.body.accept).toEqual({});
  });

  it('treats an unparseable answer the same way', async () => {
    model.reply = 'Sure! Here are the fields: chief complaint is fever';

    const res = mockRes();
    await extractIntake(req({ transcript: 'fever' }), res);

    expect(res.body.ok).toBe(false);
    expect(res.body.fallback).toBe('manual');
  });

  it('says so when no reader is configured, rather than pretending', async () => {
    model.available = false;

    const res = mockRes();
    await extractIntake(req({ transcript: 'fever' }), res);

    expect(res.body.ok).toBe(false);
    expect(res.body.fallback).toBe('manual');
    expect(model.calls).toHaveLength(0);
  });
});
