import { AlertTriangle } from 'lucide-react';
import { useT } from '../i18n/index.jsx';

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
 * The single source of the wording. Two copies of a safety disclaimer drift —
 * and they had: the landing page carried its own variant ending "a qualified
 * doctor" while this one ended "a doctor registered with the National Medical
 * Commission". Both are now this string, the more precise of the two, and both
 * read it from the same catalogue key, so the next divergence fails the
 * extractor rather than shipping.
 *
 * ── On translating a legal notice ───────────────────────────────────────────
 *
 * The body is one key rather than a sentence assembled from fragments. A
 * disclaimer stitched together from clauses reorders wrongly in a
 * verb-final language and can end up asserting the opposite of what it means;
 * given as a whole paragraph, a translator sees the claim they are making.
 * The lead-in is separate only because it renders bold.
 *
 * @param {'strip'|'card'} variant  strip = full-width page banner,
 *                                  card  = block inside a panel
 */
export default function ClinicalUseNotice({ variant = 'card', className = '' }) {
  const t = useT();
  const isStrip = variant === 'strip';

  return (
    <div
      role="note"
      aria-label={t('clinical.noticeLabel', 'Clinical use notice')}
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
          <strong className="font-bold uppercase tracking-wide">
            {t('clinical.noticeLead', 'Not for clinical use.')}
          </strong>{' '}
          {t(
            'clinical.noticeBody',
            'This is a demonstration system. Its triage thresholds and medication list are drawn from published guidance but have not been reviewed or approved by a registered medical practitioner for this deployment. It does not provide medical advice, diagnosis, or treatment. Every clinical decision must be made by a doctor registered with the National Medical Commission.'
          )}
        </p>
      </div>
    </div>
  );
}
