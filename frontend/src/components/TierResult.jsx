import React from 'react';
import { motion } from 'framer-motion';
import {
  Siren, Video, ShieldCheck, Pill, ListChecks, Apple, MapPin, Phone,
  FileDown, Stethoscope, AlertTriangle, User
} from 'lucide-react';
import { Card, Button, Alert, cn } from './ui';
import { TierBadge, DangerZone } from './TierSystem';
import SpeakButton, { assessmentToSpeech } from './SpeakButton';
// Was used by PdfButtons below without ever being imported, so every hardcopy
// button on this screen threw a ReferenceError instead of downloading.
import { downloadVisitReport } from '../services/reportDownload';
import { useI18n } from '../i18n/index.jsx';
import { serverText } from '../i18n/serverLabels.js';

/**
 * The tiered assessment result — spec §3.6.
 *
 * One component, three genuinely different screens. The differences are not
 * styling: LOW hands the assistant a complete plan, MEDIUM withholds treatment
 * until a doctor has seen the patient, and HIGH removes the other options
 * entirely and points at a hospital.
 */


function Section({ icon: Icon, title, children, tone = 'default', className }) {
  return (
    <div className={cn('py-3 border-t border-line first:border-t-0 first:pt-0', className)}>
      <h4 className={cn(
        'text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 mb-2',
        tone === 'danger' ? 'text-tier-emergency' : 'text-ink-muted'
      )}>
        <Icon className="w-3.5 h-3.5" /> {title}
      </h4>
      {children}
    </div>
  );
}

function NumberedList({ items }) {
  return (
    <ol className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5 text-xs text-ink leading-relaxed">
          <span className="w-5 h-5 rounded-full bg-gov-50 dark:bg-gov-100 text-gov-700 dark:text-gov-600 text-[10px] font-bold flex items-center justify-center shrink-0 mt-px">
            {i + 1}
          </span>
          <span>{String(item).replace(/^Step \d+:\s*/i, '')}</span>
        </li>
      ))}
    </ol>
  );
}

function PdfButtons({ visitId, tier }) {
  const { t } = useI18n();

  const open = async (type) => {
    // The report is generated server-side and comes back in the language the
    // request was made in; see reportPdfService on the API.
    const { ok, error } = await downloadVisitReport(visitId, type, { t });
    if (!ok) alert(error || t('report.downloadFailed', 'The report could not be downloaded.'));
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" onClick={() => open('summary')}>
        <FileDown className="w-3.5 h-3.5" /> {t('report.summary', 'Clinical summary')}
      </Button>
      {tier === 'LOW' && (
        <Button size="sm" variant="secondary" onClick={() => open('prescription')}>
          <FileDown className="w-3.5 h-3.5" /> {t('report.prescription', 'Medication advice')}
        </Button>
      )}
      {tier === 'HIGH' && (
        <Button size="sm" variant="danger" onClick={() => open('referral')}>
          <FileDown className="w-3.5 h-3.5" /> {t('report.referral', 'Referral & bill')}
        </Button>
      )}
    </div>
  );
}

