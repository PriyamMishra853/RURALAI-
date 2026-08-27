import { runFullPatientAssessment } from '../services/aiOrchestrator.js';
import { transcribeAndExtractSymptoms } from '../services/speechService.js';
import { processMedicalDocument } from '../services/ocrService.js';
import { analyzeInjuryImage } from '../services/visionService.js';
import { calculateRiskLevel } from '../services/riskEngine.js';
import { interpretLabReport } from '../services/labInterpretationService.js';
import { assertRuleSourced, formatMedicationLine } from '../services/formularyService.js';
import { supabaseAdmin } from '../config/supabase.js';
import { logAuditEvent } from '../middleware/audit.middleware.js';
import { ageFromDob } from '../services/patientFields.js';

export const transcribeSpeech = async (req, res) => {
  try {
    const { language = 'Hindi' } = req.body;
    const file = req.file;

    const result = await transcribeAndExtractSymptoms(file ? file.buffer : null, language);
    // ok:false means nothing usable was captured. It is returned as 200 with an
    // explicit reason rather than an error, because the assistant needs to see
    // why and retry — but the payload never carries a substitute transcript.
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: 'Speech transcription failed', details: error.message });
  }
};

export const analyzeDocumentAI = async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'File is required' });

    const result = await processMedicalDocument(file.buffer, file.originalname, file.mimetype);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: 'Document analysis failed', details: error.message });
  }
};

