import { supabaseAdmin } from '../config/supabase.js';
import { processMedicalDocument } from '../services/ocrService.js';
import { logAuditEvent } from '../middleware/audit.middleware.js';
import { AADHAAR_RE, digitsOnly } from '../services/patientFields.js';

/**
 * Document upload and OCR.
 *
 * One upload may carry several files, because one document often is several
 * files: pages 1..N of a lab report, or the front and back of a prescription.
 * They are read together in a single model call so cross-page context survives.
 */

const DOC_TYPES = ['prescription', 'lab_report', 'abha_card', 'discharge_summary', 'other'];

export const uploadDocument = async (req, res) => {
  try {
    const { aadhaar_number, visit_id, document_type = 'prescription' } = req.body;

    const files = (req.files?.length ? req.files : (req.file ? [req.file] : []));
    if (!files.length) {
      return res.status(400).json({ error: 'At least one file is required.' });
    }

    const aadhaar = digitsOnly(aadhaar_number);
    if (!AADHAAR_RE.test(aadhaar)) {
      return res.status(400).json({ error: 'A 12-digit Aadhaar number is required to attach a document.' });
    }

    const kind = DOC_TYPES.includes(String(document_type).toLowerCase())
      ? String(document_type).toLowerCase()
      : 'other';

    // The patient must be on this clinic's register.
    const { data: patient } = await supabaseAdmin
      .from('patients')
      .select('aadhaar_number')
      .eq('aadhaar_number', aadhaar)
      .eq('clinic_district_id', req.user.districtId)
      .maybeSingle();
    if (!patient) return res.status(404).json({ error: 'No such patient at this clinic.' });

    // Read all pages as one document.
    const result = await processMedicalDocument(files, kind);

    const { data: doc, error } = await supabaseAdmin
      .from('patient_documents')
      .insert([{
        patient_id: aadhaar,
        visit_id: visit_id || null,
        document_type: kind,
        mime_type: files[0].mimetype,
        ocr_text: result.raw_text || null,
        extracted_data: result.extracted_data || {},
        uploaded_by: req.user.id
      }])
      .select()
      .single();

    if (error) {
      console.error('document insert failed:', error.message);
      return res.status(500).json({ error: 'The document could not be saved.' });
    }

    await logAuditEvent({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'DOCUMENT_UPLOADED',
      entityType: 'PATIENT_DOCUMENTS',
      entityId: doc.id,
      metadata: {
        document_type: kind,
        files: files.length,
        pages_read: result.extracted_data?.pages_read ?? 0,
        engine: result.ocr_engine
      },
      ip: req.ip
    });

    return res.status(201).json({
      document: doc,
      extraction: result.extracted_data,
      raw_ocr: result.raw_text,
      engine: result.ocr_engine,
      files_read: result.files_read,
      confidence: result.confidence,
      // Nothing from here reaches the clinical record until a human confirms it.
      needs_manual_entry: result.needs_manual_entry
    });
  } catch (error) {
    console.error('Document upload error:', error.message);
    return res.status(500).json({ error: 'Document upload failed.' });
  }
};

/**
 * POST /api/documents/:id/verify
 *
 * Mandatory human verification. The extraction is a draft until an assistant
 * confirms it; only then is it marked verified and allowed to reach the AI
 * assessment as source data.
 */
export const verifyDocumentExtraction = async (req, res) => {
  const { corrected_data } = req.body || {};
  if (!corrected_data || typeof corrected_data !== 'object') {
    return res.status(400).json({ error: 'corrected_data is required.' });
  }

  const { data: doc } = await supabaseAdmin
    .from('patient_documents')
    .select('id, patient_id')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!doc) return res.status(404).json({ error: 'No such document.' });

  const { data: patient } = await supabaseAdmin
    .from('patients')
    .select('aadhaar_number')
    .eq('aadhaar_number', doc.patient_id)
    .eq('clinic_district_id', req.user.districtId)
    .maybeSingle();
  if (!patient) return res.status(404).json({ error: 'That document belongs to another clinic.' });

  const { data, error } = await supabaseAdmin
    .from('patient_documents')
    .update({
      extracted_data: corrected_data,
      verified_by: req.user.id,
      verified_at: new Date().toISOString()
    })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: 'The verification could not be saved.' });

  await logAuditEvent({
    actorId: req.user.id, actorRole: req.user.role,
    action: 'DOCUMENT_EXTRACTION_VERIFIED', entityType: 'PATIENT_DOCUMENTS',
    entityId: req.params.id, ip: req.ip
  });

  return res.json({ document: data, verified: true });
};

/** GET /api/documents?visit_id=... — documents attached to one visit. */
export const listDocuments = async (req, res) => {
  const { visit_id } = req.query;
  if (!visit_id) return res.status(400).json({ error: 'visit_id is required.' });

  const { data: visit } = await supabaseAdmin
    .from('visits').select('id')
    .eq('id', visit_id)
    .eq('district_id', req.user.districtId)
    .maybeSingle();
  if (!visit) return res.status(404).json({ error: 'No such visit at this clinic.' });

  const { data } = await supabaseAdmin
    .from('patient_documents')
    .select('id, document_type, extracted_data, verified_at, created_at')
    .eq('visit_id', visit_id)
    .order('created_at', { ascending: false });

  return res.json({ documents: data || [] });
};
