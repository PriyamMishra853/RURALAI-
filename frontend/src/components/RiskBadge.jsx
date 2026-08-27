import { TierBadge } from './TierSystem';

/**
 * Back-compat shim.
 *
 * The tier badge now lives in TierSystem.jsx alongside the rest of the triage
 * visual language, so tier styling is defined once. This re-export keeps the
 * existing `<RiskBadge level={...} />` call sites working.
 */
export default function RiskBadge({ level, size = 'normal' }) {
  return <TierBadge level={level} size={size === 'small' ? 'sm' : 'md'} />;
}
