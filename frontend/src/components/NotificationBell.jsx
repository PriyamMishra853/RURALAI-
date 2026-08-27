import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Wifi, WifiOff, Video, CalendarClock, XCircle, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useRealtime } from '../context/RealtimeContext';

/**
 * Notification bell — live consultation events for the signed-in user.
 *
 * The connection state is shown deliberately. If the socket is down the user
 * is still seeing notifications (they are polled and persisted), but they are
 * no longer arriving the instant they happen — and someone waiting on a doctor
 * to join a call needs to know which of those two situations they are in.
 */

const EVENT_STYLE = {
  CONSULTATION_SCHEDULED: { icon: CalendarClock, tone: 'text-gov-600 bg-gov-50', label: 'Consultation booked' },
  CONSULTATION_REMINDER:  { icon: CalendarClock, tone: 'text-tier-moderate bg-tier-moderateBg', label: 'Starting soon' },
  CONSULTATION_STARTED:   { icon: Video, tone: 'text-tier-low bg-tier-lowBg', label: 'Consultation started' },
  CONSULTATION_CANCELLED: { icon: XCircle, tone: 'text-tier-emergency bg-tier-emergencyBg', label: 'Consultation cancelled' },
  CONSULTATION_COMPLETED: { icon: CheckCircle2, tone: 'text-ink-muted bg-surface-sunken', label: 'Consultation completed' },
  CONSULTATION_FAILED:    { icon: AlertTriangle, tone: 'text-tier-emergency bg-tier-emergencyBg', label: 'Video session failed' }
};

const timeAgo = (iso) => {
  const secs = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
};

export default function NotificationBell() {
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
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        className="relative p-2 rounded-field text-ink-muted hover:bg-surface-sunken transition-colors"
      >
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-tier-emergency text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
        <span
          title={connected ? 'Live updates connected' : 'Reconnecting — updates may be delayed'}
          className={`absolute bottom-0.5 right-0.5 w-2 h-2 rounded-full ${connected ? 'bg-tier-low' : 'bg-tier-moderate animate-pulse'}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 max-h-[70vh] overflow-y-auto bg-surface-raised rounded-field border border-line shadow-xl z-50">
          <div className="sticky top-0 bg-surface-raised px-4 py-3 border-b border-line flex items-center justify-between">
            <h3 className="text-sm font-bold text-ink">Notifications</h3>
            <span className={`text-[10px] font-semibold flex items-center gap-1 ${connected ? 'text-tier-low' : 'text-tier-moderate'}`}>
              {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {connected ? 'Live' : 'Reconnecting'}
            </span>
          </div>

          {notifications.length === 0 ? (
            <p className="p-8 text-center text-xs text-ink-muted">Nothing yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {notifications.map((n) => {
                const style = EVENT_STYLE[n.event_type] || EVENT_STYLE.CONSULTATION_SCHEDULED;
                const Icon = style.icon;
                const p = n.payload || {};
                const joinable = n.event_type === 'CONSULTATION_STARTED' || n.event_type === 'CONSULTATION_REMINDER';

                return (
                  <li key={n.id} className={`px-4 py-3 ${n.read_at ? '' : 'bg-gov-50/40'}`}>
                    <div className="flex gap-3">
                      <div className={`w-8 h-8 rounded-field flex items-center justify-center shrink-0 ${style.tone}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-ink">{style.label}</p>
                        <p className="text-[11px] text-ink-muted truncate">
                          {p.patient_name && <>{p.patient_name}</>}
                          {p.doctor_name && <> · {p.doctor_name}</>}
                        </p>
                        {p.scheduled_time && (
                          <p className="text-[11px] text-ink-muted">
                            {new Date(p.scheduled_time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                          </p>
                        )}
                        {p.reason && <p className="text-[11px] text-tier-emergency mt-0.5">{p.reason}</p>}
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-ink-subtle">{timeAgo(n.created_at)}</span>
                          {joinable && n.consultation_id && (
                            <button
                              type="button"
                              onClick={() => { setOpen(false); navigate(`/call/${n.consultation_id}`); }}
                              className="text-[10px] font-bold text-tier-low hover:underline"
                            >
                              Join now
                            </button>
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
