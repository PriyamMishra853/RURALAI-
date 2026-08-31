import { createWorker } from 'tesseract.js';
import { GEMINI_VISION_MODEL, GROQ_TEXT_MODEL } from '../config/models.js';
import { groq, groqChat } from '../config/groq.js';
import { geminiGenerateJson, isSupportedInlineType } from '../config/gemini.js';

/**
 * Medical document OCR and extraction.
 *
 * Handles two kinds of document, because they carry different information and
 * a single generic schema read neither well:
 *
 *   prescription — medicines, strengths, frequencies, durations, and the
 *                  clinical context around them (diagnosis, advice).
 *   lab_report   — test names with values, units and reference ranges, plus
 *                  the abnormal flags a doctor scans for first.
 *
 * Order of engines:
 *   1. Gemini multimodal — reads images AND PDFs natively, so a multi-page
 *      report goes up as one request and the model keeps cross-page context.
 *   2. Tesseract.js -> Groq text structuring, for anything Gemini declines.
 *
 * SAFETY: if every engine fails, this returns an explicit failure record
 * (needs_manual_entry: true). It NEVER invents medications, test values or
 * diagnoses — fabricated clinical data in a medical record is dangerous.
 */

const PRESCRIPTION_SCHEMA = `{
  "document_type": "prescription",
  "date": "YYYY-MM-DD or Unknown",
  "doctor_name": "Doctor name exactly as written, or Unknown",
  "clinic_name": "Clinic or hospital name, or Unknown",
  "patient_name": "Patient name exactly as written, or Unknown",
  "patient_age": "Age as written, or Unknown",
  "medications": [
    {
      "name": "Medication name exactly as written",
      "strength": "e.g. 500 mg",
      "form": "tablet | capsule | syrup | injection | drops | ointment | Unknown",
      "frequency": "e.g. Twice daily, 1-0-1",
      "duration": "e.g. 5 days",
      "instructions": "e.g. After meals",
      "purpose": "Why it appears to have been prescribed, ONLY if the document says so, else Unknown"
    }
  ],
  "diagnosis_notes": "Diagnosis or complaint exactly as written",
  "advice": "Non-medication advice written on the prescription, or empty",
  "follow_up": "Follow-up instruction as written, or Unknown",
  "medical_history_conditions": ["Condition exactly as written"],
  "allergies_noted": ["Allergy exactly as written"],
  "raw_text_summary": "Complete readable text transcribed from the document"
}`;

const LAB_REPORT_SCHEMA = `{
  "document_type": "lab_report",
  "date": "YYYY-MM-DD or Unknown",
  "lab_name": "Laboratory name, or Unknown",
  "referring_doctor": "Referring doctor, or Unknown",
  "patient_name": "Patient name exactly as written, or Unknown",
  "patient_age": "Age as written, or Unknown",
  "pages_read": 1,
  "panels": [
    {
      "panel_name": "e.g. Complete Blood Count",
      "tests": [
        {
          "name": "Test name exactly as written",
          "value": "Result value exactly as printed",
          "unit": "Unit exactly as printed, or Unknown",
          "reference_range": "Reference interval exactly as printed, or Unknown",
          "flag": "high | low | normal | unknown"
        }
      ]
    }
  ],
  "abnormal_findings": ["Test name: value (unit) — outside the printed reference range"],
  "impression": "Impression or comments section exactly as written, or empty",
  "medical_history_conditions": [],
  "allergies_noted": [],
  "medications": [],
  "diagnosis_notes": "",
  "raw_text_summary": "Complete readable text transcribed from EVERY page"
}`;

const GENERIC_SCHEMA = `{
  "document_type": "prescription" | "lab_report" | "medical_report" | "discharge_summary" | "other",
  "date": "YYYY-MM-DD or Unknown",
  "doctor_name": "Doctor name, or Unknown",
  "patient_name": "Patient name, or Unknown",
  "medications": [{ "name": "", "strength": "", "frequency": "", "duration": "", "instructions": "" }],
  "panels": [],
  "abnormal_findings": [],
  "medical_history_conditions": [],
  "allergies_noted": [],
  "diagnosis_notes": "",
  "raw_text_summary": "Complete readable text"
}`;

