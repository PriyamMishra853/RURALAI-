/**
 * Health card OCR — what the model claims vs what is accepted.
 *
 * The extraction pre-fills a registration form, so a fabricated or malformed
 * value ends up as a patient's identity, and every clinical record made
 * afterwards hangs off it. The model is instructed to return empty fields
 * rather than guess; these cases assume it will sometimes ignore that, and
 * check what happens when it does.
 *
 * A rejected field is simply absent, so the form keeps asking for it. That is
 * the safe failure: a missing name is obvious to the operator, a wrong one is
 * not.
 */
import { describe, expect, it, jest, beforeEach } from '@jest/globals';

const gemini = { response: null };

jest.unstable_mockModule('../src/config/gemini.js', () => ({
  geminiGenerateJson: async () => gemini.response,
  isSupportedInlineType: () => true
}));

jest.unstable_mockModule('../src/config/groq.js', () => ({ groq: null, groqChat: async () => null }));
jest.unstable_mockModule('tesseract.js', () => ({ createWorker: async () => ({ recognize: async () => ({ data: { text: '' } }), terminate: async () => {} }) }));

const { readHealthCard } = await import('../src/services/ocrService.js');

const FILES = [{ buffer: Buffer.from('fake-image-bytes'), mimetype: 'image/jpeg', originalname: 'card.jpg' }];

const card = (over = {}) => ({
  document_type: 'health_card',
  full_name: 'Rashmi Gupta',
  gender: 'female',
  date_of_birth: '1988-04-12',
  year_of_birth: '',
  card_number: '12345678901234',
  confidence: 'high',
  raw_text_summary: 'AYUSHMAN BHARAT ... Rashmi Gupta ... 12/04/1988',
  ...over
});

beforeEach(() => { gemini.response = card(); });

describe('a clean card', () => {
  it('returns the three fields the form needs', async () => {
    const r = await readHealthCard(FILES);
    expect(r.ok).toBe(true);
    expect(r.fields.full_name).toBe('Rashmi Gupta');
    expect(r.fields.gender).toBe('female');
    expect(r.fields.date_of_birth).toBe('1988-04-12');
    expect(r.confidence).toBe('high');
  });
});

describe('values that must never reach the form', () => {
  it('rejects a date of birth in the future', async () => {
    const next = new Date();
    next.setUTCFullYear(next.getUTCFullYear() + 1);
    gemini.response = card({ date_of_birth: next.toISOString().slice(0, 10) });

    const r = await readHealthCard(FILES);
    expect(r.fields.date_of_birth).toBeUndefined();
    // The rest of the card is still usable — one bad field is not a failed read.
    expect(r.fields.full_name).toBe('Rashmi Gupta');
  });

  it('rejects an implausibly old date of birth', async () => {
    gemini.response = card({ date_of_birth: '1850-01-01' });
    const r = await readHealthCard(FILES);
    expect(r.fields.date_of_birth).toBeUndefined();
  });

  it('rejects a date that is not YYYY-MM-DD', async () => {
    // A common model slip, and "12/04/1988" is ambiguous between conventions.
    gemini.response = card({ date_of_birth: '12/04/1988' });
    const r = await readHealthCard(FILES);
    expect(r.fields.date_of_birth).toBeUndefined();
  });

  it('rejects a gender outside the values the record allows', async () => {
    gemini.response = card({ gender: 'M' });
    const r = await readHealthCard(FILES);
    expect(r.fields.gender).toBeUndefined();
  });

  it('rejects a name that is only digits — a misread card number', async () => {
    gemini.response = card({ full_name: '12345678901234' });
    const r = await readHealthCard(FILES);
    expect(r.fields.full_name).toBeUndefined();
  });

  it('rejects a one-character name', async () => {
    gemini.response = card({ full_name: 'R' });
    const r = await readHealthCard(FILES);
    expect(r.fields.full_name).toBeUndefined();
  });
});

describe('a year-only card', () => {
  it('keeps the year but refuses to invent a full date from it', async () => {
    gemini.response = card({ date_of_birth: '', year_of_birth: '1988' });
    const r = await readHealthCard(FILES);
    expect(r.fields.year_of_birth).toBe('1988');
    expect(r.fields.date_of_birth).toBeUndefined();
  });
});

describe('when the read goes wrong', () => {
  it('reports the fields it refused, so half a card does not look like all of it', async () => {
    gemini.response = card({ gender: 'M', date_of_birth: 'nonsense' });
    const r = await readHealthCard(FILES);
    expect(r.ok).toBe(true);
    expect(Object.keys(r.fields)).toContain('full_name');
    expect(r.fields.gender).toBeUndefined();
    expect(r.fields.date_of_birth).toBeUndefined();
  });

  it('refuses a document that is not an identity card', async () => {
    gemini.response = card({ document_type: 'other', full_name: '', gender: '', date_of_birth: '' });
    const r = await readHealthCard(FILES);
    expect(r.ok).toBe(false);
    expect(r.fields).toEqual({});
  });

  it('fails cleanly when the model returns nothing', async () => {
    gemini.response = null;
    const r = await readHealthCard(FILES);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/by hand/i);
  });

  it('treats an unstated confidence as low rather than assuming it is good', async () => {
    gemini.response = card({ confidence: undefined });
    const r = await readHealthCard(FILES);
    expect(r.confidence).toBe('low');
  });

  it('rejects an empty upload', async () => {
    const r = await readHealthCard([]);
    expect(r.ok).toBe(false);
  });
});
