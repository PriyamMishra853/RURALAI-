import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Mic, Upload, FileText, Camera, Bot, ShieldCheck, ArrowRight, CheckCircle2, AlertTriangle, Activity, User, HeartPulse, RefreshCw, BookOpen, AlertOctagon, Download, Pill, PhoneCall, ArrowLeft, MicOff, Globe, Video, Send, ShieldAlert, Printer, Calendar, Trash2 } from 'lucide-react';
import api from '../services/api';
import RiskBadge from '../components/RiskBadge';
import OCRVerificationModal from '../components/OCRVerificationModal';
import ScheduleConsultationModal from '../components/ScheduleConsultationModal';
import DoctorSelectGrid from '../components/DoctorSelectGrid';
import { useAuth } from '../context/AuthContext';
import DemoBadge from '../components/DemoBadge';
import { maskAadhaar } from '../config/patientFields';
import FileCaptureInput from '../components/FileCaptureInput';
import {
  VITAL_FIELDS, MEASURED_FIELDS, defaultVitals, validateVitals, isAbnormal
} from '../config/vitals';
import TierResult from '../components/TierResult';
import DoctorReviewPanel from '../components/DoctorReviewPanel';

export default function PatientAssessmentVisitPage() {
  const { id: patientId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [patient, setPatient] = useState(null);
  const [visitId, setVisitId] = useState(null);

  // Tab states
  const [activeTab, setActiveTab] = useState('symptoms');

  // Symptoms & Voice Input
  const [symptomsText, setSymptomsText] = useState('');
  // Duration as a number plus a unit, not free text: "2" is meaningless and
  // "a while" cannot be reasoned about by the triage rules.
  const [durationValue, setDurationValue] = useState('');
  const [durationUnit, setDurationUnit] = useState('days');
  const [medicalHistory, setMedicalHistory] = useState('');
  const [knownAllergies, setKnownAllergies] = useState('');
  const [recording, setRecording] = useState(false);
  const [detectedLanguage, setDetectedLanguage] = useState('Auto-detect');

  // Video call & scheduling
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [pushingToDoctor, setPushingToDoctor] = useState(false);
  const [pushSuccess, setPushSuccess] = useState(false);
  /** The server's manifest of what the doctor received. */
  const [handoffResult, setHandoffResult] = useState(null);
  const [withdrawing, setWithdrawing] = useState(false);
  // Doctor selected by the assistant for case handoff / calls (core feature)
  const [selectedDoctor, setSelectedDoctor] = useState(null);

  // Real Microphone Recording Refs
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recognitionRef = useRef(null);

  // Vitals with strict clinical range validation (entered by the assistant)
  // Pre-filled with typical adult values; the assistant alters what differs.
  const [vitals, setVitals] = useState(defaultVitals);
  const [vitalsError, setVitalsError] = useState(null);
  const [vitalErrors, setVitalErrors] = useState({});
  // Which fields the assistant actually touched, so an assessment cannot run
  // silently on six untouched defaults.
  const [confirmedVitals, setConfirmedVitals] = useState(() => new Set());

  // Documents & OCR
  // Three separate batches — a prescription, a multi-page lab report, and
  // wound photos are read with different prompts and must not be mixed.
  const [prescriptionFiles, setPrescriptionFiles] = useState([]);
  const [reportFiles, setReportFiles] = useState([]);
  const [woundFiles, setWoundFiles] = useState([]);
  const [uploadingReport, setUploadingReport] = useState(false);
  const [reportExtraction, setReportExtraction] = useState(null);
  const [documentFile, setDocumentFile] = useState(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [uploadedDocuments, setUploadedDocuments] = useState([]);
  const [showOCRModal, setShowOCRModal] = useState(false);
  const [currentDocument, setCurrentDocument] = useState(null);
  const [verifiedOCRData, setVerifiedOCRData] = useState(null);

  // Image & Computer Vision Surface Observation
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [visionObservation, setVisionObservation] = useState(null);
  const [visionObservations, setVisionObservations] = useState([]);

  // AI Assessment Result
  const [loadingAI, setLoadingAI] = useState(false);
  const [aiAssessment, setAiAssessment] = useState(null);
  const [apiError, setApiError] = useState(null);

  useEffect(() => {
    fetchPatientAndVisit();
  }, [patientId]);

  const fetchPatientAndVisit = async () => {
    try {
      // Aadhaar is the key and travels in the body, never the URL.
      const pRes = await api.post('/patients/detail', { aadhaar_number: patientId });
      setPatient(pRes.data);
    } catch (err) {
      console.error('Error fetching patient:', err);
    }
  };

  // The visit record is created once, with the real complaint and vitals,
  // the first time it is needed (document upload or AI assessment).
  const ensureVisit = async () => {
    if (visitId) return visitId;
    const vRes = await api.post('/visits', {
      // The patient key is the Aadhaar number, not a patient_code — sending
      // the old field is what produced "A 12-digit Aadhaar number is required".
      aadhaar_number: patientId,
      chief_complaint: symptomsText || 'Clinical assessment visit',
      symptoms: symptomsText ? [symptomsText] : [],
      symptom_duration_value: durationValue || null,
      symptom_duration_unit: durationUnit,
      medical_history: medicalHistory || null,
      known_allergies: knownAllergies || null,
      vitals
    });
    setVisitId(vRes.data.id);
    return vRes.data.id;
  };

  // Vitals still sitting at their pre-filled default, i.e. never confirmed
  // against the patient in front of the assistant.
  const untouchedVitals = VITAL_FIELDS.filter((f) => !confirmedVitals.has(f.key));

  const handleVitalsChange = (field, value) => {
    setVitals((prev) => ({ ...prev, [field]: value }));
    setConfirmedVitals((prev) => new Set(prev).add(field));
    setVitalErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  const validateVitalsBounds = () => {
    const { errors, message } = validateVitals(vitals);
    setVitalErrors(errors);
    return message;
  };

  const handleStartVoiceRecording = async () => {
    try {
      audioChunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorderRef.current.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('audio', audioBlob, 'speech.webm');
        formData.append('language', 'Hindi');

        try {
          const res = await api.post('/voice/transcribe', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
          });
          if (res.data.transcript) {
            setSymptomsText(res.data.transcript);
            setDetectedLanguage(res.data.detected_language || 'Detected');
          } else if (res.data.reason) {
            // Never leave the assistant guessing. The backend deliberately
            // returns no transcript rather than a plausible substitute, so the
            // symptom field stays untouched and the reason is shown instead.
            setDetectedLanguage(res.data.reason);
          }
        } catch (err) {
          console.warn('Voice API fallback to SpeechRecognition:', err.message);
        }
      };

      mediaRecorderRef.current.start();
      setRecording(true);

      if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = true;
        recognitionRef.current.interimResults = true;
        recognitionRef.current.lang = 'hi-IN';

        recognitionRef.current.onresult = (event) => {
          let current = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            current += event.results[i][0].transcript;
          }
          if (current) {
            setSymptomsText(current);
            setDetectedLanguage('Hindi / Regional');
          }
        };

        recognitionRef.current.start();
      }

    } catch (err) {
      alert('Microphone permission required for voice recording.');
    }
  };

  const handleStopVoiceRecording = () => {
    setRecording(false);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (e) {}
    }
  };

  /**
   * Read one document, which may be several files that belong together —
   * pages 1..N of a lab report, or the front and back of a prescription. They
   * go up in one request so the model keeps cross-page context.
   */
  const uploadDocumentBatch = async (files, documentType, { setBusy, onDone }) => {
    if (!files.length) return;
    setBusy(true);
    try {
      const vId = await ensureVisit();
      const formData = new FormData();
      files.forEach((f) => formData.append('files', f));
      formData.append('aadhaar_number', patientId);
      formData.append('visit_id', vId);
      formData.append('document_type', documentType);

      const res = await api.post('/documents/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      onDone(res.data);
    } catch (err) {
      console.error('Document upload error:', err);
      setApiError(formatApiError(err));
      alert('Document upload failed: ' + formatApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const handlePrescriptionUpload = () =>
    uploadDocumentBatch(prescriptionFiles, 'prescription', {
      setBusy: setUploadingDoc,
      onDone: (data) => {
        setUploadedDocuments((prev) => [...prev, data.document]);
        // Nothing reaches the clinical record until a human confirms it.
        setCurrentDocument({
          id: data.document.id,
          ocr_data: data.extraction || {},
          raw_text: data.raw_ocr || ''
        });
        setShowOCRModal(true);
        if (data.needs_manual_entry) {
          alert('The prescription could not be read automatically. Enter the details manually in the verification window.');
        }
      }
    });

  const handleReportUpload = () =>
    uploadDocumentBatch(reportFiles, 'lab_report', {
      setBusy: setUploadingReport,
      onDone: (data) => {
        setUploadedDocuments((prev) => [...prev, data.document]);
        setReportExtraction({ ...data.extraction, _engine: data.engine, _files: data.files_read });
        setCurrentDocument({
          id: data.document.id,
          ocr_data: data.extraction || {},
          raw_text: data.raw_ocr || ''
        });
        setShowOCRModal(true);
      }
    });

  const handleWoundUpload = async () => {
    if (!woundFiles.length) return;
    setUploadingImage(true);
    setImagePreview(URL.createObjectURL(woundFiles[0]));
    try {
      const vId = await ensureVisit();
      // Vision reads one photograph at a time — each is a separate observation,
      // and merging them would let one clear shot mask an unreadable one.
      const results = [];
      for (const file of woundFiles) {
        const formData = new FormData();
        formData.append('image', file);
        formData.append('visit_id', vId);
        const res = await api.post('/vision/analyze', formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        results.push(res.data);
      }
      setVisionObservations(results);
      // The highest severity across the photos is what the assessment sees.
      const rank = { LOW: 0, MEDIUM: 1, HIGH: 2 };
      setVisionObservation(
        results.reduce((worst, r) => (rank[r.severity_impression] > rank[worst.severity_impression] ? r : worst), results[0])
      );
    } catch (err) {
      console.error('Vision upload error:', err);
      setApiError(formatApiError(err));
      alert('Wound photo analysis failed: ' + formatApiError(err));
    } finally {
      setUploadingImage(false);
    }
  };

  const formatApiError = (err) => {
    if (!err) return 'Unknown error';
    if (err.response) {
      return `[HTTP ${err.response.status} on ${err.config?.url}]: ${err.response.data?.error || err.response.data?.message || err.response.statusText}`;
    }
    if (err.request) {
      return `[Network Error on ${err.config?.url}]: Server did not respond. Check backend daemon.`;
    }
    return err.message || String(err);
  };

  const handleRunAIAssessment = async () => {
    if (!symptomsText.trim()) {
      setActiveTab('symptoms');
      alert('Enter the patient’s symptoms before generating the AI assessment.');
      return;
    }
    const error = validateVitalsBounds();
    if (error) {
      setVitalsError(error);
      setActiveTab('vitals');
      return;
    }
    setVitalsError(null);
    setLoadingAI(true);
    setApiError(null);

    try {
      const vId = await ensureVisit();
      const payload = {
        visit_id: vId,
        patient_id: patientId,
        symptoms: symptomsText,
        symptom_duration: durationValue ? `${durationValue} ${durationUnit}` : '',
        medical_history: medicalHistory,
        known_allergies: knownAllergies,
        vitals,
        verified_ocr_data: verifiedOCRData,
        vision_observation: visionObservation
      };

      const res = await api.post('/ai/assess', payload);
      setAiAssessment(res.data);
      setActiveTab('assessment');
    } catch (err) {
      console.error('AI Assessment Failed:', err);
      setApiError(formatApiError(err));
    } finally {
      setLoadingAI(false);
    }
  };

  /**
   * Hand the case to a doctor.
   *
   * This used to PATCH the visit directly and send the assessment's risk tier
   * back with it. The rule engine spells that tier MEDIUM and the database
   * spells it `moderate`, so the update was rejected for every medium-risk
   * case — the most common kind — and the button did nothing but show an
   * error. The tier is no longer sent at all: the server already stored the
   * right one when the assessment ran, and reads it from the visit.
   *
   * The response is a manifest of what the doctor will actually see, which is
   * what gets shown on success. "Case sent" on its own is what let cases with
   * nothing in them go unnoticed.
   */
  const handlePushCaseToDoctor = async () => {
    if (!selectedDoctor) {
      alert("Select a doctor first — the case will appear in that doctor's queue.");
      return;
    }
    setPushingToDoctor(true);
    setPushSuccess(false);
    setHandoffResult(null);
    try {
      const vId = await ensureVisit();
      const res = await api.post(`/visits/${vId}/handoff`, { doctor_id: selectedDoctor.id });
      setHandoffResult(res.data);
      setPushSuccess(true);
    } catch (err) {
      console.error('Failed to assign case to doctor:', err);
      const data = err.response?.data;
      // 422 means the case is empty; the server says exactly what is missing,
      // which is more useful than a generic failure.
      if (err.response?.status === 422 && data?.missing?.length) {
        alert(`${data.error}\n\nStill needed: ${data.missing.join(', ')}.`);
      } else {
        alert('Could not send the case to the doctor: ' + formatApiError(err));
      }
    } finally {
      setPushingToDoctor(false);
    }
  };

  /**
   * Withdraw an accidental entry.
   *
   * Confirmed before it is sent, because it removes a clinical record from the
   * patient's history — and the confirmation names the patient, since the
   * mistake this exists to correct is having opened the case on the wrong one.
   */
  const handleWithdrawVisit = async () => {
    if (!visitId) return;
    const name = patient?.full_name || 'this patient';
    if (!window.confirm(
      `Withdraw this case for ${name}?\n\n`
      + 'It will be removed from the patient\'s history. This cannot be done once the case has been sent to a doctor.'
    )) return;

    const reason = window.prompt('Why is it being withdrawn? (optional)') || '';

    setWithdrawing(true);
    try {
      await api.delete(`/visits/${visitId}`, { data: { reason } });
      navigate('/assistant/dashboard');
    } catch (err) {
      // 409 means a doctor is already involved; the server says which case
      // applies, and that message is more useful than a generic failure.
      alert(err.response?.data?.error || formatApiError(err));
    } finally {
      setWithdrawing(false);
    }
  };

  // Starting a consultation lives entirely in ScheduleConsultationModal, which
  // offers both the instant and scheduled paths and then routes to /call/:id.
  // A second entry point used to sit here; it had no button left, and it POSTed
  // /consultations without scheduled_start_time, which the API rejects.

  const generateCompletePDFReport = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${patient?.is_demo ? '[DEMO] ' : ''}Clinical Assessment Report - ${patient?.full_name || 'Patient'}</title>
        <style>
          body { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 30px; color: #0F172A; line-height: 1.5; font-size: 13px; }
          .header { text-align: center; border-bottom: 2px solid #2563EB; padding-bottom: 12px; margin-bottom: 20px; }
          .header h1 { margin: 0; color: #1E3A8A; font-size: 20px; text-transform: uppercase; }
          .header p { margin: 4px 0 0; color: #64748B; font-size: 11px; }
          .section { margin-bottom: 20px; border: 1px solid #E2E8F0; border-radius: 6px; padding: 14px; background: #FFFFFF; }
          .section-title { font-weight: bold; font-size: 13px; color: #1E3A8A; text-transform: uppercase; border-bottom: 1px solid #E2E8F0; padding-bottom: 6px; margin-bottom: 10px; }
          .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
          .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
          .field { font-size: 12px; }
          .label { font-weight: bold; color: #475569; }
          .value { color: #0F172A; }
          .demo-banner { border: 2px solid #B45309; background: #FFFBEB; color: #B45309; font-weight: bold; text-align: center; padding: 10px; margin-bottom: 16px; border-radius: 4px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; }
          .wound-img { max-width: 100%; max-height: 220px; object-fit: contain; border-radius: 4px; border: 1px solid #CBD5E1; }
          .warning-box { background: #FFFBEB; border: 1px solid #FCD34D; color: #78350F; padding: 10px; border-radius: 6px; font-size: 11px; margin-top: 10px; }
          .footer { text-align: center; font-size: 10px; color: #94A3B8; margin-top: 30px; border-top: 1px solid #E2E8F0; padding-top: 10px; }
        </style>
      </head>
      <body>
        ${patient?.is_demo ? `
        <div class="demo-banner">
          DEMONSTRATION RECORD — NOT A REAL PATIENT. This report is test data and must not be used for clinical care.
        </div>` : ''}

        <div class="header">
          <h1>Virtual Village Clinic — Official Clinical Visit Report</h1>
          <p>Generated on ${new Date().toLocaleString()} | Visit ID: ${visitId || 'N/A'}</p>
        </div>

        <div class="section">
          <div class="section-title">1. Patient Personal Details & Demographics</div>
          <div class="grid-3">
            <div class="field"><span class="label">Patient Name:</span> <span class="value">${patient?.full_name || patient?.name || 'N/A'}</span></div>
            <div class="field"><span class="label">Aadhaar:</span> <span class="value">${maskAadhaar(patient?.aadhaar_number)}</span></div>
            <div class="field"><span class="label">Age / Gender:</span> <span class="value">${patient?.age_display || (patient?.age_years ?? 'N/A') + ' yrs'} / ${patient?.gender || 'N/A'}</span></div>
            <div class="field"><span class="label">Village / Location:</span> <span class="value">${patient?.village || 'N/A'}</span></div>
            <div class="field"><span class="label">Contact Phone:</span> <span class="value">${patient?.phone || 'N/A'}</span></div>
            <div class="field"><span class="label">Attending Assistant:</span> <span class="value">${user?.name || 'Clinic Assistant'}</span></div>
          </div>
        </div>

        <div class="section">
          <div class="section-title">2. Recorded Clinical Vitals (With Units)</div>
          <div class="grid-3">
            <div class="field"><span class="label">Body Temperature:</span> <span class="value">${vitals.temperature ? vitals.temperature + ' °F' : 'Not recorded'}</span></div>
            <div class="field"><span class="label">Blood Pressure:</span> <span class="value">${vitals.blood_pressure_systolic ? `${vitals.blood_pressure_systolic}/${vitals.blood_pressure_diastolic || '?'} mmHg` : 'Not recorded'}</span></div>
            <div class="field"><span class="label">Pulse Rate:</span> <span class="value">${vitals.pulse ? vitals.pulse + ' bpm' : 'Not recorded'}</span></div>
            <div class="field"><span class="label">SpO2 Oxygen Saturation:</span> <span class="value">${vitals.spo2 ? vitals.spo2 + ' %' : 'Not recorded'}</span></div>
            <div class="field"><span class="label">Respiratory Rate:</span> <span class="value">${vitals.respiratory_rate ? vitals.respiratory_rate + ' /min' : 'Not recorded'}</span></div>
            <div class="field"><span class="label">Weight / Height:</span> <span class="value">${vitals.weight ? vitals.weight + ' kg' : '—'} / ${vitals.height ? vitals.height + ' cm' : '—'}</span></div>
          </div>
        </div>

        <div class="section">
          <div class="section-title">3. OCR-Extracted Prescription & Scanned Document Data</div>
          ${verifiedOCRData ? `
            <div class="field"><span class="label">Verified Medications:</span> <span class="value">${JSON.stringify(verifiedOCRData.medications || verifiedOCRData)}</span></div>
          ` : `
            <p style="color: #64748B;">No prescription document attached or verified during this visit.</p>
          `}
        </div>

        <div class="section">
          <div class="section-title">4. AI-Generated Clinical Summary & Guidance</div>
          <div class="field" style="margin-bottom: 8px;"><span class="label">Triage Risk Level:</span> <span class="value" style="font-weight: bold; color: #DC2626;">${aiAssessment?.risk_level || 'Not assessed'}</span></div>
          <div class="field" style="margin-bottom: 8px;"><span class="label">Patient Summary:</span> <p class="value" style="margin: 4px 0;">${aiAssessment?.patient_summary || aiAssessment?.summary || symptomsText}</p></div>
          ${aiAssessment?.first_aid_steps ? `
            <div class="field"><span class="label">First-Aid Guidance Steps:</span>
              <ul>${aiAssessment.first_aid_steps.map(s => `<li>${s}</li>`).join('')}</ul>
            </div>
          ` : ''}
        </div>

        ${imagePreview || visionObservation ? `
          <div class="section">
            <div class="section-title">5. Clinical Wound Photo & Computer Vision Surface Analysis</div>
            ${imagePreview ? `<div style="text-align: center; margin-bottom: 10px;"><img src="${imagePreview}" class="wound-img" /></div>` : ''}
            <div class="field"><span class="label">Computer Vision Observation:</span> <span class="value">${visionObservation?.cautious_summary || 'Surface observation logged.'}</span></div>
          </div>
        ` : ''}

        <div class="warning-box">
          <strong>Clinical Disclaimer:</strong> This document contains AI-assisted preliminary triage data. Final medical diagnosis and treatment decisions are reserved for the attending Registered Medical Doctor.
        </div>

        <div class="footer">
          Virtual Village Clinic AI System | MoHFW Protocol Compliant | Confidential Medical Record
        </div>

        <script>
          window.onload = function() { window.print(); }
        </script>
      </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  return (
    <div className="max-w-7xl mx-auto px-4 lg:px-8 py-8 space-y-6">
      
      {/* Header */}
      <div className="bg-surface-raised p-6 rounded-field border border-line shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/assistant/dashboard')} className="p-2 rounded-field bg-surface-sunken hover:bg-surface-sunken text-ink-muted transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-ink flex items-center gap-2">
              <Activity className="w-5 h-5 text-gov-600" /> Patient Assessment & AI Clinical Visit
            </h1>
            <p className="text-xs text-ink-muted">Digitize patient complaint, record vitals, upload documents/photos & generate AI assessment.</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Withdrawing an accidental entry. Only offered once a visit exists,
              and the server refuses it the moment a doctor is involved — so
              this is for "wrong patient, start again", not for undoing care. */}
          {visitId && !pushSuccess && (
            <button
              type="button"
              onClick={handleWithdrawVisit}
              disabled={withdrawing}
              className="px-3 py-2 rounded-field border border-tier-emergency/30 text-tier-emergency hover:bg-tier-emergencyBg disabled:opacity-50 text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              {withdrawing ? 'Withdrawing…' : 'Withdraw case'}
            </button>
          )}

          {patient && (
            <div className="flex items-center gap-3 bg-surface-sunken px-4 py-2 rounded-field border border-line">
              <div className="w-8 h-8 rounded-full bg-blue-100 text-gov-700 font-bold text-xs flex items-center justify-center">
                {patient.full_name?.substring(0, 2) || 'PT'}
              </div>
              <div>
                <div className="font-bold text-xs text-ink">
                  {patient.full_name || patient.name} <DemoBadge patient={patient} />
                </div>
                <div className="text-[11px] text-ink-muted font-mono">Aadhaar: {maskAadhaar(patient.aadhaar_number)}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-line bg-surface-raised px-4 rounded-field shadow-sm">
        <button
          onClick={() => setActiveTab('symptoms')}
          className={`py-3 px-4 font-semibold text-xs border-b-2 flex items-center gap-1.5 transition-colors ${activeTab === 'symptoms' ? 'border-blue-600 text-gov-600' : 'border-transparent text-ink-muted hover:text-ink'}`}
        >
          <Mic className="w-4 h-4" /> 1. Symptoms & Voice
        </button>
        <button
          onClick={() => setActiveTab('vitals')}
          className={`py-3 px-4 font-semibold text-xs border-b-2 flex items-center gap-1.5 transition-colors ${activeTab === 'vitals' ? 'border-blue-600 text-gov-600' : 'border-transparent text-ink-muted hover:text-ink'}`}
        >
          <HeartPulse className="w-4 h-4" /> 2. Vitals & Physical Signs
        </button>
        <button
          onClick={() => setActiveTab('documents')}
          className={`py-3 px-4 font-semibold text-xs border-b-2 flex items-center gap-1.5 transition-colors ${activeTab === 'documents' ? 'border-blue-600 text-gov-600' : 'border-transparent text-ink-muted hover:text-ink'}`}
        >
          <FileText className="w-4 h-4" /> 3. Documents & Photos
        </button>
        <button
          onClick={() => setActiveTab('assessment')}
          className={`py-3 px-4 font-semibold text-xs border-b-2 flex items-center gap-1.5 transition-colors ${activeTab === 'assessment' ? 'border-blue-600 text-gov-600' : 'border-transparent text-ink-muted hover:text-ink'}`}
        >
          <Bot className="w-4 h-4" /> 4. AI Assessment &amp; Doctor Handoff
        </button>
      </div>

      {/* TAB 1: SYMPTOMS & VOICE INPUT */}
      {activeTab === 'symptoms' && (
        <div className="bg-surface-raised p-6 rounded-field border border-line shadow-sm space-y-6">
          <div className="flex items-center justify-between border-b border-line pb-3">
            <h2 className="text-base font-bold text-ink flex items-center gap-2">
              <Mic className="w-5 h-5 text-gov-600" /> Patient Chief Complaint & Multilingual Voice Assistant
            </h2>
            <span className="text-xs bg-gov-50 text-gov-700 px-2.5 py-1 rounded border border-gov-200 font-semibold flex items-center gap-1">
              <Globe className="w-3.5 h-3.5" /> {detectedLanguage}
            </span>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-ink-muted mb-1">Chief Complaint & Symptoms (Hindi / English / Voice)</label>
              <div className="relative">
                <textarea
                  rows={4}
                  value={symptomsText}
                  onChange={(e) => setSymptomsText(e.target.value)}
                  className="w-full bg-surface-raised border border-line-strong rounded-field p-3 text-xs text-ink focus:border-gov-500 outline-none leading-relaxed"
                  placeholder="Record symptoms using microphone or type here..."
                />
                <button
                  type="button"
                  onClick={recording ? handleStopVoiceRecording : handleStartVoiceRecording}
                  className={`absolute bottom-3 right-3 px-3 py-1.5 rounded-field font-semibold text-xs flex items-center gap-1.5 shadow-sm transition-colors ${recording ? 'bg-tier-emergency text-white animate-pulse' : 'bg-gov-600 text-white hover:bg-gov-700'}`}
                >
                  {recording ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                  {recording ? 'Stop Recording' : 'Record Symptoms by Voice'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-ink-muted mb-1">
                  Symptom Duration <span className="text-tier-emergency">*</span>
                </label>
                {/* A number and a unit, not free text — "2" alone is
                    meaningless and the triage rules read this. */}
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="1"
                    max="999"
                    inputMode="numeric"
                    value={durationValue}
                    onChange={(e) => setDurationValue(e.target.value.replace(/\D/g, '').slice(0, 3))}
                    placeholder="e.g. 3"
                    aria-label="Symptom duration amount"
                    className="w-24 bg-surface-raised border border-line-strong rounded-field px-3 py-2 text-xs text-ink focus:border-gov-500 outline-none"
                  />
                  <div className="flex rounded-field border border-line-strong overflow-hidden">
                    {['days', 'months', 'years'].map((u) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => setDurationUnit(u)}
                        className={`px-3 py-2 text-xs font-semibold capitalize transition-colors ${
                          durationUnit === u
                            ? 'bg-gov-600 text-white'
                            : 'bg-surface-raised text-ink-muted hover:bg-surface-sunken'
                        }`}
                      >
                        {u}
                      </button>
                    ))}
                  </div>
                </div>
                {durationValue && (
                  <p className="mt-1 text-[11px] text-ink-muted">
                    Recorded as: <strong className="text-ink-muted">
                      {durationValue} {Number(durationValue) === 1 ? durationUnit.replace(/s$/, '') : durationUnit}
                    </strong>
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink-muted mb-1">
                  Known Medical History / Chronic Illness
                </label>
                <textarea
                  rows={2}
                  value={medicalHistory}
                  onChange={(e) => setMedicalHistory(e.target.value)}
                  placeholder="e.g. Type 2 diabetes since 2019, hypertension"
                  className="w-full bg-surface-raised border border-line-strong rounded-field px-3.5 py-2 text-xs text-ink focus:border-gov-500 outline-none"
                />
                <p className="mt-1 text-[11px] text-ink-subtle">
                  Saved with the visit and passed to the AI assessment.
                </p>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-ink-muted mb-1">
                  Known Allergies
                </label>
                <input
                  type="text"
                  value={knownAllergies}
                  onChange={(e) => setKnownAllergies(e.target.value)}
                  placeholder="e.g. Penicillin — rash. Enter None if the patient reports none."
                  className="w-full bg-surface-raised border border-line-strong rounded-field px-3.5 py-2 text-xs text-ink focus:border-gov-500 outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setActiveTab('vitals')}
                className="px-5 py-2.5 rounded-field bg-gov-600 hover:bg-gov-700 text-white font-semibold text-xs shadow-sm flex items-center gap-2 transition-colors"
              >
                Next: Record Vitals <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: CLINICAL VITALS WITH BOUNDS VALIDATION */}
      {activeTab === 'vitals' && (
        <div className="bg-surface-raised p-6 rounded-field border border-line shadow-sm space-y-6">
          <div className="flex items-center justify-between border-b border-line pb-3">
            <h2 className="text-base font-bold text-ink flex items-center gap-2">
              <HeartPulse className="w-5 h-5 text-gov-600" /> Patient Vitals & Clinical Physical Signs
            </h2>
            <span className="text-xs bg-surface-sunken text-ink-muted px-2.5 py-1 rounded border border-line font-medium">
              Pre-filled with typical adult values
            </span>
          </div>

          {vitalsError && (
            <div role="alert" className="p-3 rounded-field bg-tier-emergencyBg border border-tier-emergency/30 text-xs text-tier-emergency flex items-center gap-2 font-semibold">
              <AlertTriangle className="w-4 h-4 text-tier-emergency shrink-0" />
              {vitalsError}
            </div>
          )}

          {/*
            Defaults are a starting point, not a measurement. A value the
            assistant never looked at is still a value the triage engine acts
            on, so untouched fields are called out before the assessment runs.
          */}
          {untouchedVitals.length > 0 && (
            <div className="p-3 rounded-field bg-tier-moderateBg border border-tier-moderate/30 text-[11px] text-tier-moderate">
              <strong>{untouchedVitals.length} value{untouchedVitals.length === 1 ? '' : 's'} still at the default:</strong>{' '}
              {untouchedVitals.map((f) => f.label).join(', ')}. Confirm each against the patient before assessing.
              <button
                type="button"
                onClick={() => setConfirmedVitals(new Set(VITAL_FIELDS.map((f) => f.key)))}
                className="ml-2 underline font-semibold hover:text-tier-moderate"
              >
                All measured and correct
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {VITAL_FIELDS.map((f) => {
              const err = vitalErrors[f.key];
              const abnormal = !err && isAbnormal(f, vitals[f.key]);
              const untouched = !confirmedVitals.has(f.key);
              return (
                <div key={f.key}>
                  <label htmlFor={`vital-${f.key}`} className="block text-xs font-semibold text-ink-muted mb-1">
                    {f.label} <span className="font-normal text-ink-subtle">({f.unit})</span>
                  </label>
                  <input
                    id={`vital-${f.key}`}
                    type="number"
                    inputMode="decimal"
                    step={f.step}
                    min={f.min}
                    max={f.max}
                    value={vitals[f.key]}
                    onChange={(e) => handleVitalsChange(f.key, e.target.value)}
                    className={`w-full rounded-field px-3 py-2 text-xs outline-none border transition-colors ${
                      err
                        ? 'border-red-400 bg-tier-emergencyBg text-tier-emergency focus:border-red-500'
                        : abnormal
                          ? 'border-amber-400 bg-tier-moderateBg text-tier-moderate focus:border-amber-500'
                          : untouched
                            ? 'border-line bg-surface-sunken text-ink-muted focus:border-gov-500 focus:bg-surface-raised focus:text-ink'
                            : 'border-line-strong bg-surface-raised text-ink focus:border-gov-500'
                    }`}
                  />
                  <p className={`mt-1 text-[10px] ${err ? 'text-tier-emergency' : abnormal ? 'text-tier-moderate font-semibold' : 'text-ink-subtle'}`}>
                    {err || (abnormal ? 'Outside the usual range — check the reading' : `Allowed ${f.min}–${f.max}`)}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="pt-2 border-t border-line">
            <h3 className="text-xs font-bold text-ink mt-4 mb-3">
              Measured values <span className="font-normal text-ink-subtle">— not pre-filled, these vary too much to guess</span>
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {MEASURED_FIELDS.map((f) => (
                <div key={f.key}>
                  <label htmlFor={`vital-${f.key}`} className="block text-xs font-semibold text-ink-muted mb-1">
                    {f.label} <span className="font-normal text-ink-subtle">({f.unit})</span>
                  </label>
                  <input
                    id={`vital-${f.key}`}
                    type="number"
                    inputMode="decimal"
                    step={f.step}
                    min={f.min}
                    max={f.max}
                    value={vitals[f.key]}
                    onChange={(e) => handleVitalsChange(f.key, e.target.value)}
                    placeholder="Optional"
                    className={`w-full rounded-field px-3 py-2 text-xs outline-none border ${
                      vitalErrors[f.key]
                        ? 'border-red-400 bg-tier-emergencyBg text-tier-emergency'
                        : 'border-line-strong bg-surface-raised text-ink focus:border-gov-500'
                    }`}
                  />
                  <p className={`mt-1 text-[10px] ${vitalErrors[f.key] ? 'text-tier-emergency' : 'text-ink-subtle'}`}>
                    {vitalErrors[f.key] || `Allowed ${f.min}–${f.max}`}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-between pt-2">
            <button
              onClick={() => setActiveTab('symptoms')}
              className="px-4 py-2 rounded-field bg-surface-sunken hover:bg-surface-sunken text-ink-muted font-semibold text-xs transition-colors"
            >
              Back
            </button>
            <button
              onClick={() => setActiveTab('documents')}
              className="px-5 py-2.5 rounded-field bg-gov-600 hover:bg-gov-700 text-white font-semibold text-xs shadow-sm flex items-center gap-2 transition-colors"
            >
              Next: Upload Documents &amp; Photos <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* TAB 3: DOCUMENTS OCR & WOUND PHOTOS */}
      {activeTab === 'documents' && (
        <div className="bg-surface-raised p-6 rounded-field border border-line shadow-sm space-y-6">
          <div className="border-b border-line pb-3">
            <h2 className="text-base font-bold text-ink flex items-center gap-2">
              <FileText className="w-5 h-5 text-gov-600" /> Paper Prescription OCR &amp; Wound Photo Vision Analysis
            </h2>
            <p className="text-xs text-ink-muted mt-1">
              Each section takes photos straight from the camera or files from the device.
              Multi-page reports go up as one document so the reader keeps context across pages.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

            {/* 1. PRESCRIPTION */}
            <div className="p-4 rounded-field bg-surface-sunken border border-line space-y-3">
              <div className="font-bold text-xs text-ink flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-gov-600" /> 1. Paper prescription
              </div>
              <FileCaptureInput
                label="Prescription pages"
                hint="Photograph the whole sheet, flat and well lit. Add both sides if written on."
                accept="image/*,application/pdf"
                multiple
                files={prescriptionFiles}
                onChange={setPrescriptionFiles}
                busy={uploadingDoc}
              />
              <button
                type="button"
                onClick={handlePrescriptionUpload}
                disabled={!prescriptionFiles.length || uploadingDoc}
                className="w-full py-2.5 rounded-field bg-gov-600 hover:bg-gov-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-2"
              >
                {uploadingDoc ? (
                  <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Reading prescription…</>
                ) : (
                  <>Read {prescriptionFiles.length || ''} prescription page{prescriptionFiles.length === 1 ? '' : 's'}</>
                )}
              </button>

              {verifiedOCRData && (
                <div className="p-3 rounded-field bg-tier-lowBg border border-tier-low/30 text-xs text-tier-low space-y-1">
                  <div className="font-semibold">Verified and attached to this visit</div>
                  {(verifiedOCRData.medications || []).slice(0, 5).map((m, i) => (
                    <div key={i} className="text-[11px]">
                      • <strong>{m.name}</strong> {m.strength} — {m.frequency} {m.duration ? `for ${m.duration}` : ''}
                    </div>
                  ))}
                  {verifiedOCRData.diagnosis_notes && (
                    <div className="text-[11px] pt-1 border-t border-tier-low/30">
                      Context: {verifiedOCRData.diagnosis_notes}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 2. LAB / TEST REPORTS */}
            <div className="p-4 rounded-field bg-surface-sunken border border-line space-y-3">
              <div className="font-bold text-xs text-ink flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-tier-low" /> 2. Test / lab reports
              </div>
              <FileCaptureInput
                label="Report pages"
                hint="Add every page, in order. A PDF is read directly, all pages at once."
                accept="image/*,application/pdf"
                multiple
                files={reportFiles}
                onChange={setReportFiles}
                busy={uploadingReport}
              />
              <button
                type="button"
                onClick={handleReportUpload}
                disabled={!reportFiles.length || uploadingReport}
                className="w-full py-2.5 rounded-field bg-tier-low hover:opacity-90 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-2"
              >
                {uploadingReport ? (
                  <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Reading report…</>
                ) : (
                  <>Read {reportFiles.length || ''} report page{reportFiles.length === 1 ? '' : 's'}</>
                )}
              </button>

              {reportExtraction && (
                <div className="p-3 rounded-field bg-surface-raised border border-line text-xs space-y-2 max-h-64 overflow-y-auto">
                  <div className="text-[11px] text-ink-muted">
                    {reportExtraction.pages_read} page(s) read by {reportExtraction._engine}
                  </div>
                  {(reportExtraction.panels || []).map((panel, i) => (
                    <div key={i}>
                      <div className="font-semibold text-ink text-[11px]">{panel.panel_name}</div>
                      {(panel.tests || []).map((t, j) => (
                        <div key={j} className="flex justify-between gap-2 text-[11px] py-0.5 border-b border-line">
                          <span className="text-ink-muted truncate">{t.name}</span>
                          <span
                            className={
                              t.flag === 'high'
                                ? 'font-mono shrink-0 text-tier-emergency font-bold'
                                : t.flag === 'low'
                                  ? 'font-mono shrink-0 text-tier-moderate font-bold'
                                  : 'font-mono shrink-0 text-ink-muted'
                            }
                          >
                            {t.value} {t.unit}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                  {(reportExtraction.abnormal_findings || []).length > 0 && (
                    <div className="pt-1 border-t border-line">
                      <div className="font-semibold text-tier-emergency text-[11px]">Outside reference range</div>
                      {reportExtraction.abnormal_findings.map((a, i) => (
                        <div key={i} className="text-[11px] text-tier-emergency">• {a}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 3. WOUND / INJURY PHOTOS */}
            <div className="p-4 rounded-field bg-surface-sunken border border-line space-y-3">
              <div className="font-bold text-xs text-ink flex items-center gap-1.5">
                <Camera className="w-4 h-4 text-gov-600" /> 3. Wound / injury photos
              </div>
              <FileCaptureInput
                label="Clinical photographs"
                hint="Include something for scale where you can. Add several angles if the wound is deep."
                accept="image/*"
                multiple
                files={woundFiles}
                onChange={setWoundFiles}
                busy={uploadingImage}
              />
              <button
                type="button"
                onClick={handleWoundUpload}
                disabled={!woundFiles.length || uploadingImage}
                className="w-full py-2.5 rounded-field bg-gov-600 hover:bg-gov-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-2"
              >
                {uploadingImage ? (
                  <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Analysing…</>
                ) : (
                  <>Analyse {woundFiles.length || ''} photo{woundFiles.length === 1 ? '' : 's'}</>
                )}
              </button>

              {visionObservations.map((obs, i) => (
                <div key={i} className="p-3 rounded-field bg-surface-raised border border-line text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-ink text-[11px]">Photo {i + 1}</span>
                    <span
                      className={
                        obs.severity_impression === 'HIGH'
                          ? 'text-[10px] font-bold px-2 py-0.5 rounded bg-tier-emergencyBg text-tier-emergency'
                          : obs.severity_impression === 'MEDIUM'
                            ? 'text-[10px] font-bold px-2 py-0.5 rounded bg-tier-moderateBg text-tier-moderate'
                            : 'text-[10px] font-bold px-2 py-0.5 rounded bg-tier-lowBg text-tier-low'
                      }
                    >
                      {obs.severity_impression}
                    </span>
                  </div>

                  {obs.body_region && obs.body_region !== 'Unknown' && (
                    <div className="text-[11px] text-ink-muted">Region: {obs.body_region}</div>
                  )}
                  {obs.extent && obs.extent.approximate_area && obs.extent.approximate_area !== 'Unknown' && (
                    <div className="text-[11px] text-ink-muted">
                      Extent: {obs.extent.approximate_area}
                      {obs.extent.spread_pattern && obs.extent.spread_pattern !== 'Unknown'
                        ? ` · ${obs.extent.spread_pattern}`
                        : ''}
                    </div>
                  )}

                  <p className="text-[11px] text-ink-muted leading-relaxed">{obs.cautious_summary}</p>

                  {(obs.possible_conditions || []).length > 0 && (
                    <div className="pt-1 border-t border-line">
                      <div className="font-semibold text-[11px] text-ink">Appearance consistent with</div>
                      {obs.possible_conditions.map((c, j) => (
                        <div key={j} className="text-[11px] text-ink-muted">
                          • {c.description} <span className="text-ink-subtle">({c.confidence} confidence)</span>
                        </div>
                      ))}
                      <p className="text-[10px] text-ink-subtle mt-1">
                        Observation only — not a diagnosis. The doctor decides.
                      </p>
                    </div>
                  )}

                  {(obs.escalate_if || []).length > 0 && (
                    <div className="pt-1 border-t border-line">
                      <div className="font-semibold text-[11px] text-tier-emergency">Escalate if</div>
                      {obs.escalate_if.map((e, j) => (
                        <div key={j} className="text-[11px] text-tier-emergency">• {e}</div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-between pt-2">
            <button
              onClick={() => setActiveTab('vitals')}
              className="px-4 py-2 rounded-field bg-surface-sunken hover:bg-surface-sunken text-ink-muted font-semibold text-xs transition-colors"
            >
              Back
            </button>
            <button
              onClick={handleRunAIAssessment}
              disabled={loadingAI}
              className="px-6 py-3 rounded-field bg-gov-600 hover:bg-gov-700 text-white font-bold text-xs shadow-sm flex items-center gap-2 transition-colors"
            >
              {loadingAI ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Generating AI assessment...
                </>
              ) : (
                <>
                  <Bot className="w-4 h-4" /> Generate AI Assessment <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* TAB 4: AI ASSESSMENT RESULTS & DOCTOR PUSH */}
      {activeTab === 'assessment' && (
        <div className="space-y-6">
          
          {apiError && (
            <div className="p-4 rounded-field bg-tier-emergencyBg border border-tier-emergency/30 text-xs text-tier-emergency font-semibold flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-tier-emergency shrink-0" />
                <span>AI Protocol Error: {apiError}</span>
              </div>
              <button onClick={handleRunAIAssessment} className="px-3 py-1.5 rounded bg-tier-emergency text-white text-xs font-semibold hover:opacity-90">
                Retry Assessment
              </button>
            </div>
          )}

          {/* The doctor's decision, arriving live. Rendered first, above the AI
              result: once a case has gone to a doctor, what the doctor said is
              the thing the assistant is standing there waiting for — the AI
              assessment is by then only context. */}
          {visitId && (
            <DoctorReviewPanel
              visitId={visitId}
              language={patient?.preferred_language || 'Hindi'}
            />
          )}

          {/*
            Tiered result — spec §3.6. LOW/MEDIUM/HIGH each produce a genuinely
            different screen, with the speak-aloud control and the PDF hardcopy
            buttons. Rendered above the older detail blocks, which remain for
            the protocol/vision breakdown.
          */}
          {aiAssessment?.workflow && (
            <TierResult
              workflow={aiAssessment.workflow}
              assessment={aiAssessment}
              visitId={visitId}
              language={patient?.preferred_language || 'Hindi'}
              onScheduleConsultation={() => setShowScheduleModal(true)}
            />
          )}

          {aiAssessment ? (
            <div className="space-y-6">
              
              {/* Top Risk & Actions Banner */}
              <div className="bg-surface-raised p-6 rounded-field border border-line shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <RiskBadge level={aiAssessment.risk_level} />
                    <span className="text-xs font-semibold text-ink-muted">Visit ID: {visitId}</span>
                  </div>
                  <h2 className="text-lg font-bold text-ink">AI Clinical Triage Synthesis Completed</h2>
                </div>

                <button
                  onClick={generateCompletePDFReport}
                  className="px-5 py-2.5 rounded-field bg-gov-600 hover:bg-gov-700 dark:bg-gov-500 dark:hover:bg-gov-400 dark:text-gov-950 text-white font-bold text-xs shadow-sm flex items-center gap-2 transition-colors min-h-[2.5rem]"
                >
                  <Printer className="w-4 h-4 text-blue-400" /> Print Visit Report
                </button>
              </div>

              {/* Patient Assessment Summary Box */}
              <div className="bg-surface-raised p-6 rounded-field border border-line shadow-sm space-y-4">
                
                <div className="p-4 rounded-field bg-gov-50 border border-gov-200">
                  <div className="font-bold text-xs text-blue-800 mb-1 flex items-center gap-1.5">
                    <Bot className="w-4 h-4 text-gov-600" /> AI LLM Patient Assessment Summary
                  </div>
                  <p className="text-xs text-ink leading-relaxed font-medium">
                    {aiAssessment.patient_summary || aiAssessment.summary}
                  </p>
                </div>

                {/* Step-by-Step First Aid Guidance */}
                {aiAssessment.first_aid_steps && aiAssessment.first_aid_steps.length > 0 && (
                  <div className="p-4 rounded-field bg-tier-lowBg/60 border border-tier-low/30 space-y-2">
                    <div className="font-bold text-xs text-tier-low flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-tier-low" /> First-Aid Steps (perform now)
                    </div>
                    <div className="space-y-1.5 text-xs text-ink">
                      {aiAssessment.first_aid_steps.map((step, idx) => (
                        <div key={idx} className="flex items-start gap-2">
                          <span className="w-4 h-4 rounded-full bg-tier-lowBg text-tier-low font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">{idx+1}</span>
                          <span>{step}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/*
                  Medication is the doctor's decision and is never listed here.
                  This panel used to print formulary lines under a "pending
                  doctor approval" caption, which still put drug names in front
                  of a health worker standing with the patient — the caption
                  asked them not to act on something they could already read.
                  The boundary is now stated instead of the medicines.
                */}
                <div className="p-4 rounded-field bg-surface-sunken border border-line space-y-1">
                  <div className="font-bold text-xs text-ink-muted flex items-center gap-1.5">
                    <Pill className="w-4 h-4" /> Medication
                  </div>
                  <p className="text-xs text-ink-muted">
                    {aiAssessment.medication_withheld_reason
                      || 'Medication is prescribed by the doctor after review. This assessment does not suggest any.'}
                  </p>
                </div>

                {/* Warning signs to monitor */}
                {aiAssessment.warnings && aiAssessment.warnings.length > 0 && (
                  <div className="p-4 rounded-field bg-tier-moderateBg/70 border border-tier-moderate/30 space-y-2">
                    <div className="font-bold text-xs text-tier-moderate flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-tier-moderate" /> Warning Signs — escalate immediately if seen
                    </div>
                    <ul className="space-y-1 text-xs text-ink list-disc list-inside">
                      {aiAssessment.warnings.map((w, idx) => (
                        <li key={idx}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {aiAssessment.legal_disclaimer && (
                  <p className="text-[11px] text-ink-muted border-t border-line pt-3">{aiAssessment.legal_disclaimer}</p>
                )}

              </div>

              {/* PUSH CASE TO DOCTOR DATABASE & OPTIONAL EMERGENCY VIDEO CALL */}
              <div className="bg-surface-raised p-6 rounded-field border border-line shadow-sm space-y-4">
                
                <div>
                  <h3 className="text-base font-bold text-ink flex items-center gap-2">
                    <Send className="w-5 h-5 text-gov-600" /> Hand Off Case to a Doctor
                  </h3>
                  <p className="text-xs text-ink-muted">First select the doctor, then send the vitals, AI summary, verified prescription data and wound photos to that doctor's review queue.</p>
                </div>

                {/* Doctor selection — core handoff step */}
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-ink-muted">
                    Step 1 — Select the doctor for this case:
                    {selectedDoctor && (
                      <span className="ml-2 px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-bold">
                        {selectedDoctor.name} · {selectedDoctor.specialization}
                      </span>
                    )}
                  </div>
                  <DoctorSelectGrid selected={selectedDoctor} onChange={setSelectedDoctor} />
                </div>

                <div className="text-xs font-semibold text-ink-muted pt-1">Step 2 — Choose the action:</div>
                <div className="flex flex-col sm:flex-row items-center gap-3">
                  <button
                    onClick={handlePushCaseToDoctor}
                    disabled={pushingToDoctor || !selectedDoctor}
                    title={!selectedDoctor ? 'Select a doctor above first' : undefined}
                    className="w-full sm:w-auto px-6 py-3 rounded-field bg-gov-600 hover:bg-gov-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs shadow-sm flex items-center justify-center gap-2 transition-colors"
                  >
                    <Send className="w-4 h-4" /> {pushingToDoctor
                      ? 'Sending case...'
                      : selectedDoctor
                        ? `Send Case to ${selectedDoctor.name.split(' ').slice(0, 2).join(' ')}`
                        : 'Send Case to Selected Doctor'}
                  </button>

                  {/* One entry point. The modal offers both paths — Instant
                      (find a doctor free right now) and Schedule (pick a slot) —
                      because which one is right depends on the case, not on
                      which button the assistant happened to reach for. */}
                  <button
                    onClick={() => setShowScheduleModal(true)}
                    disabled={!visitId}
                    className="w-full sm:w-auto px-5 py-3 rounded-field bg-tier-low hover:opacity-90 disabled:opacity-50 text-white font-bold text-xs shadow-sm flex items-center justify-center gap-2 transition-colors"
                  >
                    <Video className="w-4 h-4" /> Video Consultation
                  </button>
                </div>

                {/* What was actually sent, itemised. The old message asserted
                    the doctor could see an AI summary and wound photos whether
                    or not any existed. */}
                {pushSuccess && handoffResult && (
                  <div className="p-3 rounded-field bg-tier-lowBg border border-tier-low/30 text-xs space-y-2">
                    <div className="flex items-center gap-2 text-tier-low font-semibold">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>
                        Case {handoffResult.visit_code} sent to {handoffResult.doctor?.full_name}
                        {handoffResult.risk_level && <> · {handoffResult.risk_level} risk</>}
                      </span>
                    </div>

                    <ul className="text-ink-muted space-y-0.5 pl-6 list-disc">
                      <li>{handoffResult.sent?.ai_assessment ? 'AI assessment' : 'No AI assessment'}</li>
                      <li>{handoffResult.sent?.vitals || 0} vitals record{handoffResult.sent?.vitals === 1 ? '' : 's'}</li>
                      <li>{handoffResult.sent?.symptoms || 0} symptom entr{handoffResult.sent?.symptoms === 1 ? 'y' : 'ies'}</li>
                      <li>
                        {handoffResult.sent?.documents || 0} document{handoffResult.sent?.documents === 1 ? '' : 's'}
                        {' '}({handoffResult.sent?.verified_documents || 0} verified)
                      </li>
                      <li>{handoffResult.sent?.images || 0} wound photo{handoffResult.sent?.images === 1 ? '' : 's'}</li>
                    </ul>

                    {handoffResult.missing?.length > 0 && (
                      <p className="text-tier-moderate flex items-start gap-1.5 pt-1">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>Sent without {handoffResult.missing.join(', ')}. Add it and send again if needed.</span>
                      </p>
                    )}

                    <p className="text-ink-subtle pt-1">
                      Verified by {handoffResult.verified_by?.name} · {handoffResult.verified_by?.email}
                    </p>
                  </div>
                )}
              </div>

            </div>
          ) : (
            <div className="bg-surface-raised p-12 rounded-field border border-dashed border-line text-center text-xs text-ink-muted space-y-3">
              <Bot className="w-8 h-8 text-gov-600 mx-auto" />
              <p>Complete the previous steps, then select "Generate AI Assessment" on the Documents &amp; Photos tab.</p>
            </div>
          )}

        </div>
      )}

      {/* OCR Mandatory Verification Modal */}
      {showOCRModal && currentDocument && (
        <OCRVerificationModal
          documentId={currentDocument.id}
          visitId={visitId}
          initialData={currentDocument.ocr_data}
          rawText={currentDocument.raw_text}
          onVerified={(data) => {
            // A lab report and a prescription feed different parts of the
            // assessment, so they are kept apart rather than overwriting
            // each other in one slot.
            if (data?.document_type === 'lab_report') setReportExtraction(data);
            else setVerifiedOCRData(data);
          }}
          onClose={() => setShowOCRModal(false)}
        />
      )}

      {/* Consultation booking — Instant or Scheduled */}
      {showScheduleModal && (
        <ScheduleConsultationModal
          visitId={visitId}
          patientName={patient?.full_name || 'Patient'}
          onClose={() => setShowScheduleModal(false)}
        />
      )}

    </div>
  );
}