/**
 * Health card / ABHA card — an identity document, not a clinical one.
 *
 * Read to pre-fill a registration form, so the only fields wanted are the ones
 * the form asks for. Everything here is checked by a human before it is used;
 * `confidence` exists so a poor read can be presented as a suggestion rather
 * than an answer.
 */
const HEALTH_CARD_SCHEMA = `{
  "document_type": "health_card",
  "full_name": "Name exactly as printed, or empty if not legible",
  "gender": "male" | "female" | "other" | "",
  "date_of_birth": "YYYY-MM-DD, or empty if not printed",
  "year_of_birth": "YYYY if only a year is printed, else empty",
  "card_number": "The card/ABHA number as printed, digits and hyphens only, or empty",
  "confidence": "high" | "medium" | "low",
  "raw_text_summary": "Everything legible on the card, as plain text"
}`;

const HEALTH_CARD_RULES = `You are reading an Indian health identity card (ABHA card, health insurance card, or state health scheme card) to pre-fill a clinic registration form.

ABSOLUTE RULES:
- Transcribe ONLY what is printed on the card.
- NEVER guess or infer a name, sex or date of birth. An invented identity attaches one person's medical record to another.
- If a field is not printed or not legible, return an empty string for it. An empty field is correct and expected; a plausible guess is not.
- Many Indian cards print only a year of birth. Put it in year_of_birth and leave date_of_birth empty rather than inventing a day and month.
- Indian names are frequently transliterated. Transcribe what is printed without "correcting" the spelling.
- Set confidence to "low" if the image is blurred, cropped, glared or partly obscured, whatever you managed to read.
- If this is not a health or identity card, set document_type to "other" and leave every field empty.`;

const BASE_RULES = `You are a medical document transcription system for a rural clinic in India.

ABSOLUTE RULES:
- Transcribe ONLY what is actually visible in the document.
- NEVER guess, infer, or invent medications, dosages, test values, reference ranges, diagnoses, or names. A fabricated value in a medical record can kill someone.
- If a field is not readable or not present, use "Unknown" or an empty array.
- Handwriting is common on Indian prescriptions. If a word is genuinely ambiguous, transcribe your best reading and append " (unclear)" to that field rather than dropping or inventing it.
- If the document is not a medical document, or is unreadable, set document_type to "other" and explain in raw_text_summary.`;

const LAB_RULES = `${BASE_RULES}

THIS IS A LABORATORY / TEST REPORT, and it may run to several pages.
- Read EVERY page you are given. Set pages_read to the number of pages you actually transcribed.
- Group tests under the panel heading they appear beneath.
- Copy value, unit and reference range EXACTLY as printed. Do not convert units or normalise formats.
- Set flag by comparing the printed value against the printed reference range only. If either is missing or non-numeric, use "unknown" — never estimate.
- List every out-of-range test in abnormal_findings.`;

const PRESCRIPTION_RULES = `${BASE_RULES}

THIS IS A PRESCRIPTION.
- Capture every medication line, including ones written in the margin.
- Indian prescriptions often write frequency as 1-0-1 (morning-afternoon-night). Transcribe that notation as written; do not translate it.
- "purpose" may only be filled if the document itself states the indication. Otherwise "Unknown".`;

const schemaFor = (kind) =>
  kind === 'lab_report'
    ? { rules: LAB_RULES, schema: LAB_REPORT_SCHEMA }
    : kind === 'prescription'
      ? { rules: PRESCRIPTION_RULES, schema: PRESCRIPTION_SCHEMA }
      : { rules: BASE_RULES, schema: GENERIC_SCHEMA };

/**
 * Read one document, which may be several files that belong together
 * (pages 1..N of one report, or the front and back of one prescription).
 *
 * @param {Array<{buffer: Buffer, mimetype: string, originalname: string}>} files
 * @param {'prescription'|'lab_report'|'other'} kind
 */