export const analyzePatientCase = async (req, res) => {
  try {
    const {
      visit_id,
      patient_id,
      visit_data,
      vitals_data,
      patient_data,
      symptoms,
      symptom_duration,
      medical_history,
      known_allergies,
      vitals: directVitals,
      verified_ocr_data,
      vision_observation
    } = req.body;

    if (!visit_id) return res.status(400).json({ error: 'visit_id is required' });

    console.log(`🤖 Starting AI Patient Assessment for Visit ID: ${visit_id}`);

    let visit = visit_data || {};
    let patient = patient_data || {};
    let vitals = vitals_data || directVitals || {};
    let verifiedDocs = verified_ocr_data ? [verified_ocr_data] : [];
    let imageObservations = vision_observation ? [vision_observation] : [];

    // Safe DB Fetching with robust Schema Cache Fallbacks
    try {
      const { data: vData } = await supabaseAdmin
        .from('visits')
        .select('id, patient_id, chief_complaint, symptom_duration, medical_history, known_allergies, current_medications, status')
        .eq('id', visit_id)
        .single();
      
      if (vData) {
        visit = { ...vData, ...visit };
      }
    } catch (e) {}

    // Merge direct body parameters into visit object
    visit = {
      id: visit_id,
      chief_complaint: symptoms || visit.chief_complaint || 'Acute Symptoms Review',
      symptoms: symptoms || visit.symptoms || 'High fever, dry cough',
      symptom_duration: symptom_duration || visit.symptom_duration || '3 days',
      medical_history: medical_history || visit.medical_history || 'None reported',
      allergies: known_allergies || visit.known_allergies || 'None reported',
      current_medications: visit.current_medications || 'None reported',
      ...visit
    };

    const targetPatientId = patient_id || visit.patient_id;
    if (targetPatientId) {
      try {
        const { data: pData } = await supabaseAdmin
          .from('patients')
          .select('aadhaar_number, full_name, gender, date_of_birth, village_line1, address_district')
          .eq('aadhaar_number', targetPatientId)
          .maybeSingle();
        if (pData) {
          patient = { ...pData, ...patient };
          patient.name = pData.full_name;
          // Age is derived, never stored — the triage rules key on it.
          patient.age = ageFromDob(pData.date_of_birth);
          patient.village = pData.village_line1;
        }
      } catch (e) {}
    }

    try {
      const { data: vtData } = await supabaseAdmin
        .from('visit_vitals')
        .select('*')
        .eq('visit_id', visit_id)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .single();
      if (vtData) vitals = { ...vtData, ...vitals };
    } catch (e) {}

    try {
      const { data: docs } = await supabaseAdmin
        .from('patient_documents')
        .select('*, document_extractions(*)')
        .eq('visit_id', visit_id);

      if (docs && docs.length > 0) {
        const dbDocs = docs.map(d => d.document_extractions?.[0]?.structured_data).filter(Boolean);
        verifiedDocs = [...verifiedDocs, ...dbDocs];
      }
    } catch (e) {}

    // Attach stored wound photos (public URLs). Their vision analysis arrives
    // via the vision_observation request field, since the live patient_images
    // table stores only the file reference.
    let storedImages = [];
    try {
      const { data: images } = await supabaseAdmin.from('patient_images').select('*').eq('visit_id', visit_id);
      if (images && images.length > 0) {
        storedImages = images.map((img) => {
          const { data: pub } = supabaseAdmin.storage.from(img.storage_bucket).getPublicUrl(img.storage_path);
          return { image_type: img.image_type, image_url: pub?.publicUrl || null, uploaded_at: img.uploaded_at };
        });
      }
    } catch (e) {}

    // Run Full AI Orchestrator Pipeline (Groq LLM + Qdrant RAG + Risk Safety Engine)
    const aiResult = await runFullPatientAssessment({
      patient: patient || {},
      visit: visit || {},
      vitals: vitals || {},
      verifiedDocuments: verifiedDocs,
      imageObservations: imageObservations
    });

    /*
     * Persist the assessment.
     *
     * v2 collapsed ai_assessments / ai_risk_assessments / ai_recommendations
     * into one table. The old code still wrote the v1 shape, so every insert
     * failed on a missing column and the assessment was returned to the screen
     * but never saved — the doctor's queue then had a case with no assessment
     * attached to it.
     */

    // The rule engine speaks HIGH/MEDIUM/LOW; the database enum is
    // low|moderate|high|emergency. 'medium' is NOT a valid value — writing it
    // was a silent insert failure.
    const RISK_TO_ENUM = { HIGH: 'high', MEDIUM: 'moderate', LOW: 'low', EMERGENCY: 'emergency' };
    const safeRiskEnum = RISK_TO_ENUM[String(aiResult.risk_level).toUpperCase()] || 'moderate';

    // An emergency referral is a distinct tier in the database even though the
    // rule engine reports it as HIGH + immediateReferral.
    const storedRisk = aiResult.immediate_referral ? 'emergency' : safeRiskEnum;

    aiResult.stored_images = storedImages;

    const { data: savedAssessment, error: assessErr } = await supabaseAdmin
      .from('ai_assessments')
      .insert([{
        visit_id,
        risk_level: storedRisk,
        patient_summary: aiResult.patient_summary || null,
        first_aid_steps: aiResult.first_aid_steps || [],
        protocol_matches: aiResult.protocol_matches || [],
        warnings: aiResult.warnings || [],
        missing_information: aiResult.missing_information || [],
        recommended_next_action: aiResult.recommended_next_action || 'DOCTOR_REVIEW',
        requires_doctor: aiResult.requires_doctor !== false,
        generated_by: aiResult.generated_by || 'rule-engine-fallback'
      }])
      .select()
      .single();

    if (assessErr) {
      // Loud, not silent: an assessment the doctor cannot retrieve is worse
      // than no assessment, because the queue still shows the case as assessed.
      console.error('ai_assessments insert FAILED:', assessErr.message);
    }

    // Medication suggestions are validated even though they are not persisted
    // as separate rows in v2 — assertRuleSourced throws on any entry that is
    // not traceable to a formulary rule, and that check must not be skipped
    // just because the storage shape changed.
    try {
      assertRuleSourced(aiResult.medications || []);
    } catch (medErr) {
      console.error('Formulary rule-source check failed:', medErr.message);
      aiResult.medications = [];
      aiResult.warnings = [
        ...(aiResult.warnings || []),
        'Medication suggestions were withheld: they could not be traced to a signed formulary rule.'
      ];
    }

    const { error: visitErr } = await supabaseAdmin.from('visits').update({
      status: 'awaiting_doctor',
      risk_level: storedRisk
    }).eq('id', visit_id);
    if (visitErr) console.warn('visits risk update failed:', visitErr.message);

    logAuditEvent({
      actorId: req.user?.id,
      actorRole: req.user?.role,
      action: 'AI_ASSESSMENT_GENERATED',
      entityType: 'AI_ASSESSMENTS',
      entityId: savedAssessment?.id || null,
      metadata: { visit_id, risk_level: aiResult.risk_level }
    });

    return res.json({
      assessment_id: savedAssessment?.id || null,
      persisted: Boolean(savedAssessment?.id),
      visit_id,
      ...aiResult
    });

  } catch (error) {
    console.error('AI Assessment error:', error.message);
    return res.status(500).json({ error: 'AI patient assessment failed', details: error.message });
  }
};

