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
 */
export default function DemoBadge({ patient, className = '' }) {
  if (!patient?.is_demo) return null;

  return (
    <span
      title="Demonstration record — not a real patient"
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide border border-tier-moderate/40 bg-tier-moderateBg text-tier-moderate align-middle ${className}`}
    >
      Demo
    </span>
  );
}
