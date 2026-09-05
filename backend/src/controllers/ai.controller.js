import fs from 'fs';
import path from 'path';
import { probeInferenceService } from '../services/aiInferenceClient.js';
import { runFullPatientAssessment } from '../services/aiOrchestrator.js';
import { transcribeAndExtractSymptoms, translateForSpeech } from '../services/speechService.js';
import { processMedicalDocument } from '../services/ocrService.js';
import { analyzeInjuryImage } from '../services/visionService.js';
import { calculateRiskLevel } from '../services/riskEngine.js';
import { interpretLabReport } from '../services/labInterpretationService.js';
import { assertRuleSourced, formatMedicationLine } from '../services/formularyService.js';
import { supabaseAdmin } from '../config/supabase.js';
import { logAuditEvent } from '../middleware/audit.middleware.js';
import { ageFromDob } from '../services/patientFields.js';
import { buildTierWorkflow } from '../services/tierWorkflowService.js';
import { signedImageUrl } from '../services/imageAccess.js';

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

    // Attach stored wound photos, with the observation recorded when each was
    // taken. This used to read `image_type` and `uploaded_at`, neither of which
    // exists on the table — the same mismatch that stopped the rows being
    // written in the first place.
    let storedImages = [];
    try {
      const { data: images } = await supabaseAdmin
        .from('patient_images')
        .select('id, storage_bucket, storage_path, image_url, observation, severity_impression, engine, created_at')
        .eq('visit_id', visit_id);

      if (images?.length) {
        // Signed on demand: the bucket is private, so there is no stored link
        // to hand out. Done in parallel — one round trip each, and a case can
        // carry several photographs.
        storedImages = await Promise.all(images.map(async (img) => ({
          image_url: await signedImageUrl(img.storage_path, img.storage_bucket || 'injury-photos'),
          observation: img.observation || null,
          severity_impression: img.severity_impression || null,
          engine: img.engine || null,
          created_at: img.created_at
        })));
      }
    } catch (err) {
      console.warn('stored wound photos could not be loaded:', err.message);
    }

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
      ...aiResult,
      // §3.6 — the tier decides what happens next, and each tier has its own
      // defined output set. Built here so a single /assess call gives the
      // frontend everything it needs to render the correct screen.
      workflow: await buildTierWorkflow({
        assessment: aiResult,
        patient,
        visit,
        districtName: patient?.address_district || null
      })
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
    const { visit_id } = req.body;
    const file = req.file;

    const observation = await analyzeInjuryImage(file ? file.buffer : null, file ? file.mimetype : 'image/jpeg');

    let finalImageUrl = observation.image_url;

    /*
     * Which patient this photograph belongs to comes from the visit, not the
     * request body.
     *
     * The screen only ever sends visit_id, and this used to read patient_id
     * from the body and skip the entire storage block when it was absent —
     * which was always. Three separate failures were stacked here and each was
     * caught and warned: the bucket did not exist, patient_id was never sent,
     * and the insert named a column the table does not have. The photograph was
     * analysed, displayed once, and dropped.
     *
     * Deriving it from the visit also removes the client's ability to attach a
     * photograph to a patient other than the one whose visit it is, and the
     * lookup is scoped to the caller's district so a visit id from elsewhere
     * resolves to nothing.
     */
    let patientId = null;
    if (visit_id) {
      const { data: visit } = await supabaseAdmin
        .from('visits')
        .select('patient_id')
        .eq('id', visit_id)
        .eq('district_id', req.user.districtId)
        .is('deleted_at', null)
        .maybeSingle();
      patientId = visit?.patient_id || null;
    }

    if (patientId && file) {
      const fileName = `${Date.now()}_${file.originalname.replace(/\s+/g, '_')}`;
      const storagePath = `injuries/${patientId}/${fileName}`;

      // The bucket is private: these are clinical photographs of identifiable
      // patients, and a public URL would be viewable by anyone holding it,
      // indefinitely, with no authentication. Readers mint short-lived signed
      // URLs instead — see signedImageUrl.
      const { error: upErr } = await supabaseAdmin.storage
        .from('injury-photos')
        .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: true });

      if (upErr) {
        console.error('injury-photos upload FAILED — the doctor will not see this photo:', upErr.message);
      } else {
        finalImageUrl = await signedImageUrl(storagePath);
      }

      /*
       * Persist the photograph AND the reading of it.
       *
       * This insert had been failing on every wound photo ever taken. It wrote
       * `image_type`, a column the live table does not have, so Postgres
       * rejected the row — and the failure was a console.warn, so the request
       * still returned the analysis, the screen still showed it, and the table
       * stayed empty. The doctor's case view had nothing to display, which read
       * as the images "not reaching the doctor" rather than never being stored.
       *
       * The observation is stored alongside the file rather than left to travel
       * with the assessment. It is what the doctor actually reads, and
       * re-running the vision model on an old photo would cost money and could
       * return something different.
       */
      const { error: imgErr } = await supabaseAdmin.from('patient_images').insert([{
        patient_id: patientId,
        visit_id: visit_id || null,
        storage_bucket: 'injury-photos',
        storage_path: storagePath,
        // Deliberately not the signed URL: it expires, and a stored link that
        // silently stops working is worse than none. storage_path is the
        // durable reference and readers sign it on demand.
        image_url: null,
        mime_type: file.mimetype,
        observation: observation || {},
        severity_impression: ['LOW', 'MEDIUM', 'HIGH'].includes(observation?.severity_impression)
          ? observation.severity_impression
          : null,
        engine: observation?.engine || null,
        uploaded_by: req.user?.id || null
      }]);

      // Loud, not a warning. A photograph the doctor cannot see is the whole
      // point of having taken it, and the previous warning hid this for the
      // lifetime of the feature.
      if (imgErr) {
        console.error('patient_images insert FAILED — the doctor will not see this photo:', imgErr.message);
      }
    }

    /*
     * The photograph is never echoed back.
     *
     * analyzeInjuryImage builds a `data:` URI so it can hand the bytes to the
     * vision model, and that URI was travelling all the way back to the phone:
     * of a 1,056,003-byte response, 1,054,346 bytes were the image the device
     * had just finished uploading. It re-sent a megabyte down a rural link to
     * show the health worker a picture their own camera roll already holds --
     * the screen previews the local file and never reads this field.
     *
     * A signed URL is returned when the file reached storage, and null when it
     * did not. Null is honest: it means the doctor's case view will have
     * nothing to show, which is a real problem worth surfacing rather than
     * papering over with a copy that lives only in this response.
     */
    return res.json({
      ...observation,
      image_url: finalImageUrl || null
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

/**
 * GET /api/ai/service-status — is the inference service actually up?
 *
 * The service listens on loopback inside the API container, which is correct —
 * it has no authentication of its own — but it also means nothing outside can
 * tell whether it is running. Until this existed, confirming a deploy meant
 * reading container logs, and a silent failure looked exactly like a working
 * system producing worse answers.
 *
 * Authenticated, because it names internal addresses. Returns no patient data.
 */
export const getAiServiceStatus = async (req, res) => {
  const probe = await probeInferenceService();

  /*
   * When it is unreachable, say which failure this is.
   *
   * "fetch failed" is the same message whether the dependencies never
   * installed or the process started and crashed, and those need opposite
   * fixes. The virtualenv's presence separates them: build-ai.sh deletes it on
   * a failed install, so absent means the build could not resolve the
   * requirements, and present means uvicorn itself did not survive startup.
   */
  let diagnosis;
  if (!probe.reachable) {
    // The container is Linux; the Windows path keeps this honest when the same
    // check runs locally, so a diagnosis is never wrong about which failure
    // this is.
    const venvPresent = ['../AI/LLM/.venv/bin/python', 'AI/LLM/.venv/bin/python',
                         '../AI/LLM/.venv/Scripts/python.exe', 'AI/LLM/.venv/Scripts/python.exe']
      .some((rel) => fs.existsSync(path.resolve(process.cwd(), rel)));

    let log = null;
    try {
      const logPath = process.env.AI_SERVICE_LOG || '/tmp/ai-service.log';
      if (fs.existsSync(logPath)) {
        log = fs.readFileSync(logPath, 'utf8').trim().split('\n').slice(-12).join('\n');
      }
    } catch { /* the log is a convenience, never a requirement */ }

    diagnosis = {
      venv_present: venvPresent,
      cause: venvPresent
        ? 'Dependencies installed but the service is not listening — it failed at startup.'
        : 'The virtualenv is absent, so the build could not install the dependencies.',
      service_log_tail: log
    };
  }

  return res.json({
    ...probe,
    ...(diagnosis ? { diagnosis } : {}),
    // Said plainly, because the whole point is that the degraded mode is
    // otherwise invisible: assessments still render without it.
    retrieval: probe.reachable
      ? 'Symptom retrieval and precautions are active.'
      : 'Unavailable — assessments are running on the rule engine alone.'
  });
};

/**
 * POST /api/voice/translate  { text, target }
 *
 * Translates generated assessment text so the read-aloud control can play it
 * back in the patient's language. Never a general translation endpoint — see
 * translateForSpeech for why the prompt is written the way it is.
 *
 * A failure returns 200 with the original text and a reason, because the
 * assistant should still be able to read something aloud. An error here would
 * leave them with a silent button and no explanation.
 */
export const translateSpeechText = async (req, res) => {
  const { text, target = 'Hindi' } = req.body || {};
  const result = await translateForSpeech(text, target);
  return res.json(result);
};
