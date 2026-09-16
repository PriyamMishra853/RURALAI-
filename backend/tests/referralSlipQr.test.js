/**
 * The QR code on the referral slip.
 *
 * The slip travels with a patient in an emergency, so the QR is the part that
 * is allowed to go missing and the sheet is not. These pin that the QR carries
 * exactly the hospital link, appears only on a slip that is being followed up,
 * and that no failure making or drawing it costs the slip or its typed link.
 */
import { describe, expect, it, beforeEach, jest } from '@jest/globals';

// The real encoder, wrapped so a test can watch it or make it fail. It is
// asked for a small image: under Jest's VM the PNG writer's per-pixel loop runs
// about fifty times slower than in Node, and the print-sized QR takes seconds.
const realQr = (await import('qrcode')).default;
const qr = { calls: [], fail: false };
jest.unstable_mockModule('qrcode', () => ({
  default: {
    toBuffer: (text, opts) => {
      qr.calls.push({ text, opts });
      return qr.fail
        ? Promise.reject(new Error('encoder broke'))
        : realQr.toBuffer(text, { ...opts, width: undefined, scale: 1 });
    }
  }
}));

const PDFDocument = (await import('pdfkit')).default;
const { renderReport, ackQrPng } = await import('../src/services/reportPdfService.js');

const ACK_URL = 'https://clinic.example.org/r/Xy3kP9qLm2Vn8RtW5sZa7bCd1eFg4hJk';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const slip = (tracking) => ({
  patient: { full_name: 'Test Patient', aadhaar_number: '123456789012', date_of_birth: '1980-01-01', gender: 'female' },
  visit: { visit_code: 'V-1', created_at: '2026-09-17T09:00:00Z', chief_complaint: 'Fever' },
  assessment: { patient_summary: 'Summary.' },
  workflow: { tier: 'HIGH', referral: { primary: { name: 'District Hospital', district: 'Pune', lat: 18.5, lon: 73.8 } } },
  tracking
});

// Every string written on the page. The PDF's own text is font-encoded and
// compressed, so it is read here, on its way in.
const printed = [];
const writeText = PDFDocument.prototype.text;
jest.spyOn(PDFDocument.prototype, 'text').mockImplementation(function recordText(str, ...rest) {
  printed.push(String(str));
  return writeText.call(this, str, ...rest);
});

const render = (data) => new Promise((resolve, reject) => {
  const doc = renderReport('referral', data, 'en');
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);
});

const hasImage = (pdf) => pdf.toString('latin1').includes('/Subtype /Image');

beforeEach(() => {
  qr.calls.length = 0;
  qr.fail = false;
  printed.length = 0;
});

describe('making the QR', () => {
  it('encodes exactly the hospital link, as a PNG', async () => {
    const png = await ackQrPng(ACK_URL);
    expect(qr.calls).toHaveLength(1);
    expect(qr.calls[0].text).toBe(ACK_URL);
    expect(qr.calls[0].opts).toMatchObject({ type: 'png' });
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  });

  it('makes nothing when there is no link', async () => {
    expect(await ackQrPng(undefined)).toBeNull();
    expect(await ackQrPng('')).toBeNull();
    expect(qr.calls).toHaveLength(0);
  });

  it('answers null rather than throwing when the encoder fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    qr.fail = true;
    await expect(ackQrPng(ACK_URL)).resolves.toBeNull();
    warn.mockRestore();
  });
});

describe('the referral slip', () => {
  it('carries the QR beside the code and the typed link', async () => {
    const tracking = { referral_code: 'RF-ABCD2345', ack_url: ACK_URL, ack_qr_png: await ackQrPng(ACK_URL) };
    const pdf = await render(slip(tracking));

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(hasImage(pdf)).toBe(true);
    expect(printed).toContain(ACK_URL);
    expect(printed.some((s) => s.includes('RF-ABCD2345'))).toBe(true);
    expect(printed).toContain('Hospital desk: scan to confirm arrival');
  });

  it('has no QR, and no link, when the referral is not being followed up', async () => {
    const pdf = await render(slip(null));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(hasImage(pdf)).toBe(false);
    expect(printed.some((s) => s.includes('/r/'))).toBe(false);
  });

  it('draws no QR without a link to go with it', async () => {
    const png = await ackQrPng(ACK_URL);
    const pdf = await render(slip({ referral_code: 'RF-ABCD2345', ack_qr_png: png }));
    expect(hasImage(pdf)).toBe(false);
  });

  it('still prints, with the typed link, when the QR could not be made', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    qr.fail = true;
    const tracking = { referral_code: 'RF-ABCD2345', ack_url: ACK_URL };
    tracking.ack_qr_png = await ackQrPng(tracking.ack_url);

    const pdf = await render(slip(tracking));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(hasImage(pdf)).toBe(false);
    expect(printed).toContain(ACK_URL);
    warn.mockRestore();
  });

  it('still prints, with the typed link, when the QR cannot be drawn', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const tracking = { referral_code: 'RF-ABCD2345', ack_url: ACK_URL, ack_qr_png: Buffer.from('not a png') };

    const pdf = await render(slip(tracking));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(hasImage(pdf)).toBe(false);
    expect(printed).toContain(ACK_URL);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/QR not drawn/), expect.any(String));
    warn.mockRestore();
  });
});