export default function TierResult({ workflow, assessment, visitId, onScheduleConsultation }) {
  // `language` used to be threaded in here to tell SpeakButton what to read.
  // It now reads the selected interface language from context, so the prop was
  // a second, staler source of the same answer.
  const { t, formatNumber } = useI18n();
  if (!workflow) return null;

  const { tier } = workflow;
  const speech = assessmentToSpeech(workflow, assessment);

  const body = (
    <div className="space-y-4">
      {/* ---- Header ---- */}
      <Card className={cn(
        'p-4 sm:p-5',
        tier === 'HIGH' && 'border-l-4 border-l-tier-emergency',
        tier === 'MEDIUM' && 'border-l-4 border-l-tier-moderate',
        tier === 'LOW' && 'border-l-4 border-l-tier-low'
      )}>
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <TierBadge level={tier} pulse={tier === 'HIGH'} />
              {assessment?.generated_by && (
                <span className="text-[10px] text-ink-subtle font-mono">{assessment.generated_by}</span>
              )}
            </div>
            <h3 className={cn(
              'mt-2 font-display text-lg font-bold',
              tier === 'HIGH' ? 'text-tier-emergency' : tier === 'MEDIUM' ? 'text-tier-moderate' : 'text-tier-low'
            )}>
              {serverText(t, workflow, 'headline')}
            </h3>
          </div>

          <div className="flex flex-col items-start sm:items-end gap-2 shrink-0">
            <SpeakButton text={speech} size="sm" />
          </div>
        </div>

        {assessment?.patient_summary && (
          <p className="mt-3 text-xs text-ink-muted leading-relaxed">{assessment.patient_summary}</p>
        )}
      </Card>

      {/* ---- HIGH: referral first. Everything else is secondary. ---- */}
      {tier === 'HIGH' && workflow.referral && (
        <Card className="border-2 border-tier-emergency">
          <div className="bg-tier-emergency px-4 py-2.5">
            <p className="text-white font-bold text-sm flex items-center gap-2">
              <Siren className="w-4 h-4" /> {t('referral.now', 'Refer to district hospital now')}
            </p>
          </div>
          <div className="p-4 sm:p-5 space-y-3">
            {workflow.referral.primary && (
              <div>
                <p className="text-base font-bold text-ink">{workflow.referral.primary.name}</p>
                <p className="text-xs text-ink-muted flex items-center gap-1.5 mt-0.5">
                  <MapPin className="w-3.5 h-3.5" />
                  {workflow.referral.primary.district}
                  {workflow.referral.primary.road_distance_km != null
                    ? ' · ' + t('referral.kmByRoad', '{km} km by road', { km: formatNumber(workflow.referral.primary.road_distance_km) })
                    : workflow.referral.primary.straight_line_km != null
                      ? ' · ' + t('referral.km', '{km} km', { km: formatNumber(workflow.referral.primary.straight_line_km) })
                      : ''}
                  {workflow.referral.primary.driving_time_text ? ` · ${workflow.referral.primary.driving_time_text}` : ''}
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {(workflow.referral.emergency_lines || []).map((l) => (
                <a
                  key={l.number}
                  href={`tel:${l.number}`}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-field bg-tier-emergencyBg border border-tier-emergency/30 text-tier-emergency text-xs font-bold"
                >
                  <Phone className="w-3.5 h-3.5" /> {l.number}
                  <span className="font-normal text-[10px] opacity-80">{serverText(t, l, 'label')}</span>
                </a>
              ))}
            </div>

            {/* Never invented. There is no live bed feed for UP district
                hospitals, and a fabricated number here would be the most
                dangerous thing on the screen. */}
            <Alert tone="warning" icon={AlertTriangle} title={t('referral.bedsUnconfirmed', 'Bed availability not confirmed')}>
              {serverText(t, workflow.referral, 'capacity_instruction')}
            </Alert>
          </div>
        </Card>
      )}

      {/* ---- MEDIUM: the consultation is the gate. ---- */}
      {tier === 'MEDIUM' && workflow.consultation && (
        <Card className="border-l-4 border-l-tier-moderate">
          <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4">
            <span className="w-11 h-11 rounded-field bg-tier-moderateBg text-tier-moderate flex items-center justify-center shrink-0">
              <Video className="w-5 h-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-ink">
                {t('tier.moderate.headline', 'Video consultation required')}
              </p>
              <p className="text-xs text-ink-muted mt-0.5">
                {t('consult.routedTo', 'Routed to')}{' '}
                <strong className="text-ink">{workflow.consultation.speciality}</strong> ·{' '}
                {/* The candidate names are clinical data and stay as sent;
                    only the phrase introducing them is translated. */}
                {workflow.consultation.routing_candidates?.length
                  ? t('workflow.routing.candidates', 'disease candidates: {list}', {
                    list: workflow.consultation.routing_candidates.join(', ')
                  })
                  : serverText(t, workflow.consultation, 'routing_basis')}
              </p>
              <p className="text-[11px] text-ink-subtle mt-1">{serverText(t, workflow.consultation, 'note')}</p>
            </div>
            <Button onClick={onScheduleConsultation} className="shrink-0">
              <Stethoscope className="w-4 h-4" /> {t('consult.findDoctor', 'Find a doctor')}
            </Button>
          </div>
        </Card>
      )}

      {/* ---- Common blocks, in the spec's order ---- */}
      <Card className="p-4 sm:p-5">
        {workflow.first_aid?.length > 0 && (
          <Section icon={ShieldCheck} title={t('section.firstAid', 'First aid — perform now')}>
            <NumberedList items={workflow.first_aid} />
          </Section>
        )}

        <Section icon={User} title={t('common.patient', 'Patient')}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-xs">
            {[
              ['field.name', 'Name', workflow.patient?.name],
              ['field.age', 'Age', workflow.patient?.age != null
                ? t('field.ageYears', '{age} yr', { age: formatNumber(workflow.patient.age) })
                : null],
              ['field.gender', 'Gender', workflow.patient?.gender],
              ['field.village', 'Village', workflow.patient?.village],
              ['field.district', 'District', workflow.patient?.district],
              ['field.phone', 'Phone', workflow.patient?.phone]
            ].filter(([, , v]) => v).map(([key, en, v]) => (
              <div key={key}>
                <span className="block text-[10px] text-ink-subtle">{t(key, en)}</span>
                <span className="font-semibold text-ink">{v}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section icon={Pill} title={t('section.medication', 'Medication')}>
          {workflow.medication?.emitted ? (
            <div className="space-y-2">
              {workflow.medication.items.map((m, i) => (
                <div key={i} className="p-3 rounded-field bg-surface-sunken border border-line">
                  <p className="text-sm font-bold text-ink">{m.drug || m.name}</p>
                  <p className="text-xs text-ink-muted mt-0.5">
                    {[m.dose, m.frequency, m.duration].filter(Boolean).join(' · ')}
                  </p>
                  {m.availability?.cheapest_inr != null && (
                    <p className="text-[11px] text-tier-low mt-1">
                      {t('med.availability', 'From ₹{price} · {count} products available in India', {
                        price: formatNumber(m.availability.cheapest_inr),
                        count: formatNumber(m.availability.products)
                      })}
                    </p>
                  )}
                  {m.rule_source_id && (
                    <p className="text-[10px] text-ink-subtle font-mono mt-1">
                      {t('med.formulary', 'Formulary {id}', { id: m.rule_source_id })}
                    </p>
                  )}
                </div>
              ))}
              {workflow.medication.signature_status !== 'SIGNED' && (
                <Alert tone="danger" icon={AlertTriangle} title={t('med.unsignedTitle', 'Unsigned formulary')}>
                  {t('med.unsignedBody', 'These entries have not been reviewed by a registered medical practitioner for this deployment and must not be dispensed.')}
                </Alert>
              )}
            </div>
          ) : (
            <p className="text-xs text-ink-muted">{serverText(t, workflow.medication, 'reason')}</p>
          )}
        </Section>

        {workflow.precautions?.items?.length > 0 && (
          <Section icon={ListChecks} title={t('section.precautions', 'Precautions')}>
            <ul className="space-y-1.5">
              {workflow.precautions.items.map((p, i) => (
                <li key={i} className="flex gap-2 text-xs text-ink">
                  <span className="w-1.5 h-1.5 rounded-full bg-gov-500 shrink-0 mt-1.5" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {workflow.diet?.length > 0 && (
          <Section icon={Apple} title={t('section.diet', 'Diet guidance')}>
            <ul className="space-y-1.5">
              {workflow.diet.map((d, i) => (
                <li key={i} className="flex gap-2 text-xs text-ink-muted">
                  <span className="w-1.5 h-1.5 rounded-full bg-tier-low shrink-0 mt-1.5" />
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section icon={FileDown} title={t('section.hardcopy', 'Hardcopy')}>
          <PdfButtons visitId={visitId} tier={tier} />
        </Section>
      </Card>

      {/* ---- What happens on the doctor's side ---- */}
      <Alert
        tone={tier === 'HIGH' ? 'danger' : tier === 'MEDIUM' ? 'warning' : 'info'}
        icon={Stethoscope}
        title={
          workflow.doctor_action?.queue === 'NONE'
            ? t('queue.closed', 'Case closed on this platform')
            : workflow.doctor_action?.queue === 'CONSULTATION'
              ? t('queue.consultation', 'Sent for consultation')
              : t('queue.daily', 'Queued for daily doctor review')
        }
      >
        {serverText(t, workflow.doctor_action, 'note')}
      </Alert>
    </div>
  );

  // HIGH takes over the shell. Removing the other options is the point:
  // an emergency screen should not offer six equally-weighted choices.
  return tier === 'HIGH' ? <DangerZone>{body}</DangerZone> : (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
      {body}
    </motion.div>
  );
}
