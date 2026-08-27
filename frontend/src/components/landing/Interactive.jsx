import React, { useState, useEffect, useRef } from 'react';
import { motion, useInView, useMotionValue, useSpring, useReducedMotion, AnimatePresence } from 'framer-motion';
import {
  ShieldCheck, AlertTriangle, AlertOctagon, Siren, Check, ArrowRight,
  Mic, FileText, Camera, Bot, Video, ClipboardCheck
} from 'lucide-react';
import { cn, Card } from '../ui';

/* ------------------------------------------------------------------ Counter */

/**
 * A number that counts up when it scrolls into view.
 *
 * Spring-driven rather than linear so it decelerates into the final value —
 * a linear count reads like a loading bar, which is the wrong signal for a
 * statistic that is already true.
 */
export function Counter({ to, suffix = '', duration = 1.4, className }) {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  const inView = useInView(ref, { once: true, margin: '-60px' });
  const motionValue = useMotionValue(0);
  const spring = useSpring(motionValue, { duration: duration * 1000, bounce: 0 });
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (reduced) { setDisplay(to); return undefined; }

    if (inView) motionValue.set(to);

    /*
     * Two independent fail-safes, because a statistic frozen at 0 is not a
     * missing animation — it is wrong information on the page.
     *
     *   settle  covers the animation starting but never finishing (throttled
     *           frame loop, backgrounded tab).
     *   rescue  covers IntersectionObserver never firing at all, which happens
     *           in embedded viewers and some automation contexts. Without it
     *           the number would sit at zero forever.
     */
    const settle = inView ? setTimeout(() => setDisplay(to), duration * 1000 + 400) : null;
    const rescue = setTimeout(() => setDisplay((d) => (d === 0 ? to : d)), 2500);

    return () => { if (settle) clearTimeout(settle); clearTimeout(rescue); };
  }, [inView, to, reduced, duration, motionValue]);

  return (
    <span ref={ref} className={className}>
      {display.toLocaleString('en-IN')}{suffix}
    </span>
  );
}

/* ------------------------------------------------------- Tier explorer */

const TIERS = [
  {
    key: 'low',
    label: 'Low',
    Icon: ShieldCheck,
    accent: 'text-tier-low',
    ring: 'ring-tier-low/40',
    chip: 'bg-tier-lowBg text-tier-low border-tier-low/30',
    bar: 'bg-tier-low',
    headline: 'Complete plan, issued on the spot',
    outputs: [
      'First aid the assistant performs now',
      'Medication — from a formulary signed by a registered practitioner',
      'Precautions, point by point',
      'Diet guidance where it is relevant',
      'Queued for the doctor’s daily review'
    ],
    note: 'The assistant can act immediately. A doctor still sees every case, batched rather than as an interruption.'
  },
  {
    key: 'moderate',
    label: 'Moderate',
    Icon: AlertTriangle,
    accent: 'text-tier-moderate',
    ring: 'ring-tier-moderate/40',
    chip: 'bg-tier-moderateBg text-tier-moderate border-tier-moderate/30',
    bar: 'bg-tier-moderate',
    headline: 'A doctor sees the patient before treatment',
    outputs: [
      'First aid the assistant performs now',
      'Video consultation, booked or instant',
      'Doctor chosen by speciality and current load',
      'Precautions, point by point',
      'The doctor’s review returns to the assistant’s screen'
    ],
    note: 'No medication is issued at this tier without the consultation. The call is the gate.'
  },
  {
    key: 'high',
    label: 'High',
    Icon: AlertOctagon,
    accent: 'text-tier-high',
    ring: 'ring-tier-high/40',
    chip: 'bg-tier-highBg text-tier-high border-tier-high/30',
    bar: 'bg-tier-high',
    headline: 'Straight to the top of the queue',
    outputs: [
      'First aid the assistant performs now',
      'Escalated above every routine case',
      'Doctor notified in real time, not on the next round',
      'Precautions, point by point',
      'Consultation or referral, decided by the doctor'
    ],
    note: 'Escalation is one-way. The rules engine may raise a tier; the language model can never lower one.'
  },
  {
    key: 'emergency',
    label: 'Emergency',
    Icon: Siren,
    accent: 'text-tier-emergency',
    ring: 'ring-tier-emergency/40',
    chip: 'bg-tier-emergency text-white border-tier-emergency',
    bar: 'bg-tier-emergency',
    headline: 'The case leaves the platform',
    outputs: [
      'First aid the assistant performs now',
      'Danger-zone screen — every other option removed',
      'Nearest district hospital by real coordinates',
      'Printable referral, issued instantly',
      'Nothing queued to a doctor — arrange transport'
    ],
    note: 'Bed availability is never invented. The screen shows the hospital’s number and says to confirm by phone before transporting.'
  }
];

