import React, { useEffect, useState } from 'react';
import { Home, Mic, ShieldCheck, Stethoscope, Building2, CalendarClock, HeartPulse } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';

/**
 * The care pathway, animated (landing page hero).
 *
 * Replaces a 3D map of Uttar Pradesh's districts. That map was accurate once
 * and stopped being so the day Maharashtra was seeded, and it pulled a 3D
 * engine into the page a sub-centre on a 2G link has to download first. What
 * the platform actually does is move a patient through six hands without
 * losing their record — so that is what this shows, with patients travelling
 * the loop.
 *
 * SVG and CSS only. Honours prefers-reduced-motion: the pathway is still
 * there, it just does not move.
 */

const STATIONS = [
  { key: 'village', Icon: Home, labelKey: 'pathway.village', label: 'Village sub-centre', noteKey: 'pathway.village.note', note: 'The patient arrives' },
  { key: 'intake', Icon: Mic, labelKey: 'pathway.intake', label: 'Health assistant', noteKey: 'pathway.intake.note', note: 'Voice or typed intake, in their language' },
  { key: 'ai', Icon: ShieldCheck, labelKey: 'pathway.ai', label: 'AI preparation', noteKey: 'pathway.ai.note', note: 'Checked against approved protocols' },
  { key: 'doctor', Icon: Stethoscope, labelKey: 'pathway.doctor', label: 'Doctor', noteKey: 'pathway.doctor.note', note: 'Decides — by video if needed' },
  { key: 'hospital', Icon: Building2, labelKey: 'pathway.hospital', label: 'Hospital', noteKey: 'pathway.hospital.note', note: 'Referral tracked to arrival' },
  { key: 'followup', Icon: CalendarClock, labelKey: 'pathway.followup', label: 'Follow-up', noteKey: 'pathway.followup.note', note: 'Back home, and followed up' }
];

const RADIUS = 38;          // % of the box, for the station ring
const TRACK_R = 150;        // SVG units, same ring in a 400×400 viewBox
const CYCLE_MS = 1800;

const position = (i) => {
  const angle = (i / STATIONS.length) * 2 * Math.PI - Math.PI / 2;
  return { left: 50 + RADIUS * Math.cos(angle), top: 50 + RADIUS * Math.sin(angle) };
};

