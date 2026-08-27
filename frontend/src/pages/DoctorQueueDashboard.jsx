import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Stethoscope, AlertCircle, RefreshCw, PhoneCall, Video, Clock, ChevronRight,
  CalendarDays, Lock, Search, Inbox, Activity, XCircle, Loader2
} from 'lucide-react';
import api from '../services/api';
import { TierBadge, TIER_META } from '../components/TierSystem';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import { maskAadhaar, digitsOnly } from '../config/patientFields';

/**
 * Doctor review queue.
 *
 * Shows only cases assigned to the signed-in doctor, one day at a time,
 * ordered EMERGENCY -> HIGH -> MODERATE -> LOW. The server does the filtering
 * and the ordering; this page renders what it is given.
 *
 * Past days are read-only. An untouched case from last week is a governance
 * problem for an administrator, not something a doctor should quietly action
 * now as if it were today's work — so the queue opens on today, the picker
 * offers today forward, and the server rejects a review on a past visit even
 * if a stale tab tries.
 */

// Tier styling comes from the shared visual system so the queue, the case
// file and the landing page cannot drift apart.
const TIERS = ['emergency', 'high', 'moderate', 'low'];

const todayIso = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

export default function DoctorQueueDashboard() {
  const { user } = useAuth();
  const { subscribe } = useRealtime();
  const navigate = useNavigate();

  const [cases, setCases] = useState([]);
  const [counts, setCounts] = useState({ emergency: 0, high: 0, moderate: 0, low: 0 });
  const [dates, setDates] = useState([]);
  const [date, setDate] = useState(todayIso);
  const [readOnly, setReadOnly] = useState(false);
  const [consultations, setConsultations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [query, setQuery] = useState('');
  const [tierFilter, setTierFilter] = useState('all');
  const [joining, setJoining] = useState(null);

  const fetchAll = useCallback(async (opts = {}) => {
    if (opts.silent) setRefreshing(true);
    try {
      const [qRes, cRes, dRes] = await Promise.all([
        api.get('/doctor/queue', { params: { date } }),
        api.get('/consultations', { params: { scope: 'today' } }).catch(() => ({ data: { consultations: [] } })),
        api.get('/doctor/queue/dates').catch(() => ({ data: { dates: [] } }))
      ]);

      setCases(qRes.data?.cases ?? []);
      setCounts(qRes.data?.counts ?? { emergency: 0, high: 0, moderate: 0, low: 0 });
      setReadOnly(Boolean(qRes.data?.read_only));
      setConsultations((cRes.data?.consultations ?? []).filter((c) => ['SCHEDULED', 'ACTIVE'].includes(c.status)));
      setDates(dRes.data?.dates ?? []);
      setFetchError(null);
    } catch (err) {
      setFetchError(err.response?.data?.error || err.message || 'Could not reach the API.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [date]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Live: a new consultation or a state change refreshes the queue without a
  // poll, so the doctor sees an incoming call the moment it is created.
  useEffect(() => subscribe((msg) => {
    if (msg.type === 'notification') fetchAll({ silent: true });
  }), [subscribe, fetchAll]);

  useEffect(() => {
    const t = setInterval(() => fetchAll({ silent: true }), 30000);
    return () => clearInterval(t);
  }, [fetchAll]);

  const joinCall = async (consultationId) => {
    setJoining(consultationId);
    try {
      navigate(`/call/${consultationId}`);
    } finally {
      setJoining(null);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = digitsOnly(q);
    return cases.filter((c) => {
      if (tierFilter !== 'all' && c.risk_level !== tierFilter) return false;
      if (!q) return true;
      const p = c.patients || {};
      return (
        (p.full_name || '').toLowerCase().includes(q) ||
        (c.chief_complaint || '').toLowerCase().includes(q) ||
        (c.visit_code || '').toLowerCase().includes(q) ||
        (digits && (p.aadhaar_number || '').includes(digits))
      );
    });
  }, [cases, query, tierFilter]);

  const total = cases.length;

  return (
    <div className="space-y-5">

      {/* ---- Header ---- */}
      <div className="bg-surface-raised rounded-card border border-line shadow-sm p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-11 h-11 rounded-card bg-gov-50 text-gov-600 border border-gov-200 flex items-center justify-center shrink-0">
              <Stethoscope className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold text-ink truncate">My Review Queue</h1>
              <p className="text-xs text-ink-muted">
                {user?.name}
                {user?.district ? ` · ${user.district}` : ''} · sorted worst first
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 bg-surface-sunken border border-line rounded-field px-3 py-2">
              <CalendarDays className="w-4 h-4 text-ink-subtle shrink-0" />
              <input
                type="date"
                value={date}
                onChange={(e) => { setLoading(true); setDate(e.target.value); }}
                max={todayIso()}
                aria-label="Queue date"
                className="bg-transparent text-xs text-ink outline-none w-[7.5rem]"
              />
            </div>
            {date !== todayIso() && (
              <button
                type="button"
                onClick={() => { setLoading(true); setDate(todayIso()); }}
                className="px-3 py-2 rounded-field border border-line-strong text-ink-muted text-xs font-semibold hover:bg-surface-sunken"
              >
                Today
              </button>
            )}
            <button
              type="button"
              onClick={() => fetchAll({ silent: true })}
              disabled={refreshing}
              aria-label="Refresh queue"
              className="p-2 rounded-field border border-line-strong text-ink-muted hover:bg-surface-sunken disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {readOnly && (
        <div className="p-3 rounded-field bg-surface-sunken border border-line-strong text-xs text-ink-muted flex items-center gap-2">
          <Lock className="w-4 h-4 shrink-0" />
          <span>
            <strong>Read-only.</strong> This is a past date — cases here can be viewed but not reviewed.
            An untouched case from a previous day needs an administrator to reassign it.
          </span>
        </div>
      )}

      {fetchError && (
        <div role="alert" className="p-4 rounded-field bg-tier-emergencyBg border border-tier-emergency/30 text-xs text-tier-emergency flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <span className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span><strong>Could not load the queue:</strong> {fetchError}</span>
          </span>
          <button
            type="button"
            onClick={() => { setLoading(true); fetchAll(); }}
            className="px-3 py-1.5 rounded bg-tier-emergency text-white font-semibold text-xs hover:opacity-90 flex items-center gap-1 shrink-0 self-start"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </button>
        </div>
      )}

      {/* ---- Triage counts, also the tier filter ---- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {TIERS.map((tier) => {
          const meta = TIER_META[tier];
          const active = tierFilter === tier;
          return (
            <button
              key={tier}
              type="button"
              onClick={() => setTierFilter(active ? 'all' : tier)}
              aria-pressed={active}
              className={`bg-surface-raised p-4 rounded-card border shadow-sm text-left transition-all ${
                active ? 'border-transparent ring-2 ring-gov-500' : 'border-line hover:border-line-strong'
              }`}
            >
              <p className="text-xs text-ink-muted font-medium">{meta.label}</p>
              <h3 className={`text-2xl font-bold mt-0.5 ${meta.text}`}>{counts[tier] ?? 0}</h3>
              <p className="text-[10px] text-ink-subtle mt-0.5">{active ? 'Filtering — tap to clear' : 'Tap to filter'}</p>
            </button>
          );
        })}
      </div>

      {/* ---- Day picker chips ---- */}
      {dates.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {dates.slice(0, 10).map((d) => (
            <button
              key={d.date}
              type="button"
              onClick={() => { setLoading(true); setDate(d.date); }}
              className={`px-3 py-1.5 rounded-field border text-[11px] font-semibold transition-colors ${
                d.date === date
                  ? 'bg-gov-600 border-blue-600 text-white'
                  : 'bg-surface-raised border-line-strong text-ink-muted hover:border-gov-300'
              }`}
            >
              {new Date(d.date).toLocaleDateString([], { day: 'numeric', month: 'short' })}
              <span className="ml-1.5 opacity-70">{d.total}</span>
              {d.urgent > 0 && <span className="ml-1 text-tier-emergency font-bold">•{d.urgent}</span>}
            </button>
          ))}
        </div>
      )}

      {/* ---- Live consultations ---- */}
      {consultations.length > 0 && (
        <div className="bg-surface-raised rounded-card p-5 sm:p-6 border border-line shadow-sm space-y-4">
          <h2 className="text-sm font-bold text-ink flex items-center gap-2">
            <Video className="w-4 h-4 text-gov-600" /> Video consultations today
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {consultations.map((c) => {
              const p = c.patients;
              const live = c.status === 'ACTIVE';
              const canJoin = c.join_action === 'JOIN' || c.join_action === 'REJOIN';
              return (
                <div key={c.id} className="p-4 rounded-field bg-surface-sunken border border-line flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <TierBadge level={c.visits?.risk_level} size="sm" />
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                      live ? 'bg-tier-lowBg text-tier-low' : 'bg-surface-sunken text-ink-muted'
                    }`}>
                      {live ? 'LIVE' : c.status}
                    </span>
                  </div>

                  <div className="min-w-0">
                    <div className="font-bold text-sm text-ink truncate">{p?.full_name || 'Patient'}</div>
                    {p?.aadhaar_number && (
                      <div className="text-[11px] text-ink-muted font-mono">{maskAadhaar(p.aadhaar_number)}</div>
                    )}
                    <div className="text-xs text-ink-muted mt-1 line-clamp-2">{c.visits?.chief_complaint}</div>
                    <div className="text-[11px] text-tier-moderate flex items-center gap-1 mt-1 font-medium">
                      <Clock className="w-3.5 h-3.5 shrink-0" />
                      {new Date(c.scheduled_start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => joinCall(c.id)}
                    disabled={!canJoin || joining === c.id}
                    title={canJoin ? undefined : c.join_label}
                    className={`w-full py-2.5 rounded-field font-semibold text-xs flex items-center justify-center gap-2 transition-colors ${
                      canJoin
                        ? 'bg-gov-600 hover:bg-gov-700 text-white'
                        : 'bg-surface-sunken text-ink-muted cursor-not-allowed'
                    }`}
                  >
                    {joining === c.id
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : canJoin ? <PhoneCall className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                    {c.join_label}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ---- Case list ---- */}
      <div className="bg-surface-raised rounded-card p-5 sm:p-6 border border-line shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-ink">
            Cases for {new Date(date).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })}
            <span className="ml-2 font-normal text-ink-subtle">
              {filtered.length}{filtered.length !== total ? ` of ${total}` : ''}
            </span>
          </h2>
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-ink-subtle absolute left-3 top-2.5" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, complaint, Aadhaar or visit code"
              aria-label="Search cases"
              className="w-full bg-surface-raised border border-line-strong rounded-field pl-9 pr-4 py-2 text-xs text-ink focus:border-gov-500 outline-none"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-10 text-center text-xs text-ink-muted flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 text-gov-600 animate-spin" /> Loading your queue…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center border border-dashed border-line rounded-field space-y-2">
            <Inbox className="w-8 h-8 text-ink-subtle mx-auto" />
            <p className="text-xs text-ink-muted">
              {total === 0 ? 'No cases assigned to you on this date.' : 'No cases match your search.'}
            </p>
            {total === 0 && dates.length > 0 && (
              <p className="text-[11px] text-ink-subtle">
                You have cases on {dates.slice(0, 3).map((d) =>
                  new Date(d.date).toLocaleDateString([], { day: 'numeric', month: 'short' })).join(', ')}.
              </p>
            )}
            {(query || tierFilter !== 'all') && (
              <button
                type="button"
                onClick={() => { setQuery(''); setTierFilter('all'); }}
                className="text-[11px] font-semibold text-gov-600 hover:underline inline-flex items-center gap-1"
              >
                <XCircle className="w-3 h-3" /> Clear filters
              </button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {filtered.map((c) => {
              const p = c.patients || {};
              const assessment = Array.isArray(c.ai_assessments) ? c.ai_assessments[0] : c.ai_assessments;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/doctor/cases/${c.id}`)}
                    className="w-full py-4 px-2 -mx-2 rounded-field text-left hover:bg-surface-sunken transition-colors flex items-start sm:items-center gap-3 sm:gap-4"
                  >
                    <div className="shrink-0 pt-0.5 sm:pt-0"><TierBadge level={c.risk_level} size="sm" /></div>

                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm text-ink truncate">
                        {p.full_name || 'Patient'}
                        <span className="ml-2 text-[11px] font-normal text-ink-muted">
                          {p.age_display || ''}{p.gender ? ` · ${p.gender}` : ''}
                        </span>
                      </div>
                      <div className="text-xs text-ink-muted line-clamp-1">
                        {c.chief_complaint || 'No complaint recorded'}
                        {c.symptom_duration ? ` · ${c.symptom_duration}` : ''}
                      </div>
                      <div className="text-[11px] text-ink-subtle font-mono truncate">
                        {maskAadhaar(p.aadhaar_number)} · {c.visit_code}
                      </div>
                      {assessment?.recommended_next_action && (
                        <span className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-bold px-2 py-0.5 rounded bg-gov-50 text-gov-700 border border-gov-200">
                          <Activity className="w-3 h-3" />
                          {assessment.recommended_next_action.replace(/_/g, ' ')}
                        </span>
                      )}
                    </div>

                    <div className="hidden sm:flex flex-col items-end gap-1 shrink-0">
                      <span className="text-[11px] text-ink-subtle">
                        {new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="text-[11px] font-semibold text-gov-600 flex items-center gap-0.5">
                        {readOnly ? 'View' : 'Review'} <ChevronRight className="w-3.5 h-3.5" />
                      </span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-ink-subtle sm:hidden shrink-0 self-center" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