/**
 * Click-through explorer for the triage model.
 *
 * Built as a real control rather than four static cards because the tiers are
 * the product's central idea, and the difference between them is *what happens
 * next* — which is a thing you show by switching, not by listing.
 */
export function TierExplorer() {
  const [active, setActive] = useState('low');
  const tier = TIERS.find((t) => t.key === active);

  return (
    <div className="grid lg:grid-cols-12 gap-5">
      {/* Selector */}
      <div className="lg:col-span-4 flex lg:flex-col gap-2 overflow-x-auto pb-1 lg:pb-0">
        {TIERS.map((t) => {
          const on = t.key === active;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              aria-pressed={on}
              className={cn(
                'flex-1 lg:flex-none text-left p-3.5 rounded-card border transition-all min-w-[9rem]',
                on
                  ? `bg-surface-raised border-transparent ring-2 ${t.ring} shadow-raised`
                  : 'bg-surface-raised/60 border-line hover:border-line-strong'
              )}
            >
              <div className="flex items-center gap-2">
                <t.Icon className={cn('w-4 h-4 shrink-0', t.accent)} />
                <span className={cn('text-sm font-bold', on ? t.accent : 'text-ink')}>{t.label}</span>
              </div>
              <div className="mt-2 h-1 rounded-full bg-line overflow-hidden">
                <motion.div
                  className={cn('h-full rounded-full', t.bar)}
                  initial={false}
                  animate={{ width: on ? '100%' : '18%' }}
                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
            </button>
          );
        })}
      </div>

      {/* Detail */}
      <div className="lg:col-span-8 relative">
        {/* No mode="wait": the incoming card mounts immediately and
            cross-fades. With "wait" a throttled frame loop leaves the
            panel blank, and content must never depend on an animation
            finishing. */}
        <AnimatePresence initial={false}>
          <motion.div
            key={tier.key}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, position: 'absolute', inset: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            <Card className="p-5 sm:p-6 h-full">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wide', tier.chip)}>
                  <tier.Icon className="w-3.5 h-3.5" /> {tier.label} risk
                </span>
              </div>

              <h3 className={cn('mt-3 font-display text-xl font-bold', tier.accent)}>
                {tier.headline}
              </h3>

              <ul className="mt-4 space-y-2.5">
                {tier.outputs.map((o, i) => (
                  <motion.li
                    key={o}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: 0.06 + i * 0.05 }}
                    className="flex items-start gap-2.5 text-sm text-ink-muted"
                  >
                    <span className={cn('w-4 h-4 rounded-full flex items-center justify-center shrink-0 mt-0.5', tier.chip)}>
                      <Check className="w-2.5 h-2.5" />
                    </span>
                    <span className="leading-relaxed">{o}</span>
                  </motion.li>
                ))}
              </ul>

              <p className="mt-4 pt-4 border-t border-line text-xs text-ink-subtle leading-relaxed">
                {tier.note}
              </p>
            </Card>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ----------------------------------------------------- Workflow timeline */

