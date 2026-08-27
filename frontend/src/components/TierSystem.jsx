import React from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, AlertTriangle, AlertOctagon, Siren } from 'lucide-react';
import { cn } from './ui';

/**
 * The triage tier, as a visual system.
 *
 * One tier, one meaning, one colour — used nowhere else in the product. The
 * four tiers are deliberately NOT four shades of the same idea: they escalate
 * in weight as well as hue, so the difference is legible to someone who is
 * colour-blind, on a sun-washed tablet screen, or in a hurry.
 *
 *   LOW        outline badge, calm green      → complete plan, no call
 *   MODERATE   outline badge, amber           → video consultation
 *   HIGH       filled badge, orange           → urgent doctor review
 *   EMERGENCY  filled + pulsing, red          → danger zone, referral only
 */

export const TIER_KEYS = ['low', 'moderate', 'high', 'emergency'];

const NORMALISE = {
  EMERGENCY: 'emergency', RED: 'emergency',
  HIGH: 'high', ORANGE: 'high',
  MODERATE: 'moderate', MEDIUM: 'moderate', YELLOW: 'moderate',
  LOW: 'low', GREEN: 'low'
};

export const normaliseTier = (level) => NORMALISE[String(level || 'LOW').toUpperCase()] || 'low';

export const TIER_META = {
  low: {
    label: 'Low risk',
    Icon: ShieldCheck,
    badge: 'bg-tier-lowBg text-tier-low border-tier-low/40',
    dot: 'bg-tier-low',
    text: 'text-tier-low',
    accent: 'border-l-4 border-l-tier-low',
    headline: 'Protocol care — complete plan issued',
    blurb: 'The assistant can act on this now. Queued for the doctor’s daily review.'
  },
  moderate: {
    label: 'Moderate risk',
    Icon: AlertTriangle,
    badge: 'bg-tier-moderateBg text-tier-moderate border-tier-moderate/40',
    dot: 'bg-tier-moderate',
    text: 'text-tier-moderate',
    accent: 'border-l-4 border-l-tier-moderate',
    headline: 'Video consultation required',
    blurb: 'A doctor must see this patient before treatment. Book now or find one available.'
  },
  high: {
    label: 'High risk',
    Icon: AlertOctagon,
    badge: 'bg-tier-high text-white border-tier-high',
    dot: 'bg-tier-high',
    text: 'text-tier-high',
    accent: 'border-l-4 border-l-tier-high',
    headline: 'Urgent doctor review',
    blurb: 'Escalated to the top of the doctor’s queue. Do not wait for the daily round.'
  },
  emergency: {
    label: 'Emergency',
    Icon: Siren,
    badge: 'bg-tier-emergency text-white border-tier-emergency',
    dot: 'bg-tier-emergency',
    text: 'text-tier-emergency',
    accent: 'border-l-4 border-l-tier-emergency',
    headline: 'Refer immediately',
    blurb: 'This case leaves the platform. Issue the referral and arrange transport now.'
  }
};

/* ------------------------------------------------------------------ Badge */

export function TierBadge({ level, size = 'md', pulse = false, className }) {
  const key = normaliseTier(level);
  const meta = TIER_META[key];
  const { Icon } = meta;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-bold uppercase tracking-wide whitespace-nowrap',
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs',
        meta.badge,
        // Only the top tier animates. If everything pulses, nothing is urgent.
        pulse && key === 'emergency' && 'animate-pulse-danger',
        className
      )}
    >
      <Icon className={cn(size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5', 'shrink-0')} />
      {meta.label}
    </span>
  );
}

/* --------------------------------------------------------------- Tier card */

export function TierBanner({ level, children, className }) {
  const key = normaliseTier(level);
  const meta = TIER_META[key];
  const { Icon } = meta;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={cn('card overflow-hidden', meta.accent, className)}
    >
      <div className="p-4 sm:p-5 flex items-start gap-3">
        <span
          className={cn(
            'w-10 h-10 rounded-field flex items-center justify-center shrink-0',
            key === 'emergency' || key === 'high' ? meta.badge : `${meta.badge} border`
          )}
        >
          <Icon className="w-5 h-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={cn('text-sm font-bold', meta.text)}>{meta.headline}</h3>
            <TierBadge level={level} size="sm" />
          </div>
          <p className="text-xs text-ink-muted mt-1 leading-relaxed">{meta.blurb}</p>
          {children && <div className="mt-3">{children}</div>}
        </div>
      </div>
    </motion.div>
  );
}

/* -------------------------------------------------------------- Danger zone */

/**
 * Full-shell red state for an EMERGENCY case.
 *
 * Deliberately removes choices. When a case is an emergency the interface
 * should not present six equally-weighted options — it should present the one
 * thing that has to happen next. Navigation is suppressed by the shell while
 * this is mounted; it clears only when the referral is issued.
 */
export function DangerZone({ children, className }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className={cn('relative', className)}
    >
      {/* Red wash behind the content, not over it — text must stay readable. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 bg-tier-emergency/[0.07] dark:bg-tier-emergency/[0.12]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-0 h-1.5 bg-tier-emergency animate-pulse-danger"
      />
      <div className="relative z-10">{children}</div>
    </motion.div>
  );
}

/* ---------------------------------------------------------- Tier legend */

/** Used on the landing page to explain the model to a non-clinical audience. */
export function TierLegend({ className }) {
  return (
    <div className={cn('grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3', className)}>
      {TIER_KEYS.map((key, i) => {
        const meta = TIER_META[key];
        const { Icon } = meta;
        return (
          <motion.div
            key={key}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.4, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] }}
            className={cn('card p-4', meta.accent)}
          >
            <div className="flex items-center gap-2">
              <Icon className={cn('w-4 h-4', meta.text)} />
              <span className={cn('text-xs font-bold uppercase tracking-wide', meta.text)}>{meta.label}</span>
            </div>
            <p className="text-xs font-semibold text-ink mt-2">{meta.headline}</p>
            <p className="text-[11px] text-ink-muted mt-1 leading-relaxed">{meta.blurb}</p>
          </motion.div>
        );
      })}
    </div>
  );
}
