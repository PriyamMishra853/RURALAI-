import { AlertTriangle } from 'lucide-react';

/**
 * "Not for clinical use" notice.
 *
 * Required by docs/PHASE1_PRODUCTION_READINESS_PLAN.md §D.6 and §J.5 #22: the
 * triage thresholds and the OTC formulary are drawn from published sources but
 * have not been reviewed by a registered medical practitioner for this
 * deployment, so the system must say so wherever it is shown.
 *
 * Shown once, on the public landing and sign-in screens — not repeated on
 * authenticated pages, where a permanent banner would be tuned out within a day
 * and would compete with the tier colours that do carry clinical meaning.
 *
 * The single source of the wording. Two copies of a safety disclaimer drift.
 *
 * @param {'strip'|'card'} variant  strip = full-width page banner,
 *                                  card  = block inside a panel
 */
export default function ClinicalUseNotice({ variant = 'card', className = '' }) {
  const isStrip = variant === 'strip';

  return (
    <div
      role="note"
      aria-label="Clinical use notice"
      className={
        (isStrip
          ? 'w-full border-b border-tier-moderate/40 bg-tier-moderateBg px-4 lg:px-8 py-3'
          : 'rounded-field border border-tier-moderate/40 bg-tier-moderateBg p-3') + ' ' + className
      }
    >
      <div
        className={
          (isStrip ? 'max-w-7xl mx-auto ' : '') + 'flex items-start gap-2.5 text-tier-moderate'
        }
      >
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-tier-moderate" aria-hidden="true" />
        <p className="text-xs leading-relaxed">
          <strong className="font-bold uppercase tracking-wide">Not for clinical use.</strong>{' '}
          This is a demonstration system. Its triage thresholds and medication list are drawn from
          published guidance but have <strong className="font-semibold">not been reviewed or
          approved by a registered medical practitioner</strong> for this deployment. It does not
          provide medical advice, diagnosis, or treatment. Every clinical decision must be made by a
          qualified doctor.
        </p>
      </div>
    </div>
  );
}
