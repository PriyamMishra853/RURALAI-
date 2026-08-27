import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X, Calendar, Zap, Clock, Stethoscope, CheckCircle2,
  AlertTriangle, Loader2, ArrowLeft, RefreshCw
} from 'lucide-react';
import api from '../services/api';

/**
 * Booking flow — spec §6.3.
 *
 * Landing choice, then either:
 *   Instant  — one action; the server finds and atomically reserves a doctor.
 *   Schedule — date strip -> time slot -> doctor -> confirm.
 *
 * Selection order is Time then Doctor (§2.5), because picking a doctor first
 * and then discovering they have no free slots is the more annoying dead end.
 *
 * Every list here is server-computed and re-validated at confirm. A 409 with
 * `refresh: true` means someone booked the slot in between, so the slot list is
 * reloaded rather than the booking silently retried.
 */

export default function ScheduleConsultationModal({ visitId, patientName, onClose, onBooked }) {
  const [step, setStep] = useState('choice');   // choice | date | time | doctor | done
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [slots, setSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [doctors, setDoctors] = useState([]);
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [result, setResult] = useState(null);

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  // ---- date strip ---------------------------------------------------------
  const loadDates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/consultations/availability/dates');
      setDates(res.data.dates || []);
      setSelectedDate(res.data.today);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load availability.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSlots = useCallback(async (date) => {
    setLoading(true);
    setError(null);
    setSelectedSlot(null);
    try {
      const res = await api.get('/consultations/availability/slots', { params: { date } });
      setSlots(res.data.slots || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load time slots.');
      setSlots([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (step === 'date') loadDates();
  }, [step, loadDates]);

  useEffect(() => {
    if (step === 'time' && selectedDate) loadSlots(selectedDate);
  }, [step, selectedDate, loadSlots]);

  // ---- instant ------------------------------------------------------------
  const findDoctorNow = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post('/consultations/instant', { visit_id: visitId });
      setResult(res.data);
      setStep('done');
      onBooked?.(res.data);
    } catch (err) {
      const data = err.response?.data;
      setError(data?.error || 'Could not start an instant consultation.');
      // §2.6 — a clear empty state, with the scheduling path offered instead.
      if (data?.fallback === 'schedule') setStep('date');
    } finally {
      setBusy(false);
    }
  };

  // ---- schedule -----------------------------------------------------------
  const pickSlot = (slot) => {
    setSelectedSlot(slot);
    setDoctors(slot.available_doctors || []);
    setSelectedDoctor(null);
    setStep('doctor');
  };

  const confirm = async () => {
    if (!selectedSlot || !selectedDoctor) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post('/consultations', {
        visit_id: visitId,
        doctor_id: selectedDoctor.id,
        scheduled_start_time: selectedSlot.start_time
      });
      setResult(res.data);
      setStep('done');
      onBooked?.(res.data);
    } catch (err) {
      const data = err.response?.data;
      setError(data?.error || 'The consultation could not be booked.');
      if (data?.refresh) {
        // Someone took it first — go back and show what is actually free now.
        setStep('time');
        loadSlots(selectedDate);
      }
    } finally {
      setBusy(false);
    }
  };

  const timeLabel = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="fixed inset-0 z-50 bg-surface-sunken/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface-raised rounded-card w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl">

        <div className="sticky top-0 bg-surface-raised px-6 py-4 border-b border-line flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            {step !== 'choice' && step !== 'done' && (
              <button
                type="button"
                onClick={() => setStep(step === 'doctor' ? 'time' : step === 'time' ? 'date' : 'choice')}
                aria-label="Back"
                className="p-1.5 rounded-field text-ink-subtle hover:bg-surface-sunken"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div className="min-w-0">
              <h3 className="font-bold text-ink text-base">Video Consultation</h3>
              <p className="text-[11px] text-ink-muted truncate">{patientName}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-field text-ink-subtle hover:bg-surface-sunken">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div role="alert" className="p-3 rounded-field bg-tier-emergencyBg border border-tier-emergency/30 text-xs text-tier-emergency flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* --- Landing choice --- */}
          {step === 'choice' && (
            <div className="grid sm:grid-cols-2 gap-4">
              <button
                type="button"
                onClick={findDoctorNow}
                disabled={busy}
                className="p-5 rounded-card border-2 border-tier-emergency/30 bg-tier-emergencyBg hover:border-red-400 disabled:opacity-60 text-left transition-colors"
              >
                <div className="w-10 h-10 rounded-field bg-tier-emergency text-white flex items-center justify-center mb-3">
                  {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
                </div>
                <div className="font-bold text-sm text-ink">Instant Consultation</div>
                <p className="text-[11px] text-ink-muted mt-1">
                  Find a doctor who is free right now and start immediately.
                </p>
                <span className="inline-block mt-2 text-[11px] font-bold text-tier-emergency">Find Doctor Now →</span>
              </button>

              <button
                type="button"
                onClick={() => setStep('date')}
                className="p-5 rounded-card border-2 border-gov-200 bg-gov-50 hover:border-blue-400 text-left transition-colors"
              >
                <div className="w-10 h-10 rounded-field bg-gov-600 text-white flex items-center justify-center mb-3">
                  <Calendar className="w-5 h-5" />
                </div>
                <div className="font-bold text-sm text-ink">Schedule Consultation</div>
                <p className="text-[11px] text-ink-muted mt-1">
                  Pick a date and time in the next seven days.
                </p>
                <span className="inline-block mt-2 text-[11px] font-bold text-gov-700">Schedule →</span>
              </button>
            </div>
          )}

          {/* --- Date strip (§2.1) --- */}
          {step === 'date' && (
            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-ink-muted">Select a date</h4>
              {loading ? (
                <p className="text-xs text-ink-muted py-8 text-center flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Checking availability…
                </p>
              ) : (
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                  {dates.map((d) => (
                    <button
                      key={d.date}
                      type="button"
                      disabled={d.unavailable || d.available_slots === 0}
                      onClick={() => { setSelectedDate(d.date); setStep('time'); }}
                      className={`p-2.5 rounded-field border text-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                        d.is_today
                          ? 'border-blue-500 bg-gov-50 hover:bg-blue-100'
                          : 'border-line bg-surface-raised hover:border-gov-300'
                      }`}
                    >
                      <div className="text-[10px] font-semibold text-ink-muted">{d.weekday}</div>
                      <div className="text-lg font-bold text-ink leading-tight">{d.day}</div>
                      <div className="text-[9px] text-ink-muted">{d.month}</div>
                      <div className={`text-[9px] font-bold mt-1 ${d.available_slots ? 'text-tier-low' : 'text-ink-subtle'}`}>
                        {d.unavailable ? 'Closed' : `${d.available_doctors} dr`}
                      </div>
                      <div className="text-[9px] text-ink-subtle">
                        {d.unavailable ? '—' : `${d.available_slots} slots`}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-ink-subtle">
                Counts come from each doctor&apos;s working hours and existing bookings, checked just now.
              </p>
            </div>
          )}

          {/* --- Time slots (§2.3) --- */}
          {step === 'time' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-ink-muted">
                  Select a time · {new Date(selectedDate).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}
                </h4>
                <button
                  type="button"
                  onClick={() => loadSlots(selectedDate)}
                  className="text-[11px] text-gov-600 hover:underline flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" /> Refresh
                </button>
              </div>

              {loading ? (
                <p className="text-xs text-ink-muted py-8 text-center flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading slots…
                </p>
              ) : slots.length === 0 ? (
                <div className="p-6 text-center text-xs text-ink-muted border border-dashed border-line-strong rounded-field">
                  No slots remain on this date. Choose another day.
                </div>
              ) : (
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-64 overflow-y-auto">
                  {slots.map((s) => (
                    <button
                      key={s.start_time}
                      type="button"
                      onClick={() => pickSlot(s)}
                      className="px-2 py-2 rounded-field border border-line bg-surface-raised hover:border-blue-400 hover:bg-gov-50 text-xs font-semibold text-ink transition-colors"
                    >
                      {s.label}
                      <span className="block text-[9px] font-normal text-ink-subtle">
                        {s.available_doctors.length} free
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* --- Doctor for that exact time (§2.5) --- */}
          {step === 'doctor' && selectedSlot && (
            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-ink-muted">
                Doctors free at {timeLabel(selectedSlot.start_time)}
              </h4>

              <div className="space-y-2">
                {doctors.map((d) => {
                  const active = selectedDoctor?.id === d.id;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setSelectedDoctor(d)}
                      className={`w-full p-3 rounded-field border text-left flex items-center gap-3 transition-colors ${
                        active ? 'border-blue-500 bg-gov-50 ring-2 ring-blue-200' : 'border-line bg-surface-raised hover:border-gov-300'
                      }`}
                    >
                      <div className={`w-9 h-9 rounded-field flex items-center justify-center shrink-0 ${
                        active ? 'bg-gov-600 text-white' : 'bg-gov-50 text-gov-600'
                      }`}>
                        <Stethoscope className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-xs text-ink truncate">{d.name}</div>
                        <div className="text-[11px] text-gov-700">{d.specialization}</div>
                      </div>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-tier-lowBg text-tier-low border border-tier-low/30 shrink-0">
                        Available
                      </span>
                      {active && <CheckCircle2 className="w-5 h-5 text-gov-600 shrink-0" />}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={confirm}
                disabled={!selectedDoctor || busy}
                className="w-full py-3 rounded-field bg-gov-600 hover:bg-gov-700 disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
                {busy ? 'Booking…' : `Confirm ${timeLabel(selectedSlot.start_time)}`}
              </button>
            </div>
          )}

          {/* --- Done --- */}
          {step === 'done' && result && (
            <div className="text-center space-y-4 py-4">
              <div className="w-14 h-14 rounded-full bg-tier-lowBg text-tier-low border border-tier-low/30 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <div>
                <h4 className="font-bold text-ink">
                  {result.consultation_type === 'INSTANT' ? 'Doctor found — starting now' : 'Consultation booked'}
                </h4>
                <p className="text-xs text-ink-muted mt-1">
                  {result.doctor?.full_name || result.doctor_name}
                  {result.scheduled_start_time && (
                    <> · {new Date(result.scheduled_start_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</>
                  )}
                </p>
                <p className="text-[11px] text-ink-subtle mt-1">
                  Both you and the doctor have been notified.
                </p>
              </div>

              <div className="flex gap-2 justify-center">
                {(result.join_action === 'JOIN' || result.join_action === 'REJOIN' || result.status === 'ACTIVE') && (
                  <button
                    type="button"
                    onClick={() => navigate(`/call/${result.id}`)}
                    className="px-5 py-2.5 rounded-field bg-tier-low hover:opacity-90 text-white font-semibold text-xs"
                  >
                    Join now
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2.5 rounded-field border border-line-strong text-ink-muted font-semibold text-xs hover:bg-surface-sunken"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