const STEPS = [
  { n: '01', title: 'Register', Icon: FileText, body: 'Aadhaar, name, gender, date of birth, address, phone. Age is derived — never typed, so it cannot go stale.' },
  { n: '02', title: 'Capture', Icon: Mic, body: 'Symptoms spoken in the local dialect or typed, vitals pre-filled to typical adult values, onset and history.' },
  { n: '03', title: 'Digitise', Icon: Camera, body: 'Prescriptions, multi-page lab reports and wound photographs — camera or file, with mandatory human verification.' },
  { n: '04', title: 'Assess', Icon: Bot, body: 'Rules engine triages against approved MoHFW protocols. The model may raise the tier and can never lower it.' },
  { n: '05', title: 'Consult', Icon: Video, body: 'Video consultation, load-balanced across the district roster by speciality and current load.' },
  { n: '06', title: 'Decide', Icon: ClipboardCheck, body: 'A registered practitioner signs every prescription, referral and clinical decision. Nothing is automatic.' }
];

/** Scroll-driven timeline. The line fills as the reader moves through it. */
export function WorkflowTimeline() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });

  return (
    <div ref={ref} className="relative">
      {/* Spine — hidden on mobile where the cards stack instead. */}
      <div className="hidden md:block absolute left-[1.4rem] top-4 bottom-4 w-px bg-line" aria-hidden="true">
        <motion.div
          className="w-full bg-gov-500 origin-top"
          initial={{ scaleY: 0 }}
          animate={inView ? { scaleY: 1 } : {}}
          transition={{ duration: 1.6, ease: 'easeOut' }}
          style={{ height: '100%' }}
        />
      </div>

      <ol className="space-y-4">
        {STEPS.map((s, i) => (
          <motion.li
            key={s.n}
            initial={{ opacity: 0, x: -12 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.45, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] }}
            className="relative md:pl-14"
          >
            <span className="hidden md:flex absolute left-0 top-3 w-11 h-11 rounded-full bg-surface-raised border-2 border-gov-500 items-center justify-center">
              <s.Icon className="w-4 h-4 text-gov-600 dark:text-gov-500" />
            </span>

            <Card className="p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <span className="md:hidden w-9 h-9 rounded-field bg-gov-50 dark:bg-gov-100 text-gov-600 dark:text-gov-500 flex items-center justify-center shrink-0">
                  <s.Icon className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-xs text-ink-subtle">{s.n}</span>
                    <h3 className="text-sm font-bold text-ink">{s.title}</h3>
                  </div>
                  <p className="mt-1 text-xs text-ink-muted leading-relaxed">{s.body}</p>
                </div>
              </div>
            </Card>
          </motion.li>
        ))}
      </ol>
    </div>
  );
}

/* --------------------------------------------------------- Role entry card */

export function RoleCard({ Icon, title, description, bullets, to, cta, tone = 'gov' }) {
  const [hover, setHover] = useState(false);
  return (
    <motion.a
      href={to}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'block card p-5 sm:p-6 transition-shadow',
        hover ? 'shadow-raised border-gov-300' : ''
      )}
    >
      <span className={cn(
        'w-11 h-11 rounded-field flex items-center justify-center',
        tone === 'gov'
          ? 'bg-gov-50 dark:bg-gov-100 text-gov-600 dark:text-gov-500'
          : 'bg-tier-lowBg text-tier-low'
      )}>
        <Icon className="w-5 h-5" />
      </span>

      <h3 className="mt-3 text-base font-bold text-ink">{title}</h3>
      <p className="mt-1 text-xs text-ink-muted leading-relaxed">{description}</p>

      <ul className="mt-3 space-y-1.5">
        {bullets.map((b) => (
          <li key={b} className="flex items-start gap-2 text-xs text-ink-muted">
            <Check className="w-3.5 h-3.5 text-tier-low shrink-0 mt-0.5" />
            <span>{b}</span>
          </li>
        ))}
      </ul>

      <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-gov-600 dark:text-gov-500">
        {cta}
        <motion.span animate={{ x: hover ? 3 : 0 }} transition={{ duration: 0.2 }}>
          <ArrowRight className="w-4 h-4" />
        </motion.span>
      </span>
    </motion.a>
  );
}