export const processMedicalDocument = async (files, kind = 'prescription') => {
  const list = (Array.isArray(files) ? files : [files]).filter((f) => f?.buffer?.length);
  if (!list.length) return extractionFailure('No file data received by the OCR service.');

  const names = list.map((f) => f.originalname).join(', ');
  console.log(`OCR start: ${list.length} file(s) [${names}] as ${kind}`);

  const { rules, schema } = schemaFor(kind);
  let rawText = '';
  let structuredData = null;
  let engine = null;

  // ---- Engine 1: Gemini multimodal (images and PDFs, all pages at once) ----
  const inlineFiles = list
    .filter((f) => isSupportedInlineType(f.mimetype))
    .map((f) => ({ base64: f.buffer.toString('base64'), mimeType: f.mimetype }));

  if (inlineFiles.length) {
    const pageWord = inlineFiles.length > 1 ? `${inlineFiles.length} pages of one document` : 'this document';
    const parsed = await geminiGenerateJson(
      `${rules}\n\nReturn strictly a JSON object with this schema:\n${schema}`,
      `Transcribe and extract the structured medical information from ${pageWord}. Read every page in order.`,
      inlineFiles
    );

    if (parsed && (parsed.raw_text_summary || parsed.medications?.length || parsed.panels?.length)) {
      structuredData = normalize(parsed, kind, inlineFiles.length);
      rawText = parsed.raw_text_summary || '';
      engine = GEMINI_VISION_MODEL;
      console.log(`Gemini read ${structuredData.pages_read} page(s).`);
    }
  }

  // ---- Engine 2: Tesseract per image, then Groq structuring ----
  if (!structuredData) {
    const allImages = list.filter((f) => String(f.mimetype).startsWith('image/'));
    // Screen before Tesseract sees the buffer — see looksLikeDecodableImage.
    const imageFiles = allImages.filter((f) => looksLikeDecodableImage(f.buffer));
    const rejected = allImages.length - imageFiles.length;
    if (rejected > 0) {
      console.warn(`${rejected} file(s) are not decodable images; not sent to Tesseract.`);
    }

    if (imageFiles.length) {
      let worker = null;
      try {
        console.log('Running Tesseract fallback...');
        worker = await createWorker('eng');
        const pages = [];
        for (const f of imageFiles) {
          try {
            const ret = await worker.recognize(f.buffer);
            pages.push(ret.data.text || '');
          } catch (pageErr) {
            // One unreadable page must not lose the pages that did read.
            console.warn(`Tesseract could not read ${f.originalname}: ${pageErr.message}`);
            pages.push('');
          }
        }
        rawText = pages.join('\n\n--- page break ---\n\n');
        console.log(`Tesseract extracted ${rawText.length} characters from ${imageFiles.length} page(s).`);
      } catch (tErr) {
        console.warn('Tesseract OCR error:', tErr.message);
      } finally {
        // Always terminate: a leaked worker holds a thread and its own memory.
        if (worker) await worker.terminate().catch(() => {});
      }
    } else if (allImages.length) {
      return extractionFailure(
        'The uploaded image could not be opened — it may be truncated or in an unsupported format. Photograph the page again.'
      );
    } else if (list.some((f) => f.mimetype === 'application/pdf')) {
      // Tesseract cannot rasterise a PDF, and there is no PDF renderer in this
      // service. Say so plainly instead of returning an empty read.
      return extractionFailure(
        'This PDF could not be read. The AI document reader is unavailable — re-upload the report as photographs of each page, or enter the values manually.'
      );
    }

    if (rawText.trim().length >= 20 && groq) {
      try {
        const response = await groqChat({
          model: GROQ_TEXT_MODEL,
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: `${rules}\nYou receive raw OCR text which may contain OCR noise and page breaks. Return strictly a JSON object with this schema:\n${schema}`
            },
            { role: 'user', content: `Raw OCR text:\n${rawText}` }
          ]
        });
        const parsed = JSON.parse(response.choices[0].message.content);
        if (parsed) {
          structuredData = normalize(parsed, kind, imageFiles.length);
          engine = `tesseract+${GROQ_TEXT_MODEL}`;
          console.log('Groq structured the Tesseract OCR text.');
        }
      } catch (llmErr) {
        console.warn('Groq text structuring failed:', llmErr.message);
      }
    }
  }

  if (!structuredData) {
    return extractionFailure(
      rawText.trim().length > 0
        ? 'Text was detected but could not be reliably structured. Enter the details manually.'
        : 'The document could not be read automatically. Enter the details manually.',
      rawText
    );
  }

  return {
    raw_text: rawText,
    extracted_data: structuredData,
    ocr_engine: engine,
    files_read: list.length,
    confidence: engine === GEMINI_VISION_MODEL ? 0.9 : 0.7,
    needs_manual_entry: false
  };
};

