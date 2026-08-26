import { runFullPatientAssessment } from '../services/aiOrchestrator.js';
import { transcribeAndExtractSymptoms } from '../services/speechService.js';
import { processMedicalDocument } from '../services/ocrService.js';
import { analyzeInjuryImage } from '../services/visionService.js';
import { calculateRiskLevel } from '../services/riskEngine.js';
import { assertRuleSourced, formatMedicationLine } from '../services/formularyService.js';
import { supabaseAdmin } from '../config/supabase.js';
import { logAuditEvent } from '../middleware/audit.middleware.js';

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
        .select('id, patient_id, chief_complaint, preferred_consultation_language, status')
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
      medical_history: medical_history || visit.medical_history || 'No known chronic conditions',
      allergies: visit.allergies || 'None',
      ...visit
    };

    const targetPatientId = patient_id || visit.patient_id;
    if (targetPatientId) {
      try {
        const { data: pData } = await supabaseAdmin.from('patients').select('*').eq('id', targetPatientId).single();
        if (pData) {
          patient = { ...pData, ...patient };
          patient.name = patient.full_name || patient.name;
          patient.age = patient.age_years || patient.age;
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

    // HIGH / MEDIUM / LOW -> DB risk_level enum (high / medium / low)
    const safeRiskEnum = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low' }[aiResult.risk_level] || 'medium';

    // Attach stored image URLs to the raw output the doctor portal reads
    aiResult.stored_images = storedImages;

    const aiAssessmentRecord = {
      visit_id: visit_id,
      model_provider: String(aiResult.generated_by || '').startsWith('groq:') ? 'Groq' : 'RuleEngine',
      model_name: aiResult.generated_by || 'rule-engine-fallback',
      processing_status: 'completed',
      patient_summary: aiResult.patient_summary || 'Patient Assessment Summary',
      preliminary_assessment: aiResult.risk_reasoning || 'Preliminary clinical review',
      identified_symptoms: aiResult.key_symptoms || [],
      identified_risk_factors: aiResult.important_history || [],
      red_flags: aiResult.warnings || [],
      uncertainty_notes: (aiResult.missing_information || []).join('; ') || 'None noted',
      ai_raw_output: aiResult,
      completed_at: new Date().toISOString()
    };

    let savedAssessmentId = null;
    const { data: saved, error: assessErr } = await supabaseAdmin
      .from('ai_assessments')
      .insert([aiAssessmentRecord])
      .select()
      .single();
    if (assessErr) {
      console.error('ai_assessments insert FAILED:', assessErr.message);
    } else {
      savedAssessmentId = saved.id;
    }

    if (savedAssessmentId) {
      // Risk record
      const { error: riskErr } = await supabaseAdmin.from('ai_risk_assessments').insert([{
        ai_assessment_id: savedAssessmentId,
        risk_level: safeRiskEnum,
        reason: aiResult.risk_reasoning || 'Clinical protocol evaluation',
        red_flags: aiResult.warnings || [],
        recommended_action: aiResult.recommended_next_action || 'DOCTOR_REVIEW'
      }]);
      if (riskErr) console.warn('ai_risk_assessments insert failed:', riskErr.message);

      // Individual recommendations for doctor approval workflow
      const recRows = [
        ...(aiResult.first_aid_steps || []).map((step, i) => ({
          ai_assessment_id: savedAssessmentId,
          recommendation_type: 'first_aid',
          title: `First-aid step ${i + 1}`,
          recommendation: step,
          status: 'ai_suggested'
        })),
        // Medication rows are built from the structured formulary output, never
        // from the rendered strings, so the originating rule travels with the
        // record. assertRuleSourced throws rather than persisting an orphan —
        // the database constraint in database/migrations/001 is the real
        // guarantee, this is the early and loud failure.
        ...assertRuleSourced(aiResult.medications || []).map((med) => ({
          ai_assessment_id: savedAssessmentId,
          recommendation_type: 'medicine',
          title: `${med.drug} [${med.rule_source_id}]`,
          recommendation: formatMedicationLine(med),
          safety_warning:
            med.signature_status === 'SIGNED'
              ? 'Subject to doctor approval. Not a prescription.'
              : 'UNSIGNED FORMULARY ENTRY — not reviewed by a registered practitioner. Not for clinical use.',
          status: 'ai_suggested'
        }))
      ];
      if (aiResult.immediate_referral) {
        recRows.push({
          ai_assessment_id: savedAssessmentId,
          recommendation_type: 'referral',
          title: 'Emergency hospital referral',
          recommendation: 'Life-threatening red flags detected. Arrange emergency ambulance transfer to the district hospital.',
          safety_warning: 'Time-critical. Alert the on-call doctor immediately.',
          status: 'ai_suggested'
        });
      }
      if (recRows.length > 0) {
        const { error: recErr } = await supabaseAdmin.from('ai_recommendations').insert(recRows);
        if (recErr) console.warn('ai_recommendations insert failed:', recErr.message);
      }
    }

    const { error: visitErr } = await supabaseAdmin.from('visits').update({
      status: 'awaiting_doctor',
      risk_level: safeRiskEnum,
      risk_reason: aiResult.risk_reasoning || 'AI protocol triage'
    }).eq('id', visit_id);
    if (visitErr) console.warn('visits risk update failed:', visitErr.message);

    logAuditEvent({
      actorId: req.user?.id,
      actorRole: req.user?.role,
      action: 'AI_ASSESSMENT_GENERATED',
      entityType: 'AI_ASSESSMENTS',
      entityId: savedAssessmentId,
      metadata: { visit_id, risk_level: aiResult.risk_level }
    });

    return res.json({
      assessment_id: savedAssessmentId,
      persisted: Boolean(savedAssessmentId),
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
