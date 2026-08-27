import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Activity, ShieldCheck, Stethoscope, ArrowRight, AlertTriangle,
  Sun, Moon, Monitor, MapPin, Languages, Lock, Scale, Wifi
} from 'lucide-react';
import DistrictNetwork3D from '../components/DistrictNetwork3D';
import { Counter, TierExplorer, WorkflowTimeline, RoleCard } from '../components/landing/Interactive';
import { useTheme } from '../context/ThemeContext';
import { Button, Card } from '../components/ui';

/**
 * Public landing page.
 *
 * Written for a government or investor audience: the gap, what the system
 * does, who is accountable for each decision, and what it deliberately will
 * not do. The safety position sits near the top rather than in a footer —
 * for a health system the limits of the tool are part of the case, not a
 * disclaimer to be skimmed.
 */

const reveal = {
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-70px' },
  transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] }
};

const STATS = [
  { value: 75, label: 'Districts covered', suffix: '' },
  { value: 1880, label: 'Patient records', suffix: '' },
  { value: 375, label: 'Doctors on the roster', suffix: '' },
  { value: 4, label: 'Triage tiers', suffix: '' }
];

const PROBLEM = [
  { Icon: Stethoscope, text: 'Roughly one allopathic doctor per 10,000 people in rural India. The WHO norm is one per 1,000.' },
  { Icon: MapPin, text: 'Patients travel hours over difficult terrain to a district hospital that may have no bed free when they arrive.' },
  { Icon: Scale, text: 'Paper prescriptions are lost between visits, so history restarts from zero and diagnostics are repeated at the patient’s cost.' },
  { Icon: Languages, text: 'Language and literacy barriers mean the presenting complaint is often recorded wrong at first contact.' }
];

const GUARANTEES = [
  { Icon: Lock, title: 'Escalation is one-way', body: 'The rules engine sets the tier. The language model may raise it and can never lower it. Missing data escalates rather than reassuring.' },
  { Icon: ShieldCheck, title: 'Medication is never model-authored', body: 'Every medicine comes from a formulary signed by a registered practitioner. The model formats what the rules engine selected — it never names a drug.' },
  { Icon: Scale, title: 'A doctor signs every decision', body: 'Prescriptions, referrals and clinical judgements are made by a practitioner registered with the National Medical Commission. Nothing is automatic.' },
  { Icon: Wifi, title: 'Honest when degraded', body: 'If a model is unavailable the case is floored at moderate and sent to a doctor. An unassessed case is never presented as a low-risk one.' }
];

function ThemeSwitch() {
  const { choice, cycle } = useTheme();
  const Icon = choice === 'light' ? Sun : choice === 'dark' ? Moon : Monitor;
  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`Theme: ${choice}. Click to change.`}
      className="p-2 rounded-field text-ink-muted hover:bg-surface-sunken hover:text-ink transition-colors"
    >
      <Icon className="w-5 h-5" />
    </button>
  );
}