export const getRiskAssessment = async (req, res) => {
  try {
    const { vitals = {}, symptoms = '', history = '' } = req.body;
    const result = calculateRiskLevel(vitals, symptoms, history);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: 'Risk calculation failed', details: error.message });
  }
};

export const analyzeImageAI = async (req, res) => {
  try {
    const { patient_id, visit_id } = req.body;
    const file = req.file;

    const observation = await analyzeInjuryImage(file ? file.buffer : null, file ? file.mimetype : 'image/jpeg');

    let finalImageUrl = observation.image_url;

    if (patient_id && file) {
      const fileName = `${Date.now()}_${file.originalname.replace(/\s+/g, '_')}`;
      const storagePath = `injuries/${patient_id}/${fileName}`;

      // Upload actual file binary to Supabase Storage bucket 'injury-photos'
      try {
        await supabaseAdmin.storage
          .from('injury-photos')
          .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: true });

        const { data: pubUrlData } = supabaseAdmin.storage.from('injury-photos').getPublicUrl(storagePath);
        if (pubUrlData?.publicUrl) {
          finalImageUrl = pubUrlData.publicUrl;
        }
      } catch (stgErr) {
        console.warn('Supabase Storage injury-photos upload warning:', stgErr.message);
      }

      // Persist the file reference (live schema stores only file metadata;
      // the vision analysis JSON travels with the AI assessment record)
      const { error: imgErr } = await supabaseAdmin.from('patient_images').insert([{
        patient_id,
        visit_id: visit_id || null,
        storage_bucket: 'injury-photos',
        storage_path: storagePath,
        image_type: 'INJURY',
        mime_type: file.mimetype
      }]);
      if (imgErr) console.warn('patient_images insert failed:', imgErr.message);
    }

    return res.json({
      ...observation,
      image_url: finalImageUrl || observation.image_url
    });

  } catch (error) {
    console.error('Injury image analysis error:', error.message);
    return res.status(500).json({ error: 'Injury image analysis failed', details: error.message });
  }
};

/**
 * POST /api/ai/interpret-report
 *
 * Second-step interpretation of an already-transcribed lab report. The OCR
 * pipeline only transcribes what is printed; this reasons about what the
 * transcribed values mean together, so an assistant reviewing a report sees
 * more than a table of numbers with no read on what they suggest.
 */
export const interpretReport = async (req, res) => {
  try {
    const { document_id, visit_id, lab_data } = req.body || {};
    if (!lab_data || typeof lab_data !== 'object') {
      return res.status(400).json({ error: 'lab_data (the extracted panels) is required.' });
    }

    let context = {};
    if (visit_id) {
      const { data: visit } = await supabaseAdmin
        .from('visits')
        .select('chief_complaint, patient_id')
        .eq('id', visit_id)
        .maybeSingle();
      if (visit) {
        context.chief_complaint = visit.chief_complaint;
        const { data: patient } = await supabaseAdmin
          .from('patients').select('date_of_birth, gender')
          .eq('aadhaar_number', visit.patient_id).maybeSingle();
        if (patient) {
          context.age = ageFromDob(patient.date_of_birth);
          context.gender = patient.gender;
        }
      }
    }

    const interpretation = await interpretLabReport(lab_data, context);

    await logAuditEvent({
      actorId: req.user.id, actorRole: req.user.role,
      action: 'LAB_REPORT_INTERPRETED', entityType: 'PATIENT_DOCUMENTS',
      entityId: document_id, metadata: { engine: interpretation.engine }, ip: req.ip
    });

    return res.json(interpretation);
  } catch (error) {
    console.error('Lab interpretation error:', error.message);
    return res.status(500).json({ error: 'Lab report interpretation failed.' });
  }
};
