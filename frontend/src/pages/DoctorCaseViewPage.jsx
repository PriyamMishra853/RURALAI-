import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Stethoscope, Video, CheckCircle2, ArrowLeft, AlertCircle, RefreshCw } from 'lucide-react';
import api from '../services/api';
import AIDoctorVisualSeparation from '../components/AIDoctorVisualSeparation';
import WebRTCVideoCallModal from '../components/WebRTCVideoCallModal';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../config/supabase';
import DemoBadge from '../components/DemoBadge';

export default function DoctorCaseViewPage() {
  const { id: visitId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [visit, setVisit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);

  // Doctor decision form
  const [diagnosis, setDiagnosis] = useState('');
  const [doctorNotes, setDoctorNotes] = useState('');
  const [decision, setDecision] = useState('PRESCRIBE');
  const [referralHospital, setReferralHospital] = useState('District Hospital');
  const [showVideoCall, setShowVideoCall] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rxMeds, setRxMeds] = useState([]);

  useEffect(() => {
    fetchCase();

    const channel = supabase
      .channel(`public:case_${visitId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_assessments', filter: `visit_id=eq.${visitId}` }, fetchCase)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'patient_images', filter: `visit_id=eq.${visitId}` }, fetchCase)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'patient_documents', filter: `visit_id=eq.${visitId}` }, fetchCase)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'visit_vitals', filter: `visit_id=eq.${visitId}` }, fetchCase)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [visitId]);

  const fetchCase = async () => {
    try {
      const res = await api.get(`/doctor/cases/${visitId}`);
      setVisit(res.data);
      setFetchError(null);
    } catch (err) {
      console.error('Error loading case file:', err);
      setFetchError(err.response?.data?.error || err.message || 'Database fetch error');
    } finally {
      setLoading(false);
    }
  };

  const handleMedChange = (index, field, val) => {
    const updated = [...rxMeds];
    updated[index][field] = val;
    setRxMeds(updated);
  };

  const addMed = () => {
    setRxMeds([...rxMeds, { name: '', strength: '', frequency: '', duration: '' }]);
  };

  const removeMed = (index) => {
    setRxMeds(rxMeds.filter((_, i) => i !== index));
  };

  const handleSubmitReview = async (e) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const prescriptions = decision === 'PRESCRIBE'
        ? rxMeds.filter((m) => m.name.trim() !== '').map((m) => ({
            name: m.name,
            strength: m.strength,
            dosage: m.strength,
            frequency: m.frequency,
            instructions: m.duration ? `Duration: ${m.duration}` : undefined
          }))
        : [];

      await api.post(`/doctor/cases/${visitId}/review`, {
        visit_id: visitId,
        doctor_diagnosis: diagnosis,
        doctor_notes: doctorNotes,
        prescriptions,
        referral_needed: decision === 'REFER',
        referral_hospital: decision === 'REFER' ? referralHospital : undefined
      });

      alert('Review saved: your diagnosis, notes and prescription are now on the patient record.');
      navigate('/doctor/queue');
    } catch (err) {
      console.error('Review submission error:', err);
      alert('Failed to save the review: ' + (err.response?.data?.error || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !fetchError) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
        <RefreshCw className="w-4 h-4 text-blue-600 animate-spin" /> Loading the patient case file...
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center space-y-4">
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 font-semibold max-w-lg mx-auto flex items-center gap-2 justify-center">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>Could not load the case file: {fetchError}</span>
        </div>
        <button
          onClick={() => { setLoading(true); fetchCase(); }}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold text-xs hover:bg-blue-700 transition-colors inline-flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Try Again
        </button>
      </div>
    );
  }

  // ---- Map the live database shape ----
  const patient = visit?.patients || {};
  const vitalsRow = Array.isArray(visit?.visit_vitals) ? visit.visit_vitals[0] : visit?.visit_vitals;
  const assessment = Array.isArray(visit?.ai_assessments) ? visit.ai_assessments[0] : null;
  const rawOutput = assessment?.ai_raw_output || {};
  const documents = visit?.patient_documents || [];

  // Merge stored photo files with the vision observations carried in the assessment
  const visionObs = rawOutput.image_observations || [];
  const images = (visit?.patient_images || []).map((img, i) => ({
    ...img,
    ...(visionObs[i] || {}),
    image_url: img.image_url || visionObs[i]?.image_url || null
  }));
  // Vision observations that have no stored file row (e.g. inline data URLs)
  const extraObs = visionObs.slice((visit?.patient_images || []).length);
  const allImages = [...images, ...extraObs];

  const aiAssessment = assessment
    ? {
        ...rawOutput,
        risk_level: (visit?.risk_level || rawOutput.risk_level || 'medium').toUpperCase(),
        patient_summary: assessment.patient_summary || rawOutput.patient_summary,
        processing_status: assessment.processing_status
      }
    : null;

  const tempF = vitalsRow?.temperature_celsius != null
    ? ((vitalsRow.temperature_celsius * 9) / 5 + 32).toFixed(1)
    : null;

  const pName = patient.full_name || patient.name || 'Patient';
  const pCode = patient.patient_code || '';

  return (
    <div className="max-w-7xl mx-auto px-4 lg:px-8 py-8 space-y-6">

      {/* Header */}
      <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/doctor/queue')} className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors" aria-label="Back to queue">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Stethoscope className="w-5 h-5 text-blue-600" /> Case File: {pName} <DemoBadge patient={patient} />
            </h1>
            <p className="text-xs text-slate-500">Visit <code className="font-mono text-blue-600 font-bold">{visit?.visit_code || visitId}</code> — live-synced with the database</p>
          </div>
        </div>

        <button
          onClick={() => setShowVideoCall(true)}
          className="w-full md:w-auto px-4 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs shadow-sm flex items-center justify-center gap-2 transition-colors"
        >
          <Video className="w-4 h-4" /> Start Video Consultation
        </button>
      </div>

      {/* Patient & vitals banner */}
      <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm grid grid-cols-1 md:grid-cols-4 gap-6 text-xs">
        <div>
          <span className="text-slate-500 block text-[11px]">Patient</span>
          <div className="font-bold text-slate-900 text-sm mt-0.5">
            {pName} <DemoBadge patient={patient} />
          </div>
          {pCode && <div className="font-mono text-blue-600 font-semibold">{pCode}</div>}
        </div>

        <div>
          <span className="text-slate-500 block text-[11px]">Age / Gender / Village</span>
          <div className="font-bold text-slate-900 mt-0.5">
            {patient.age_years ?? patient.age ?? '—'} yrs / {patient.gender || '—'}
          </div>
          <div className="text-slate-600 font-medium">{patient.village || '—'}</div>
        </div>

        <div>
          <span className="text-slate-500 block text-[11px]">Recorded Vitals</span>
          <div className="font-bold text-slate-900 mt-0.5">
            BP: {vitalsRow?.systolic_bp != null ? `${vitalsRow.systolic_bp}/${vitalsRow.diastolic_bp ?? '—'} mmHg` : 'Not recorded'}
          </div>
          <div className="text-slate-600">
            Temp: {tempF ? `${tempF}°F` : '—'} | SpO2: {vitalsRow?.oxygen_saturation != null ? `${vitalsRow.oxygen_saturation}%` : '—'} | Pulse: {vitalsRow?.pulse_bpm ?? '—'}
          </div>
        </div>

        <div>
          <span className="text-slate-500 block text-[11px]">Chief Complaint</span>
          <div className="font-bold text-slate-900 mt-0.5">{visit?.chief_complaint || 'Not recorded'}</div>
        </div>
      </div>

      {/* Split: AI assistance vs doctor decision */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        <div className="lg:col-span-7">
          <AIDoctorVisualSeparation
            aiAssessment={aiAssessment}
            doctorReview={null}
            prescription={null}
            documents={documents}
            images={allImages}
          />
        </div>

        {/* Doctor decision form */}
        <div className="lg:col-span-5 bg-white p-6 rounded-lg border border-slate-200 shadow-sm space-y-5 h-fit sticky top-6">
          <div className="pb-3 border-b border-slate-200">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <Stethoscope className="w-4 h-4 text-emerald-600" /> Doctor Decision &amp; Prescription
            </h3>
            <p className="text-xs text-slate-500">Recorded under your name: <strong>{user?.name || 'Doctor'}</strong></p>
          </div>

          <form onSubmit={handleSubmitReview} className="space-y-4 text-xs">

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Decision</label>
              <select
                value={decision}
                onChange={(e) => setDecision(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-slate-900 focus:border-blue-500 outline-none font-semibold cursor-pointer"
              >
                <option value="PRESCRIBE">Issue prescription &amp; treatment plan</option>
                <option value="PROTOCOL">Continue first-aid protocol care (no prescription)</option>
                <option value="REFER">Refer to hospital</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Diagnosis</label>
              <input
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
                required
                placeholder="e.g. Acute viral febrile illness"
                className="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-slate-900 focus:border-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Clinical notes &amp; instructions for the assistant</label>
              <textarea
                rows={4}
                value={doctorNotes}
                onChange={(e) => setDoctorNotes(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-lg p-3 text-slate-900 focus:border-blue-500 outline-none leading-relaxed"
                placeholder="Treatment advice, monitoring instructions, follow-up plan..."
                required
              />
            </div>

            {decision === 'REFER' && (
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Referral destination</label>
                <input
                  value={referralHospital}
                  onChange={(e) => setReferralHospital(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-slate-900 focus:border-blue-500 outline-none"
                />
              </div>
            )}

            {decision === 'PRESCRIBE' && (
              <div className="space-y-2 pt-2 border-t border-slate-200">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">Prescription medicines</span>
                  <button type="button" onClick={addMed} className="text-blue-600 hover:text-blue-800 text-[11px] font-semibold">
                    + Add Medicine
                  </button>
                </div>

                {rxMeds.length === 0 && (
                  <p className="text-[11px] text-slate-500">No medicines added yet. Select "Add Medicine" to build the prescription.</p>
                )}

                {rxMeds.map((med, idx) => (
                  <div key={idx} className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder="Medicine name"
                        value={med.name}
                        onChange={(e) => handleMedChange(idx, 'name', e.target.value)}
                        className="bg-white border border-slate-300 rounded p-1.5 text-slate-900 outline-none"
                      />
                      <input
                        type="text"
                        placeholder="Strength (e.g. 500 mg)"
                        value={med.strength}
                        onChange={(e) => handleMedChange(idx, 'strength', e.target.value)}
                        className="bg-white border border-slate-300 rounded p-1.5 text-slate-900 outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder="Frequency (e.g. twice daily)"
                        value={med.frequency}
                        onChange={(e) => handleMedChange(idx, 'frequency', e.target.value)}
                        className="bg-white border border-slate-300 rounded p-1.5 text-slate-900 outline-none"
                      />
                      <input
                        type="text"
                        placeholder="Duration (e.g. 3 days)"
                        value={med.duration}
                        onChange={(e) => handleMedChange(idx, 'duration', e.target.value)}
                        className="bg-white border border-slate-300 rounded p-1.5 text-slate-900 outline-none"
                      />
                    </div>
                    <button type="button" onClick={() => removeMed(idx)} className="text-red-600 hover:text-red-800 text-[11px] font-semibold">
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold text-xs shadow-sm transition-colors flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" /> {submitting ? 'Saving decision...' : 'Save Diagnosis, Notes & Prescription'}
            </button>

          </form>
        </div>

      </div>

      {/* Video call modal */}
      {showVideoCall && (
        <WebRTCVideoCallModal
          roomId={`room_${visitId.replace(/-/g, '_')}`}
          userName={user?.name || 'Doctor'}
          userId={user?.id || `doc_${Date.now()}`}
          role="DOCTOR"
          peerName={pName}
          onClose={() => setShowVideoCall(false)}
        />
      )}

    </div>
  );
}