const usePrefersReducedMotion = () => {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return undefined;
    setReduced(query.matches);
    const onChange = (e) => setReduced(e.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
};

export default function CarePathway({ className = '' }) {
  const { t } = useI18n();
  const reduced = usePrefersReducedMotion();
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (reduced) return undefined;
    const timer = setInterval(() => setActive((i) => (i + 1) % STATIONS.length), CYCLE_MS);
    return () => clearInterval(timer);
  }, [reduced]);

  const current = STATIONS[active];
  const ring = `M 200 ${200 - TRACK_R} a ${TRACK_R} ${TRACK_R} 0 1 1 -0.01 0`;

  return (
    <div
      // The caller positions it (the landing page passes `absolute inset-0`).
      // Forcing `relative` here as well used to win over that and leave the
      // box with no height, stacking every station at the top.
      className={`${className || 'relative w-full h-full'} select-none`}
      role="img"
      aria-label={t('pathway.aria', 'The care pathway: village sub-centre, health assistant, AI preparation, doctor, hospital, and follow-up, with one record following the patient throughout.')}
    >
      <style>{`
        @keyframes cp-ecg { from { stroke-dashoffset: 420; } to { stroke-dashoffset: 0; } }
        @keyframes cp-beat { 0%, 100% { transform: scale(1); } 15% { transform: scale(1.12); } 30% { transform: scale(0.98); } }
        @keyframes cp-halo { 0% { transform: scale(0.8); opacity: 0.55; } 100% { transform: scale(1.9); opacity: 0; } }
        .cp-ecg { stroke-dasharray: 420; animation: cp-ecg 2.4s linear infinite; }
        .cp-beat { animation: cp-beat 1.2s ease-in-out infinite; transform-origin: center; }
        .cp-halo { animation: cp-halo 2.4s ease-out infinite; transform-origin: center; }
        @media (prefers-reduced-motion: reduce) { .cp-ecg, .cp-beat, .cp-halo { animation: none; } }
      `}</style>

      {/* A square stage centred in whatever box it is given: station positions are
          percentages, and they only sit on the ring if the stage is square. */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[calc(100%-1.5rem)] max-w-full aspect-square">
      <svg viewBox="0 0 400 400" className="absolute inset-0 w-full h-full" aria-hidden="true">
        <defs>
          <radialGradient id="cp-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
        </defs>

        <g className="text-gov-500">
          <circle cx="200" cy="200" r="190" fill="url(#cp-glow)" />
          {/* The loop every patient travels. */}
          <path d={ring} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" strokeDasharray="4 8" />
          <circle cx="200" cy="200" r={TRACK_R - 42} fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" />

          {/* Patients moving through it, staggered — a network, not one case. */}
          {!reduced && [0, 1, 2, 3, 4].map((i) => (
            <circle key={i} r={i === 0 ? 6 : 4} fill="currentColor" fillOpacity={i === 0 ? 0.95 : 0.55}>
              <animateMotion dur="10.8s" repeatCount="indefinite" begin={`${-i * 2.16}s`} path={ring} rotate="auto" />
            </circle>
          ))}
        </g>

        {/* The record at the centre: a heartbeat, because it is a live one. */}
        <g className="text-tier-emergency">
          <circle cx="200" cy="200" r="46" fill="currentColor" fillOpacity="0.06" className="cp-halo" />
          <polyline
            className="cp-ecg"
            points="120,210 150,210 162,188 176,236 190,170 204,222 214,210 280,210"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </svg>

      {/* The centre label sits over the ECG. */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="text-center mt-24">
          <HeartPulse className="w-6 h-6 mx-auto text-tier-emergency cp-beat" aria-hidden="true" />
          <p className="mt-1 text-[11px] font-bold uppercase tracking-wider text-ink-muted">
            {t('pathway.centre', 'One record, start to finish')}
          </p>
        </div>
      </div>

      {STATIONS.map((station, i) => {
        const { left, top } = position(i);
        const isActive = i === active && !reduced;
        const { Icon } = station;
        return (
          <div
            key={station.key}
            className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
            style={{ left: `${left}%`, top: `${top}%` }}
          >
            <div
              className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center border-2 shadow-sm transition-all duration-500 ${
                isActive
                  ? 'bg-gov-600 border-gov-600 text-white scale-110 shadow-lg'
                  : 'bg-surface-raised border-gov-200 text-gov-600'
              }`}
            >
              <Icon className="w-5 h-5" aria-hidden="true" />
            </div>
            <span className={`mt-1.5 text-[10px] sm:text-[11px] font-semibold whitespace-nowrap transition-colors ${
              isActive ? 'text-gov-700 dark:text-gov-500' : 'text-ink-muted'
            }`}>
              {t(station.labelKey, station.label)}
            </span>
          </div>
        );
      })}

      </div>

      {/* What is happening at the station the pulse has reached — in the corner,
          where it covers no station. */}
      <div className="absolute left-3 top-3 max-w-[55%]">
        <p className="text-[11px] text-ink bg-surface-raised/95 border border-line rounded-card px-3 py-1.5 shadow-sm leading-snug" aria-live="off">
          <span className="font-bold text-gov-700 dark:text-gov-500">{t(current.labelKey, current.label)}:</span>{' '}
          {t(current.noteKey, current.note)}
        </p>
      </div>

      <ol className="sr-only">
        {STATIONS.map((s) => <li key={s.key}>{t(s.labelKey, s.label)} — {t(s.noteKey, s.note)}</li>)}
      </ol>
    </div>
  );
}
