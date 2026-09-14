import { useT } from '../i18n/index.jsx';

/**
 * Marks a record as demonstration data.
 *
 * Demo patients are kept rather than deleted — clinical records are
 * append-only — so the only thing preventing them being mistaken for real
 * patients is this badge. It renders wherever a patient can appear.
 *
 * Driven by the `patients.is_demo` column, never by matching a name prefix:
 * a renamed record would silently become "real", and a genuine patient whose
 * name happened to contain the prefix would be mislabelled.
 *
 * The word is translated. A badge whose whole purpose is to stop somebody
 * treating a fake record as a real one has to be readable by the person
 * looking at it, which is the same argument as the rest of this interface.
 */
export default function DemoBadge({ patient, className = '' }) {
  const t = useT();
  if (!patient?.is_demo) return null;

  return (
    <span
      title={t('demo.tooltip', 'Demonstration record — not a real patient')}
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide border border-tier-moderate/40 bg-tier-moderateBg text-tier-moderate align-middle ${className}`}
    >
      {t('demo.badge', 'Demo')}
    </span>
  );
}