export default function LandingPage() {
  const [hoveredDistrict, setHoveredDistrict] = useState(null);

  return (
    <div className="min-h-screen bg-surface-sunken">
      <div className="h-1 tricolour-rule" aria-hidden="true" />

      {/* ---------------- Masthead ---------------- */}
      <header className="sticky top-0 z-40 bg-surface-raised/95 backdrop-blur border-b border-line">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-10 h-10 rounded-field bg-gov-600 dark:bg-gov-500 text-white dark:text-gov-950 flex items-center justify-center shrink-0">
              <Activity className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-ink leading-tight truncate">Rural Health Grid</p>
              <p className="text-[10px] text-ink-subtle uppercase tracking-wider truncate">Village Tele-Clinic Network</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeSwitch />
            <Link to="/login">
              <Button size="sm" className="whitespace-nowrap">
                <ShieldCheck className="w-4 h-4" /> Staff Sign In
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* ---------------- Hero ---------------- */}
      <section className="relative border-b border-line bg-surface-raised overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 lg:py-16 grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10"
          >
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gov-50 dark:bg-gov-100 text-gov-700 dark:text-gov-600 text-[11px] font-bold uppercase tracking-wider">
              <MapPin className="w-3 h-3" />
              {hoveredDistrict ? `${hoveredDistrict} district` : 'Uttar Pradesh · 75 districts'}
            </span>

            <h1 className="mt-4 font-display text-3xl sm:text-4xl lg:text-[3.25rem] font-bold text-ink leading-[1.1]">
              Specialist care,
              <span className="block text-gov-600 dark:text-gov-500">without the journey.</span>
            </h1>

            <p className="mt-4 text-sm sm:text-base text-ink-muted leading-relaxed max-w-xl">
              A trained health assistant at the village sub-centre captures the case.
              AI prepares it against approved Ministry of Health protocols. A registered
              doctor, wherever they are, makes the clinical decision.
            </p>

            <div className="mt-6 p-4 rounded-card bg-gov-50 dark:bg-gov-100 border border-gov-200">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gov-600 dark:text-gov-500">
                Central product principle
              </p>
              <p className="text-sm font-bold text-gov-800 dark:text-gov-700 mt-1">
                AI prepares the case. The doctor makes the medical decision.
              </p>
            </div>

            <div className="mt-6 flex flex-col sm:flex-row gap-3">
              <Link to="/login">
                <Button size="lg" className="w-full sm:w-auto">
                  <ShieldCheck className="w-4 h-4" /> Staff sign in
                </Button>
              </Link>
              <a href="#how-it-works">
                <Button size="lg" variant="secondary" className="w-full sm:w-auto">
                  How it works <ArrowRight className="w-4 h-4" />
                </Button>
              </a>
            </div>
          </motion.div>

          {/* The map is the product's real data, not decoration. */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="relative h-72 sm:h-96 lg:h-[30rem] rounded-card overflow-hidden bg-surface-sunken border border-line"
          >
            <DistrictNetwork3D className="absolute inset-0" onDistrictHover={setHoveredDistrict} />
          </motion.div>
        </div>
      </section>

      {/* ---------------- Stats ---------------- */}
      <section className="bg-gov-600 dark:bg-gov-100 border-b border-line">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 grid grid-cols-2 lg:grid-cols-4 gap-6">
          {STATS.map((s) => (
            <div key={s.label} className="text-center">
              <p className="font-display text-3xl sm:text-4xl font-bold text-white dark:text-gov-800 tabular-nums">
                <Counter to={s.value} suffix={s.suffix} />
              </p>
              <p className="mt-1 text-[11px] uppercase tracking-wider text-gov-100 dark:text-gov-600">
                {s.label}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- Safety notice ---------------- */}
      <section className="bg-tier-moderateBg border-b border-tier-moderate/25">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-tier-moderate shrink-0 mt-0.5" />
          <p className="text-xs text-tier-moderate leading-relaxed">
            <strong>Not for clinical use in its current state.</strong> This is a demonstration
            system. Its triage thresholds and medication list are drawn from published guidance
            but have not been reviewed or approved by a registered medical practitioner for this
            deployment. It does not provide medical advice, diagnosis or treatment. Every clinical
            decision must be made by a doctor registered with the National Medical Commission.
          </p>
        </div>
      </section>

      {/* ---------------- Problem ---------------- */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-12 lg:py-16">
        <motion.div {...reveal}>
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-ink">The gap this closes</h2>
          <p className="mt-2 text-sm text-ink-muted max-w-2xl leading-relaxed">
            None of these are technology problems on their own. Together they mean a treatable
            condition becomes an emergency between the village and the district hospital.
          </p>
        </motion.div>

        <div className="mt-6 grid sm:grid-cols-2 gap-4">
          {PROBLEM.map((p, i) => (
            <motion.div
              key={p.text}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.45, delay: i * 0.07 }}
            >
              <Card className="p-5 h-full flex gap-3">
                <span className="w-9 h-9 rounded-field bg-tier-emergencyBg text-tier-emergency flex items-center justify-center shrink-0">
                  <p.Icon className="w-4 h-4" />
                </span>
                <p className="text-sm text-ink-muted leading-relaxed">{p.text}</p>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ---------------- Tier explorer ---------------- */}
      <section className="bg-surface-raised border-y border-line">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 lg:py-16">
          <motion.div {...reveal}>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-ink">
              Every case gets a tier
            </h2>
            <p className="mt-2 text-sm text-ink-muted max-w-2xl leading-relaxed">
              The tier decides what happens next — and each one has a different, defined
              output. Select a tier to see exactly what the assistant and the doctor get.
            </p>
          </motion.div>

          <div className="mt-8">
            <TierExplorer />
          </div>
        </div>
      </section>

      {/* ---------------- Workflow ---------------- */}
      <section id="how-it-works" className="max-w-7xl mx-auto px-4 sm:px-6 py-12 lg:py-16 scroll-mt-20">
        <motion.div {...reveal}>
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-ink">
            End-to-end clinical journey
          </h2>
          <p className="mt-2 text-sm text-ink-muted max-w-2xl leading-relaxed">
            Six steps from a patient arriving at a sub-centre to a signed clinical decision.
          </p>
        </motion.div>

        <div className="mt-8">
          <WorkflowTimeline />
        </div>
      </section>

      {/* ---------------- Safety guarantees ---------------- */}
      <section className="bg-surface-raised border-y border-line">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 lg:py-16">
          <motion.div {...reveal}>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-ink">
              What the system will not do
            </h2>
            <p className="mt-2 text-sm text-ink-muted max-w-2xl leading-relaxed">
              These are enforced in code and covered by tests, not stated as intentions.
            </p>
          </motion.div>

          <div className="mt-6 grid sm:grid-cols-2 gap-4">
            {GUARANTEES.map((g, i) => (
              <motion.div
                key={g.title}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.45, delay: i * 0.07 }}
              >
                <Card className="p-5 h-full">
                  <div className="flex items-center gap-2.5">
                    <span className="w-8 h-8 rounded-field bg-tier-lowBg text-tier-low flex items-center justify-center shrink-0">
                      <g.Icon className="w-4 h-4" />
                    </span>
                    <h3 className="text-sm font-bold text-ink">{g.title}</h3>
                  </div>
                  <p className="mt-2 text-xs text-ink-muted leading-relaxed">{g.body}</p>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- Role entry ---------------- */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-12 lg:py-16">
        <motion.div {...reveal}>
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-ink">Staff access</h2>
          <p className="mt-2 text-sm text-ink-muted max-w-2xl leading-relaxed">
            Both roles use the same sign-in. Your dashboard is determined by the role your
            administrator assigned — roles are government-assigned, not self-selected, so
            there is no public sign-up.
          </p>
        </motion.div>

        <div className="mt-6 grid sm:grid-cols-2 gap-4">
          <RoleCard
            Icon={ShieldCheck}
            tone="gov"
            title="Clinic Assistant"
            description="At the village sub-centre, with the patient in front of you."
            bullets={[
              'Register by Aadhaar and open a visit',
              'Voice symptom capture in the local dialect',
              'Prescription, report and wound-photo capture',
              'Run the AI assessment and act on the tier'
            ]}
            to="/login"
            cta="Sign in as assistant"
          />
          <RoleCard
            Icon={Stethoscope}
            tone="low"
            title="Doctor"
            description="Anywhere with a connection, reviewing prepared cases."
            bullets={[
              'Day-wise queue, worst risk first',
              'Full case file with AI assistance clearly separated',
              'Video consultation with the assistant and patient',
              'Sign the diagnosis, prescription or referral'
            ]}
            to="/login"
            cta="Sign in as doctor"
          />
        </div>
      </section>

      <footer className="bg-surface-raised border-t border-line">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-ink-subtle">
          <p>Rural Health Grid · Grounded in MoHFW Standard Treatment &amp; Telemedicine Practice Guidelines</p>
          <p className="font-mono">Demonstration system — not for clinical use</p>
        </div>
      </footer>
    </div>
  );
}
