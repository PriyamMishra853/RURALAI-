import { createWorker } from 'tesseract.js';
import { GEMINI_VISION_MODEL, GROQ_TEXT_MODEL } from '../config/models.js';
import { groq } from '../config/groq.js';
import { geminiGenerateJson } from '../config/gemini.js';

/**
 * Medical Document OCR & Information Extraction Pipeline
 *
 * Order of engines:
 *  1. Gemini 2.5 Flash multimodal (reads the image directly)
 *  2. Tesseract.js OCR -> Groq text structuring (see config/models.js)
 *
 * SAFETY: if every engine fails, this returns an explicit failure record
 * (needs_manual_entry: true). It NEVER invents medications or diagnoses —
 * fabricated clinical data in a medical record is dangerous and illegal.
 */

const EXTRACTION_SCHEMA = `{
  "document_type": "prescription" | "lab_report" | "medical_report" | "discharge_summary" | "other",
  "date": "YYYY-MM-DD or Unknown",
  "doctor_name": "Doctor name exactly as written, or Unknown",
  "patient_name": "Patient name exactly as written, or Unknown",
  "medications": [
    { "name": "Medication name", "strength": "500 mg", "frequency": "Twice daily", "duration": "5 days", "instructions": "After meals" }
  ],
  "medical_history_conditions": ["Condition exactly as written"],
  "allergies_noted": ["Allergy exactly as written"],
  "diagnosis_notes": "Diagnosis/notes exactly as written in the document",
  "raw_text_summary": "Complete readable text transcribed from the document"
}`;

const EXTRACTION_RULES = `You are a medical document transcription system.
Transcribe ONLY what is actually visible in the document.
NEVER guess, infer, or invent medications, dosages, diagnoses, or names.
If a field is not readable or not present, use "Unknown" or an empty array.
If the image is not a medical document or is unreadable, set document_type to "other" and explain in raw_text_summary.`;

export const processMedicalDocument = async (fileBuffer, fileName = 'document.jpg', mimeType = 'image/jpeg') => {
  let rawText = '';
  let structuredData = null;
  let engine = null;

  console.log(`📄 OCR pipeline start: ${fileName} (${mimeType})`);

  if (!fileBuffer) {
    return extractionFailure('No file data received by the OCR service.');
  }

  // ---- Engine 1: Gemini multimodal (image documents) ----
  if (mimeType.startsWith('image/')) {
    const parsed = await geminiGenerateJson(
      `${EXTRACTION_RULES}\nReturn strictly a JSON object with this schema:\n${EXTRACTION_SCHEMA}`,
      'Transcribe and extract the structured medical information from this document image.',
      { base64: fileBuffer.toString('base64'), mimeType }
    );

    if (parsed && (parsed.raw_text_summary || parsed.medications)) {
      structuredData = normalize(parsed);
      rawText = parsed.raw_text_summary || '';
      engine = GEMINI_VISION_MODEL;
      console.log('✅ Gemini vision OCR extracted the document.');
    }
  }

  // ---- Engine 2: Tesseract OCR + Groq text structuring ----
  if (!structuredData) {
    try {
      console.log('🔤 Running Tesseract.js OCR fallback...');
      const worker = await createWorker('eng');
      const ret = await worker.recognize(fileBuffer);
      rawText = ret.data.text || '';
      await worker.terminate();
      console.log(`📝 Tesseract extracted ${rawText.length} characters.`);
    } catch (tErr) {
      console.warn('Tesseract OCR error:', tErr.message);
    }

    if (rawText.trim().length >= 20 && groq) {
      try {
        const response = await groq.chat.completions.create({
          model: GROQ_TEXT_MODEL,
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: `${EXTRACTION_RULES}\nYou receive raw OCR text (may contain OCR noise). Return strictly a JSON object with this schema:\n${EXTRACTION_SCHEMA}`
            },
            { role: 'user', content: `Raw OCR text:\n${rawText}` }
          ]
        });

        const parsed = JSON.parse(response.choices[0].message.content);
        if (parsed) {
          structuredData = normalize(parsed);
          engine = `tesseract+${GROQ_TEXT_MODEL}`;
          console.log('✅ Groq structured the Tesseract OCR text.');
        }
      } catch (llmErr) {
        console.warn('Groq text structuring failed:', llmErr.message);
      }
    }
  }

  // ---- Honest failure (no fabricated clinical data) ----
  if (!structuredData) {
    return extractionFailure(
      rawText.trim().length > 0
        ? 'Text was detected but could not be reliably structured. Please enter the details manually.'
        : 'The document could not be read automatically. Please enter the details manually.',
      rawText
    );
  }

  return {
    raw_text: rawText,
    extracted_data: structuredData,
    ocr_engine: engine,
    confidence: engine === GEMINI_VISION_MODEL ? 0.9 : 0.7,
    needs_manual_entry: false
  };
};

function normalize(parsed) {
  return {
    document_type: parsed.document_type || 'other',
    date: parsed.date || 'Unknown',
    doctor_name: parsed.doctor_name || 'Unknown',
    patient_name: parsed.patient_name || 'Unknown',
    medications: Array.isArray(parsed.medications) ? parsed.medications : [],
    medical_history_conditions: Array.isArray(parsed.medical_history_conditions) ? parsed.medical_history_conditions : [],
    allergies_noted: Array.isArray(parsed.allergies_noted) ? parsed.allergies_noted : [],
    diagnosis_notes: parsed.diagnosis_notes || '',
    raw_text_summary: parsed.raw_text_summary || ''
  };
}

function extractionFailure(message, rawText = '') {
  console.warn(`⚠️ OCR extraction failed: ${message}`);
  return {
    raw_text: rawText,
    extracted_data: {
      document_type: 'other',
      date: 'Unknown',
      doctor_name: 'Unknown',
      patient_name: 'Unknown',
      medications: [],
      medical_history_conditions: [],
      allergies_noted: [],
      diagnosis_notes: '',
      raw_text_summary: '',
      extraction_error: message
    },
    ocr_engine: 'none',
    confidence: 0,
    needs_manual_entry: true
  };
}
