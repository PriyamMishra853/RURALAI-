import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, Wifi, WifiOff, Video, CalendarClock, XCircle, CheckCircle2,
  AlertTriangle, Inbox, Stethoscope, ChevronRight
} from 'lucide-react';
import { useRealtime } from '../context/RealtimeContext';
import { useI18n } from '../i18n/index.jsx';

/**
 * Notification bell — live events for the signed-in user.
 *
 * The connection state is shown deliberately. If the socket is down the user
 * is still seeing notifications (they are polled and persisted), but they are
 * no longer arriving the instant they happen — and someone waiting on a doctor
 * to join a call needs to know which of those two situations they are in.
 *
 * Every event here is something a person has to act on, so each row carries
 * the destination for that action. The two ends of the case loop are the
 * point: a doctor is told a case arrived and can open it, and the assistant
 * standing with the patient is told the decision came back and can go read it.
 */

const EVENT_STYLE = {
  CONSULTATION_SCHEDULED: { icon: CalendarClock, tone: 'text-gov-600 bg-gov-50', key: 'notify.scheduled', label: 'Consultation booked' },
  CONSULTATION_REMINDER:  { icon: CalendarClock, tone: 'text-tier-moderate bg-tier-moderateBg', key: 'notify.reminder', label: 'Starting soon' },
  CONSULTATION_STARTED:   { icon: Video, tone: 'text-tier-low bg-tier-lowBg', key: 'notify.started', label: 'Consultation started' },
  CONSULTATION_CANCELLED: { icon: XCircle, tone: 'text-tier-emergency bg-tier-emergencyBg', key: 'notify.cancelled', label: 'Consultation cancelled' },
  CONSULTATION_COMPLETED: { icon: CheckCircle2, tone: 'text-ink-muted bg-surface-sunken', key: 'notify.completed', label: 'Consultation completed' },
  CONSULTATION_FAILED:    { icon: AlertTriangle, tone: 'text-tier-emergency bg-tier-emergencyBg', key: 'notify.failed', label: 'Video session failed' },
  CASE_ASSIGNED:          { icon: Inbox, tone: 'text-gov-600 bg-gov-50', key: 'notify.caseAssigned', label: 'New case for review' },
  DOCTOR_REVIEW_COMPLETED:{ icon: Stethoscope, tone: 'text-tier-low bg-tier-lowBg', key: 'notify.reviewDone', label: 'Doctor’s decision received' }
};

// Anything not listed above is still shown, plainly. It used to fall through to
// the CONSULTATION_SCHEDULED style, so a new event type would be confidently
// mislabelled "Consultation booked" — which is worse than saying nothing.
const FALLBACK_STYLE = { icon: Bell, tone: 'text-ink-muted bg-surface-sunken', key: 'notify.update', label: 'Update' };

/* The keys on the left are the stored decision values and never change. */
const DECISION_LABEL = {
  prescribe: ['decision.prescribe', 'Prescription issued'],
  treat_locally: ['decision.treatLocally', 'Treat locally'],
  follow_up: ['decision.followUp', 'Follow-up scheduled'],
  refer_hospital: ['decision.referHospital', 'Referred to hospital'],
  no_action_needed: ['decision.noAction', 'No action needed']
};

/**
 * Where this notification takes you, if anywhere.
 *
 * The assistant's assessment screen is addressed by patient, the doctor's case
 * view by visit, and a call by consultation — so each event resolves its own.
 */
const destinationFor = (n, t) => {
  const p = n.payload || {};
  switch (n.event_type) {
    case 'CONSULTATION_STARTED':
    case 'CONSULTATION_REMINDER':
      return n.consultation_id
        ? { to: `/call/${n.consultation_id}`, label: t('notify.joinNow', 'Join now') }
        : null;
    case 'CASE_ASSIGNED':
      return p.visit_id
        ? { to: `/doctor/cases/${p.visit_id}`, label: t('notify.openCase', 'Open case') }
        : null;
    case 'DOCTOR_REVIEW_COMPLETED':
      return p.patient_id
        ? { to: `/assistant/assessment/${p.patient_id}`, label: t('notify.viewDecision', 'View decision') }
        : null;
    default:
      return null;
  }
};

/** The one line of detail that matters for this event. */
/*
 * Counted nouns get one key per number rather than an English "s" appended.
 *
 * "1 photo / 2 photos" is an English rule and only an English rule. Hindi
 * inflects differently, Tamil differently again, and several of the languages
 * here do not mark plurals on a counted noun at all. Two keys let each locale
 * answer the question in its own grammar; English keeps the behaviour it had.
 */
const counted = (t, one, many, count, fallbackOne, fallbackMany, display) =>
  (count === 1
    ? t(one, fallbackOne, { count: display })
    : t(many, fallbackMany, { count: display }));

const detailFor = (n, t, formatNumber) => {
  const p = n.payload || {};
  const num = (v) => formatNumber(v);

  if (n.event_type === 'CASE_ASSIGNED') {
    const c = p.contents || {};
    const bits = [];
    if (c.vitals) bits.push(t('notify.count.vitals', '{count} vitals', { count: num(c.vitals) }));
    if (c.images) {
      bits.push(counted(t, 'notify.count.photo', 'notify.count.photos', c.images,
        '{count} photo', '{count} photos', num(c.images)));
    }
    if (c.documents) {
      bits.push(counted(t, 'notify.count.doc', 'notify.count.docs', c.documents,
        '{count} doc', '{count} docs', num(c.documents)));
    }
    if (c.ai_assessment) bits.push(t('notify.aiAssessment', 'AI assessment'));
    return bits.join(' · ') || null;
  }

  if (n.event_type === 'DOCTOR_REVIEW_COMPLETED') {
    const decision = DECISION_LABEL[p.decision];
    const parts = [decision ? t(decision[0], decision[1]) : p.decision].filter(Boolean);
    if (p.medicines) {
      parts.push(counted(t, 'notify.count.medicine', 'notify.count.medicines', p.medicines,
        '{count} medicine', '{count} medicines', num(p.medicines)));
    }
    return parts.join(' · ') || null;
  }
  return null;
};

