import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  UserPlus, Search, Activity, Users, CheckCircle2, Video, PhoneCall,
  AlertCircle, Clock, History, Siren, RefreshCw, Inbox, ChevronRight
} from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import { TierBadge } from '../components/TierSystem';
import { maskAadhaar, digitsOnly } from '../config/patientFields';
import { Button, Card, CardHeader, Stat, Alert, EmptyState, Spinner, Badge, cn } from '../components/ui';

/**
 * Clinic assistant workspace.
 *
 * §3.9 asks for the 5–10 most recently handled patients as a recency stack, plus
 * add-new and search, plus the emergency bypass. The recency stack is the
 * primary surface because the same patient is very often seen twice in a week
 * at a sub-centre, and making the assistant search for someone they saw an hour
 * ago is the wrong default.
 */

const RECENT_LIMIT = 8;

export default function AssistantDashboard() {
  const { user } = useAuth();
  const { subscribe } = useRealtime();
  const navigate = useNavigate();

  const [patients, setPatients] = useState([]);
  const [total, setTotal] = useState(0);
  const [consultations, setConsultations] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async (opts = {}) => {
    if (opts.silent) setRefreshing(true);
    try {
      const [pRes, cRes] = await Promise.all([
        api.get('/patients'),
        api.get('/consultations', { params: { scope: 'today' } })
          .catch(() => ({ data: { consultations: [] } }))
      ]);
      setPatients(pRes.data?.patients ?? []);
      setTotal(pRes.data?.total ?? 0);
      setConsultations(
        (cRes.data?.consultations ?? []).filter((c) => ['SCHEDULED', 'ACTIVE'].includes(c.status))
      );
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load your workspace.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => subscribe((msg) => {
    if (msg.type === 'notification') fetchData({ silent: true });
  }), [subscribe, fetchData]);

  useEffect(() => {
    const t = setInterval(() => fetchData({ silent: true }), 30000);
    return () => clearInterval(t);
  }, [fetchData]);

  const today = new Date().toDateString();
  const registeredToday = patients.filter((p) => new Date(p.created_at).toDateString() === today).length;

  /** The recency stack — most recently registered first. */
  const recent = useMemo(() => patients.slice(0, RECENT_LIMIT), [patients]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const digits = digitsOnly(q);
    return patients.filter((p) =>
      (p.full_name || '').toLowerCase().includes(q) ||
      (digits && (p.aadhaar_number || '').includes(digits)) ||
      (digits && (p.phone || '').includes(digits)) ||
      (p.village_line1 || '').toLowerCase().includes(q)
    );
  }, [patients, query]);

  const startVisit = (aadhaar) => navigate(`/assistant/assessment/${aadhaar}`);

  const PatientRow = ({ p, index }) => (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.04, 0.24) }}
      onClick={() => startVisit(p.aadhaar_number)}
      className="w-full text-left p-3 sm:p-4 rounded-card border border-line bg-surface-raised hover:border-gov-300 hover:shadow-raised transition-all flex items-center gap-3"
    >
      <span className="w-10 h-10 rounded-full bg-gov-50 dark:bg-gov-100 text-gov-600 dark:text-gov-500 flex items-center justify-center shrink-0 font-bold text-sm">
        {(p.full_name || '?').charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink truncate">{p.full_name}</p>
        <p className="text-xs text-ink-muted truncate">
          {p.age_display || '—'} · {p.gender} · {p.village_line1}
        </p>
        <p className="text-[10px] text-ink-subtle font-mono truncate">
          {maskAadhaar(p.aadhaar_number)} · {p.phone}
        </p>
      </div>
      <span className="hidden sm:flex items-center gap-1 text-xs font-semibold text-gov-600 dark:text-gov-500 shrink-0">
        Start visit <ChevronRight className="w-4 h-4" />
      </span>
      <ChevronRight className="w-4 h-4 text-ink-subtle sm:hidden shrink-0" />
    </motion.button>
  );

  return (
    <div className="space-y-5">

      {/* ---- Header ---- */}
      <Card className="p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <span className="w-11 h-11 rounded-field bg-gov-50 dark:bg-gov-100 text-gov-600 dark:text-gov-500 flex items-center justify-center shrink-0">
              <Users className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <h1 className="font-display text-lg sm:text-xl font-bold text-ink truncate">
                Clinic Assistant Workspace
              </h1>
              <p className="text-xs text-ink-muted truncate">
                {user?.name}{user?.district ? ` · ${user.district} sub-centre` : ''}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => fetchData({ silent: true })} aria-label="Refresh">
              <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
            </Button>
            <Link to="/assistant/patients/new">
              <Button><UserPlus className="w-4 h-4" /> Register patient</Button>
            </Link>
          </div>
        </div>
      </Card>

      {error && <Alert tone="danger" icon={AlertCircle}>{error}</Alert>}

      {/* ---- Stats ---- */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Stat label="Registered patients" value={total} icon={Users} />
        <Stat label="Registered today" value={registeredToday} tone="low" icon={CheckCircle2} />
        <Stat label="Open consultations" value={consultations.length} tone="moderate" icon={Video} />
      </div>

      {/* ---- Live consultations ---- */}
      {consultations.length > 0 && (
        <Card>
          <CardHeader title="Video consultations today" icon={Video} />
          <div className="p-4 sm:p-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {consultations.map((c) => {
              const p = c.visits?.patients || c.patients;
              const canJoin = c.join_action === 'JOIN' || c.join_action === 'REJOIN';
              return (
                <div key={c.id} className="p-4 rounded-card border border-line bg-surface-sunken flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <TierBadge level={c.visits?.risk_level} size="sm" />
                    <Badge tone={c.status === 'ACTIVE' ? 'low' : 'neutral'}>
                      {c.status === 'ACTIVE' ? 'Live' : c.status}
                    </Badge>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-ink truncate">{p?.full_name || 'Patient'}</p>
                    <p className="text-xs text-ink-muted line-clamp-2">{c.visits?.chief_complaint}</p>
                    <p className="text-[11px] text-tier-moderate flex items-center gap-1 mt-1">
                      <Clock className="w-3.5 h-3.5" />
                      {new Date(c.scheduled_start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={canJoin ? 'primary' : 'secondary'}
                    disabled={!canJoin}
                    onClick={() => navigate(`/call/${c.id}`)}
                    className="w-full"
                  >
                    <PhoneCall className="w-3.5 h-3.5" /> {c.join_label}
                  </Button>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* ---- Search ---- */}
      <Card>
        <CardHeader
          title={searchResults ? `Search results (${searchResults.length})` : 'Recently handled'}
          subtitle={searchResults
            ? 'Matching name, Aadhaar, phone or village'
            : `The last ${RECENT_LIMIT} patients registered at this sub-centre`}
          icon={searchResults ? Search : History}
          action={
            <div className="relative w-40 sm:w-64">
              <Search className="w-4 h-4 text-ink-subtle absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search patients"
                aria-label="Search patients"
                className="field pl-9 py-2 text-xs"
              />
            </div>
          }
        />

        <div className="p-4 sm:p-5">
          {loading ? (
            <Spinner label="Loading your patients…" />
          ) : (searchResults ?? recent).length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={searchResults ? 'No patients match that search' : 'No patients registered yet'}
              description={searchResults
                ? 'Try a name, the full 12-digit Aadhaar, or a phone number.'
                : 'Register the first patient to begin.'}
              action={
                searchResults
                  ? <Button size="sm" variant="secondary" onClick={() => setQuery('')}>Clear search</Button>
                  : <Link to="/assistant/patients/new"><Button size="sm"><UserPlus className="w-4 h-4" /> Register patient</Button></Link>
              }
            />
          ) : (
            <div className="grid gap-2 sm:gap-3">
              {(searchResults ?? recent).map((p, i) => (
                <PatientRow key={p.aadhaar_number} p={p} index={i} />
              ))}
            </div>
          )}

          {!searchResults && total > recent.length && (
            <p className="mt-3 text-[11px] text-ink-subtle text-center">
              Showing the {recent.length} most recent of {total}. Use search to find any other patient.
            </p>
          )}
        </div>
      </Card>

      {/* ---- Emergency bypass ---- */}
      <Card className="border-l-4 border-l-tier-emergency">
        <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <span className="w-11 h-11 rounded-field bg-tier-emergencyBg text-tier-emergency flex items-center justify-center shrink-0">
            <Siren className="w-5 h-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-ink">Emergency — patient not registered</h3>
            <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">
              For a genuinely urgent case, search the register first — most patients are
              already on it. If they are not, register with the minimum fields and
              reconcile the record afterwards. Do not delay care to complete a form.
            </p>
          </div>
          <Link to="/assistant/patients/new" className="shrink-0">
            <Button variant="danger" size="sm">
              <Activity className="w-4 h-4" /> Urgent registration
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