const asArray = (v) => (Array.isArray(v) ? v : []);

/**
 * Does this buffer actually start with the magic bytes of an image Tesseract
 * can open?
 *
 * Tesseract.js reports a failed decode by THROWING FROM ITS WORKER THREAD, on
 * a later tick — which escapes the surrounding try/catch and takes the whole
 * Node process down. One truncated upload from one assistant killed the
 * backend for every clinic. Screening the buffer here means the worker is
 * never handed something it cannot open.
 */
const looksLikeDecodableImage = (buffer) => {
  if (!buffer || buffer.length < 64) return false;
  const b = buffer;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;                       // JPEG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true;       // PNG
  if (b[0] === 0x42 && b[1] === 0x4d) return true;                                         // BMP
  if ((b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d)) return true;    // TIFF
  if (b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP') return true;
  return false;
};

function normalize(parsed, kind, fileCount) {
  const panels = asArray(parsed.panels).map((p) => ({
    panel_name: p.panel_name || 'Results',
    tests: asArray(p.tests).map((t) => ({
      name: t.name || 'Unknown',
      value: t.value ?? 'Unknown',
      unit: t.unit || '',
      reference_range: t.reference_range || '',
      flag: ['high', 'low', 'normal'].includes(String(t.flag).toLowerCase())
        ? String(t.flag).toLowerCase()
        : 'unknown'
    }))
  }));

  return {
    document_type: parsed.document_type || kind || 'other',
    date: parsed.date || 'Unknown',
    doctor_name: parsed.doctor_name || parsed.referring_doctor || 'Unknown',
    clinic_name: parsed.clinic_name || parsed.lab_name || 'Unknown',
    patient_name: parsed.patient_name || 'Unknown',
    patient_age: parsed.patient_age || 'Unknown',
    pages_read: Number.parseInt(parsed.pages_read, 10) || fileCount || 1,

    medications: asArray(parsed.medications).map((m) => ({
      name: m.name || 'Unknown',
      strength: m.strength || '',
      form: m.form || '',
      frequency: m.frequency || '',
      duration: m.duration || '',
      instructions: m.instructions || '',
      purpose: m.purpose || 'Unknown'
    })),

    panels,
    abnormal_findings: asArray(parsed.abnormal_findings),
    impression: parsed.impression || '',
    advice: parsed.advice || '',
    follow_up: parsed.follow_up || 'Unknown',
    medical_history_conditions: asArray(parsed.medical_history_conditions),
    allergies_noted: asArray(parsed.allergies_noted),
    diagnosis_notes: parsed.diagnosis_notes || '',
    raw_text_summary: parsed.raw_text_summary || ''
  };
}

function extractionFailure(message, rawText = '') {
  console.warn(`OCR extraction failed: ${message}`);
  return {
    raw_text: rawText,
    extracted_data: {
      document_type: 'other',
      date: 'Unknown',
      doctor_name: 'Unknown',
      clinic_name: 'Unknown',
      patient_name: 'Unknown',
      patient_age: 'Unknown',
      pages_read: 0,
      medications: [],
      panels: [],
      abnormal_findings: [],
      impression: '',
      advice: '',
      follow_up: 'Unknown',
      medical_history_conditions: [],
      allergies_noted: [],
      diagnosis_notes: '',
      raw_text_summary: '',
      extraction_error: message
    },
    ocr_engine: 'none',
    files_read: 0,
    confidence: 0,
    needs_manual_entry: true
  };
}

/**
 * Read an Indian health / ABHA card for the registration form.
 *
 * Deliberately separate from processMedicalDocument. That function reads
 * clinical documents and stores them against a visit; this reads an identity
 * document during registration, when there is no visit yet, and stores
 * nothing. What it returns is a *proposal* for a human to accept field by
 * field — see the caller.
 *
 * Every field is validated here rather than trusted. A model that returns
 * "01-01-1990" or a birth date in the future, or a gender the enum does not
 * have, must not reach the form: a wrong identity silently attaches one
 * person's medical record to another, and the operator would have no way to
 * see that the value was invented rather than read.
 */
export const readHealthCard = async (files) => {
  const list = (Array.isArray(files) ? files : [files]).filter((f) => f?.buffer?.length);
  if (!list.length) {
    return { ok: false, error: 'No file data received.', fields: {}, confidence: 'low' };
  }

  const inlineFiles = list
    .filter((f) => isSupportedInlineType(f.mimetype))
    .map((f) => ({ base64: f.buffer.toString('base64'), mimeType: f.mimetype }));

  if (!inlineFiles.length) {
    return { ok: false, error: 'That file type cannot be read. Use a photo or a PDF.', fields: {}, confidence: 'low' };
  }

  const parsed = await geminiGenerateJson(
    `${HEALTH_CARD_RULES}\n\nReturn strictly a JSON object with this schema:\n${HEALTH_CARD_SCHEMA}`,
    'Read this health identity card and extract the printed details.',
    inlineFiles
  );

  if (!parsed) {
    return { ok: false, error: 'The card could not be read. Enter the details by hand.', fields: {}, confidence: 'low' };
  }

  if (parsed.document_type && parsed.document_type !== 'health_card') {
    return {
      ok: false,
      error: 'That does not look like a health or identity card.',
      fields: {},
      confidence: 'low',
      raw_text: String(parsed.raw_text_summary || '').slice(0, 2000)
    };
  }

  return {
    ok: true,
    fields: validateHealthCardFields(parsed),
    confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low',
    raw_text: String(parsed.raw_text_summary || '').slice(0, 2000)
  };
};

/** Keep only values that are well-formed. A rejected field is simply absent. */
function validateHealthCardFields(parsed) {
  const fields = {};

  const name = String(parsed.full_name || '').trim();
  // Two characters is the same floor the patients table enforces, and a name
  // of pure digits is a misread card number rather than a person.
  if (name.length >= 2 && name.length <= 120 && !/^\d+$/.test(name)) {
    fields.full_name = name;
  }

  const gender = String(parsed.gender || '').trim().toLowerCase();
  if (['male', 'female', 'other'].includes(gender)) fields.gender = gender;

  const dob = String(parsed.date_of_birth || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    const d = new Date(`${dob}T00:00:00Z`);
    const now = new Date();
    const oldest = new Date();
    oldest.setUTCFullYear(oldest.getUTCFullYear() - 120);
    // The same window the patients table checks. A card read as being born
    // tomorrow is a misread, not a newborn.
    if (!Number.isNaN(d.getTime()) && d <= now && d >= oldest) fields.date_of_birth = dob;
  }

  // A year on its own is genuinely useful — most Indian cards print only that
  // — but it is never turned into a date here. The form asks the operator.
  const year = String(parsed.year_of_birth || '').trim();
  if (/^\d{4}$/.test(year)) {
    const y = Number(year);
    const thisYear = new Date().getUTCFullYear();
    if (y >= thisYear - 120 && y <= thisYear) fields.year_of_birth = year;
  }

  const card = String(parsed.card_number || '').replace(/[^\d-]/g, '');
  if (card.length >= 8 && card.length <= 24) fields.card_number = card;

  return fields;
}
