import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UserPlus, Search, Activity, Clock, ShieldAlert, CheckCircle, User, Video, Calendar, PhoneCall } from 'lucide-react';
import api from '../services/api';
import RiskBadge from '../components/RiskBadge';
import WebRTCVideoCallModal from '../components/WebRTCVideoCallModal';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../config/supabase';
import DemoBadge from '../components/DemoBadge';

export default function AssistantDashboard() {
  const { user } = useAuth();
  const [patients, setPatients] = useState([]);
  const [consultations, setConsultations] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeVideoRoom, setActiveVideoRoom] = useState(null);

  const navigate = useNavigate();

  useEffect(() => {
    fetchData();

    // Realtime: refresh as soon as a consultation or appointment changes,
    // with polling as the fallback transport.
    const channel = supabase
      .channel('assistant-dashboard-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'consultations' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, fetchData)
      .subscribe();

    const interval = setInterval(fetchData, 10000);
    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchData = async () => {
    try {
      const [pRes, cRes] = await Promise.all([
        api.get('/patients'),
        api.get('/consultations').catch(() => ({ data: [] }))
      ]);
      setPatients(pRes.data || []);
      setConsultations((cRes.data || []).filter((c) => ['waiting', 'active'].includes(c.status)));
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleJoinCall = async (consultId, roomId) => {
    let finalRoom = roomId;
    try {
      const res = await api.post(`/consultations/${consultId}/join`);
      finalRoom = res.data?.room_id || roomId;
    } catch (err) {
      console.warn('Join endpoint failed, entering room directly:', err.message);
    }
    setActiveVideoRoom({ room_id: finalRoom });
  };

  const today = new Date().toDateString();
  const todayPatients = patients.filter((p) => new Date(p.created_at).toDateString() === today).length;
  const highRiskCalls = consultations.filter((c) => (c.risk_level || '').toUpperCase() === 'HIGH').length;

  const filteredPatients = patients.filter((p) =>
    (p.name || p.full_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (p.patient_code || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (p.village || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto px-4 lg:px-8 py-8 space-y-6">

      {/* Header + primary actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Clinic Assistant Workspace</h1>
          <p className="text-xs text-slate-500">Signed in as <strong>{user?.name || 'Clinic Assistant'}</strong></p>
        </div>

        <Link
          to="/assistant/patients/new"
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs shadow-sm flex items-center gap-2 transition-colors"
        >
          <UserPlus className="w-4 h-4" /> Register New Patient
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 font-medium">Registered Patients</p>
            <h3 className="text-2xl font-bold text-slate-900 mt-1">{patients.length}</h3>
          </div>
          <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
            <User className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 font-medium">Registered Today</p>
            <h3 className="text-2xl font-bold text-emerald-600 mt-1">{todayPatients}</h3>
          </div>
          <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
            <CheckCircle className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 font-medium">Open Video Consultations</p>
            <h3 className="text-2xl font-bold text-amber-600 mt-1">{consultations.length}</h3>
          </div>
          <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-100">
            <Video className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 font-medium">High-Risk Calls Waiting</p>
            <h3 className="text-2xl font-bold text-red-600 mt-1">{highRiskCalls}</h3>
          </div>
          <div className="w-10 h-10 rounded-lg bg-red-50 text-red-600 flex items-center justify-center border border-red-100">
            <ShieldAlert className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Open video consultations */}
      <div className="bg-white rounded-lg p-6 border border-slate-200 shadow-sm space-y-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Video className="w-5 h-5 text-purple-600" /> Open Video Consultations
          </h2>
          <p className="text-xs text-slate-500">Rooms waiting for the doctor or currently in progress. To book a new one, open a patient's assessment and select "Schedule Video Consultation".</p>
        </div>

        {consultations.length === 0 ? (
          <div className="p-6 text-center text-slate-500 text-xs border border-dashed border-slate-200 rounded-lg">
            No open video consultations right now.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {consultations.map((c) => (
              <div key={c.id} className="p-4 rounded-lg bg-slate-50 border border-slate-200 flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <RiskBadge level={c.risk_level} />
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${c.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>
                      {c.status === 'active' ? 'IN PROGRESS' : 'WAITING'}
                    </span>
                  </div>

                  <div className="font-bold text-sm text-slate-900">{c.patient_name}</div>
                  {c.patient_code && <div className="text-xs text-slate-500">Code: <strong className="text-blue-600">{c.patient_code}</strong></div>}
                  <div className="text-xs text-emerald-700 font-semibold mt-1">
                    {c.doctor_name}{c.doctor_specialization ? ` · ${c.doctor_specialization}` : ''}
                  </div>
                  <div className="text-xs text-slate-700 mt-1 font-medium">{c.reason || 'Teleconsultation'}</div>
                  <div className="text-xs text-amber-700 flex items-center gap-1 mt-1 font-medium">
                    <Clock className="w-3.5 h-3.5" /> {new Date(c.scheduled_time || c.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                  </div>
                </div>

                <button
                  onClick={() => handleJoinCall(c.id, c.room_id)}
                  className="w-full py-2.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs shadow-sm flex items-center justify-center gap-2 transition-colors"
                >
                  <PhoneCall className="w-4 h-4" /> Join Video Consultation
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Patient directory */}
      <div className="bg-white rounded-lg p-6 border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <h2 className="text-base font-bold text-slate-900">Patient Directory</h2>

          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Search by name, code, or village..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white border border-slate-300 rounded-lg pl-9 pr-4 py-2 text-xs text-slate-900 focus:border-blue-500 outline-none"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-6 text-center text-xs text-slate-500">Loading patients...</div>
        ) : filteredPatients.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg">
            {patients.length === 0 ? 'No patients registered yet. Select "Register New Patient" to add the first one.' : 'No patients match your search.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-semibold uppercase text-[10px] tracking-wider border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Patient Code</th>
                  <th className="px-4 py-3">Name &amp; Demographics</th>
                  <th className="px-4 py-3">Village</th>
                  <th className="px-4 py-3">Language</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {filteredPatients.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3.5 font-mono text-blue-600 font-bold">{p.patient_code}</td>
                    <td className="px-4 py-3.5">
                      <div className="font-semibold text-slate-900">
                        {p.name || p.full_name} <DemoBadge patient={p} />
                      </div>
                      <div className="text-[11px] text-slate-500">{p.age || p.age_years} yrs | {p.gender}</div>
                    </td>
                    <td className="px-4 py-3.5">{p.village}</td>
                    <td className="px-4 py-3.5">
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">{p.preferred_language || 'Hindi'}</span>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-slate-500">{p.phone || '—'}</td>
                    <td className="px-4 py-3.5 text-right">
                      <button
                        onClick={() => navigate(`/assistant/assessment/${p.id}`)}
                        className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs transition-colors inline-flex items-center gap-1.5 shadow-sm"
                      >
                        <Activity className="w-3.5 h-3.5" /> Start Assessment Visit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* WebRTC video call modal */}
      {activeVideoRoom && (
        <WebRTCVideoCallModal
          roomId={activeVideoRoom.room_id}
          userName={user?.name || 'Clinic Assistant'}
          userId={user?.id || `ast_${Date.now()}`}
          role="CLINIC_ASSISTANT"
          peerName="Doctor"
          onClose={() => setActiveVideoRoom(null)}
        />
      )}

    </div>
  );
}