/*
 * "5m ago" is not a phrase that survives translation as a template — the unit
 * abbreviation, the word order and whether the number leads all vary. Two keys
 * per unit, and anything older than a day falls back to a real formatted date,
 * which Intl already renders correctly for the locale.
 */
const timeAgo = (iso, t, formatDate, formatNumber) => {
  const secs = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (secs < 60) return t('time.justNow', 'just now');
  if (secs < 3600) {
    return t('time.minutesAgo', '{count}m ago', { count: formatNumber(Math.floor(secs / 60)) });
  }
  if (secs < 86400) {
    return t('time.hoursAgo', '{count}h ago', { count: formatNumber(Math.floor(secs / 3600)) });
  }
  return formatDate(iso, { day: 'numeric', month: 'short' });
};

export default function NotificationBell() {
  const { t, formatDate, formatNumber } = useI18n();
  const { notifications, unread, connected, markAllRead } = useRealtime();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) markAllRead();
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        aria-label={unread
          ? t('notify.bellUnread', 'Notifications, {count} unread', { count: formatNumber(unread) })
          : t('nav.notifications', 'Notifications')}
        className="relative p-2 rounded-field text-ink-muted hover:bg-surface-sunken transition-colors"
      >
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-tier-emergency text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 9 ? '9+' : formatNumber(unread)}
          </span>
        )}
        <span
          title={connected
            ? t('notify.liveConnected', 'Live updates connected')
            : t('notify.reconnecting', 'Reconnecting — updates may be delayed')}
          className={`absolute bottom-0.5 right-0.5 w-2 h-2 rounded-full ${connected ? 'bg-tier-low' : 'bg-tier-moderate animate-pulse'}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 max-h-[70vh] overflow-y-auto bg-surface-raised rounded-field border border-line shadow-xl z-50">
          <div className="sticky top-0 bg-surface-raised px-4 py-3 border-b border-line flex items-center justify-between">
            <h3 className="text-sm font-bold text-ink">{t('nav.notifications', 'Notifications')}</h3>
            <span className={`text-[10px] font-semibold flex items-center gap-1 ${connected ? 'text-tier-low' : 'text-tier-moderate'}`}>
              {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {connected ? t('notify.live', 'Live') : t('notify.reconnectingShort', 'Reconnecting')}
            </span>
          </div>

          {notifications.length === 0 ? (
            <p className="p-8 text-center text-xs text-ink-muted">{t('notify.empty', 'Nothing yet.')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {notifications.map((n) => {
                const style = EVENT_STYLE[n.event_type] || FALLBACK_STYLE;
                const Icon = style.icon;
                const p = n.payload || {};
                const destination = destinationFor(n, t);
                const detail = detailFor(n, t, formatNumber);

                // The whole row is the target when there is somewhere to go —
                // a notification you have to hunt for the link inside is one
                // more step for someone standing with a patient.
                const go = () => {
                  if (!destination) return;
                  setOpen(false);
                  navigate(destination.to);
                };

                return (
                  <li key={n.id} className={n.read_at ? '' : 'bg-gov-50/40'}>
                    <div
                      role={destination ? 'button' : undefined}
                      tabIndex={destination ? 0 : undefined}
                      onClick={go}
                      onKeyDown={(e) => {
                        if (!destination) return;
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
                      }}
                      className={`w-full text-left px-4 py-3 flex gap-3 ${
                        destination ? 'cursor-pointer hover:bg-surface-sunken transition-colors' : ''
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-field flex items-center justify-center shrink-0 ${style.tone}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-ink flex items-center gap-1.5">
                          {t(style.key, style.label)}
                          {p.risk_level && (
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
                              p.risk_level === 'emergency' || p.risk_level === 'high'
                                ? 'bg-tier-emergencyBg text-tier-emergency'
                                : p.risk_level === 'moderate'
                                  ? 'bg-tier-moderateBg text-tier-moderate'
                                  : 'bg-tier-lowBg text-tier-low'
                            }`}>
                              {t('tier.' + String(p.risk_level).toLowerCase(), p.risk_level)}
                            </span>
                          )}
                        </p>

                        <p className="text-[11px] text-ink-muted truncate">
                          {p.patient_name}
                          {p.doctor_name && <> · {p.doctor_name}</>}
                          {p.assistant_name && <> · {t('notify.from', 'from {name}', { name: p.assistant_name })}</>}
                        </p>

                        {detail && <p className="text-[11px] text-ink-muted truncate">{detail}</p>}

                        {p.scheduled_time && (
                          <p className="text-[11px] text-ink-muted">
                            {formatDate(p.scheduled_time, { dateStyle: 'short', timeStyle: 'short' })}
                          </p>
                        )}
                        {p.reason && <p className="text-[11px] text-tier-emergency mt-0.5">{p.reason}</p>}

                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-ink-subtle">
                            {timeAgo(n.created_at, t, formatDate, formatNumber)}
                          </span>
                          {destination && (
                            <span className="text-[10px] font-bold text-gov-600 flex items-center gap-0.5">
                              {destination.label} <ChevronRight className="w-3 h-3" />
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
