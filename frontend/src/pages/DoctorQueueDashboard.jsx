import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Stethoscope, Clock, ArrowRight, Video, PhoneCall, PhoneIncoming, PhoneOff, RefreshCw, AlertCircle } from 'lucide-react';
import api from '../services/api';
import RiskBadge from '../components/RiskBadge';
import WebRTCVideoCallModal from '../components/WebRTCVideoCallModal';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../config/supabase';
import DemoBadge from '../components/DemoBadge';

export default function DoctorQueueDashboard() {
  const { user } = useAuth();
  const [queue, setQueue] = useState([]);
  const [consultations, setConsultations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [activeVideoRoom, setActiveVideoRoom] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchQueueAndConsultations();

    // Realtime sync on consultation changes + polling fallback
    const channel = supabase
      .channel('public:consultations')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'consultations' }, () => {
        fetchQueueAndConsultations();
      })
      .subscribe();

    const interval = setInterval(fetchQueueAndConsultations, 5000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, []);

  const fetchQueueAndConsultations = async () => {
    try {
      const [qRes, cRes] = await Promise.all([
        api.get('/doctor/queue'),
        api.get('/consultations').catch(() => ({ data: [] }))
      ]);

      const consultList = (cRes.data || []).filter((c) => ['waiting', 'active'].includes(c.status));
      setQueue(qRes.data || []);
      setConsultations(consultList);
      setFetchError(null);

      // Emergency ring from the clinic assistant
      const ringing = consultList.find((c) => c.ringing);
      setIncomingCall(ringing || null);
    } catch (err) {
      console.error('Failed to load doctor queue:', err);
      setFetchError(err.response?.data?.error || err.message || 'Database connection error');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinCall = async (consultId, roomId, patientName) => {
    let finalRoom = roomId;
    try {
      const res = await api.post(`/consultations/${consultId}/join`);
      finalRoom = res.data?.room_id || roomId;
    } catch (err) {
      console.warn('Join endpoint failed, entering room directly:', err.message);
    }
    setActiveVideoRoom({
      room_id: finalRoom || `room_${consultId}`,
      patient_name: patientName || 'Patient'
    });
    setIncomingCall(null);
  };

  const handleDeclineCall = async (consultId) => {
    try {
      await api.post(`/consultations/${consultId}/decline`);
    } catch (err) {
      console.warn('Decline failed:', err.message);
    }
    setIncomingCall(null);
    fetchQueueAndConsultations();
  };

  return (
    <div className="max-w-7xl mx-auto px-4 lg:px-8 py-8 space-y-6">

      {/* Header */}
      <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Stethoscope className="w-5 h-5 text-blue-600" /> Doctor Review Queue
          </h1>
          <p className="text-xs text-slate-500">Cases are sorted by triage level: HIGH first, then MEDIUM, then LOW.</p>
        </div>
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2">
          <span className="text-xs text-slate-500">Signed in as</span>
          <span className="text-xs font-bold text-slate-900">{user?.name || 'Doctor'}</span>
        </div>
      </div>

      {/* Error state */}
      {fetchError && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span><strong>Could not load the queue:</strong> {fetchError}</span>
          </div>
          <button
            onClick={() => { setLoading(true); fetchQueueAndConsultations(); }}
            className="px-3 py-1.5 rounded bg-red-600 text-white font-semibold text-xs hover:bg-red-700 transition-colors flex items-center gap-1"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </button>
        </div>
      )}

      {loading && !fetchError && (
        <div className="p-8 text-center text-xs text-slate-500 bg-white rounded-lg border border-slate-200 shadow-sm flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 text-blue-600 animate-spin" /> Loading your review queue...
        </div>
      )}

      {/* Incoming emergency call banner */}
      {!loading && incomingCall && (
        <div className="bg-emerald-50 p-6 rounded-lg border border-emerald-300 shadow-sm">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-emerald-100 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
                <PhoneIncoming className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800 border border-emerald-200">
                    Incoming emergency video call
                  </span>
                  <RiskBadge level={incomingCall.risk_level} />
                </div>
                <h2 className="text-lg font-bold text-slate-900 mt-1">
                  {incomingCall.patient_name} <span className="text-xs font-mono text-blue-600">({incomingCall.patient_code})</span>
                </h2>
                <p className="text-xs text-slate-600">
                  {incomingCall.reason} {incomingCall.village && <>— <strong className="text-slate-900">{incomingCall.village}</strong></>}
                </p>
                {incomingCall.visits?.id && (
                  <button
                    onClick={() => navigate(`/doctor/cases/${incomingCall.visits.id}`)}
                    className="text-[11px] text-blue-700 font-semibold hover:underline mt-1"
                  >
                    Open the full case file (AI summary, prescription OCR, wound photos)
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 w-full md:w-auto">
              <button
                onClick={() => handleJoinCall(incomingCall.id, incomingCall.room_id, incomingCall.patient_name)}
                className="flex-1 md:flex-none px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-sm flex items-center justify-center gap-2 transition-colors"
              >
                <PhoneCall className="w-4 h-4" /> Accept &amp; Join Video Call
              </button>
              <button
                onClick={() => handleDeclineCall(incomingCall.id)}
                className="px-4 py-2.5 rounded-lg bg-white hover:bg-red-50 hover:text-red-600 text-slate-700 border border-slate-300 font-semibold text-xs flex items-center gap-1.5"
              >
                <PhoneOff className="w-4 h-4" /> Decline
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Waiting / scheduled consultations */}
      {!loading && (
        <div className="bg-white rounded-lg p-6 border border-slate-200 shadow-sm space-y-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Video className="w-5 h-5 text-purple-600" /> Video Consultations Waiting for You
            </h2>
            <p className="text-xs text-slate-500">Rooms opened by clinic assistants. Join when you are ready.</p>
          </div>

          {consultations.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs border border-dashed border-slate-200 rounded-lg">
              No video consultations are waiting right now.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {consultations.map((c) => {
                const schedDate = new Date(c.scheduled_time || c.created_at);
                return (
                  <div key={c.id} className="p-4 rounded-lg bg-slate-50 border border-slate-200 flex flex-col justify-between space-y-3">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <RiskBadge level={c.risk_level} />
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${c.status === 'active' ? 'bg-emerald-100 text-emerald-800 animate-pulse' : 'bg-slate-200 text-slate-700'}`}>
                          {c.status === 'active' ? 'IN PROGRESS' : 'WAITING'}
                        </span>
                      </div>

                      <div className="font-bold text-sm text-slate-900">{c.patient_name}</div>
                      {c.patient_code && <div className="text-xs text-slate-500">Code: <strong className="text-blue-600">{c.patient_code}</strong></div>}
                      <div className={`text-[10px] font-bold mt-1 inline-block px-1.5 py-0.5 rounded ${c.doctor_id ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                        {c.doctor_id ? 'ASSIGNED TO YOU' : 'OPEN ON-CALL REQUEST'}
                      </div>
                      <div className="text-xs text-slate-700 mt-1 font-medium">{c.reason || 'Teleconsultation'}</div>
                      <div className="text-xs text-amber-700 flex items-center gap-1 mt-1 font-medium">
                        <Clock className="w-3.5 h-3.5" /> {schedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({schedDate.toLocaleDateString()})
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleJoinCall(c.id, c.room_id, c.patient_name)}
                        className="flex-1 py-2 rounded-lg font-semibold text-xs shadow-sm flex items-center justify-center gap-1.5 transition-colors bg-blue-600 hover:bg-blue-700 text-white"
                      >
                        <PhoneCall className="w-3.5 h-3.5" /> Join Video Call
                      </button>
                      <button
                        onClick={() => handleDeclineCall(c.id)}
                        className="px-3 py-2 rounded-lg bg-white hover:bg-red-50 hover:text-red-600 text-slate-600 border border-slate-300 font-semibold text-xs transition-colors"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Patient triage queue */}
      {!loading && (
        <div className="space-y-4">
          <h2 className="text-base font-bold text-slate-900">Patient Triage Queue</h2>

          {queue.length === 0 ? (
            <div className="bg-white p-12 rounded-lg border border-slate-200 shadow-sm text-center text-slate-500 text-xs">
              No cases are waiting for review. New cases sent by clinic assistants will appear here.
            </div>
          ) : (
            queue.map((item) => {
              const patient = item.patients || {};
              const pName = patient.full_name || patient.name || 'Patient';
              const pCode = patient.patient_code || '';
              const riskLevel = (item.risk_level || 'medium').toUpperCase();
              const isHigh = riskLevel === 'HIGH';

              return (
                <div
                  key={item.id}
                  className={`bg-white p-6 rounded-lg border shadow-sm transition-all flex flex-col md:flex-row items-start md:items-center justify-between gap-4 ${isHigh ? 'border-red-300 bg-red-50/30' : 'border-slate-200 hover:border-slate-300'}`}
                >
                  <div className="space-y-2 flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      {pCode && (
                        <span className="font-mono text-xs font-bold bg-slate-100 text-blue-600 px-2.5 py-0.5 rounded border border-slate-200">
                          {pCode}
                        </span>
                      )}
                      <h3 className="text-base font-bold text-slate-900">
                        {pName} <DemoBadge patient={patient} />
                      </h3>
                      <RiskBadge level={riskLevel} />
                    </div>

                    <p className="text-xs text-slate-700">
                      <strong>Chief complaint:</strong> {item.chief_complaint || 'Not recorded'}
                    </p>

                    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
                      <span>Village: <strong className="text-slate-800">{patient.village || '—'}</strong></span>
                      <span>Status: <span className="text-emerald-700 font-semibold">{(item.status || 'open').replace(/_/g, ' ')}</span></span>
                      <span>Received: {new Date(item.created_at).toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 w-full md:w-auto justify-end">
                    <button
                      onClick={() => navigate(`/doctor/cases/${item.id}`)}
                      className={`px-4 py-2 rounded-lg font-semibold text-xs shadow-sm transition-colors flex items-center gap-1.5 ${isHigh ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
                    >
                      {isHigh ? 'Review Urgent Case' : 'Open Case File'} <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Video call modal */}
      {activeVideoRoom && (
        <WebRTCVideoCallModal
          roomId={activeVideoRoom.room_id}
          userName={user?.name || 'Doctor'}
          userId={user?.id || `doc_${Date.now()}`}
          role="DOCTOR"
          peerName={activeVideoRoom.patient_name || 'Patient & Clinic Assistant'}
          onClose={() => setActiveVideoRoom(null)}
        />
      )}

    </div>
  );
}
