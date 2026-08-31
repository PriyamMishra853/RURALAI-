import React, { useState } from 'react';
import {
  FileText, Camera, FlaskConical, CheckCircle2, AlertTriangle,
  ChevronDown, ChevronRight, Pill, ImageOff
} from 'lucide-react';
import { Card, CardHeader, Badge, EmptyState, cn } from './ui';

/**
 * Everything the assistant captured, as the doctor sees it — spec §3.6.
 *
 * A doctor reviewing a case remotely has no patient in front of them. The
 * prescription photograph, the lab report and the wound image ARE the
 * examination, so they are shown in full rather than summarised into a line of
 * text. Verification state is on every document, because an unverified OCR
 * extraction is a draft, not a finding.
 */

function Collapsible({ icon: Icon, title, count, badge, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-line rounded-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full px-4 py-3 flex items-center gap-2.5 bg-surface-sunken hover:bg-surface-sunken/70 transition-colors text-left"
      >
        {open ? <ChevronDown className="w-4 h-4 text-ink-subtle shrink-0" />
              : <ChevronRight className="w-4 h-4 text-ink-subtle shrink-0" />}
        <Icon className="w-4 h-4 text-gov-600 dark:text-gov-500 shrink-0" />
        <span className="text-sm font-bold text-ink flex-1">{title}</span>
        {badge}
        {count != null && <Badge tone="neutral">{count}</Badge>}
      </button>
      {open && <div className="p-4 space-y-3 bg-surface-raised">{children}</div>}
    </div>
  );
}

function PrescriptionDoc({ doc }) {
  const d = doc.extracted_data || {};
  const meds = d.medications || [];
  return (
    <div className="p-3 rounded-field bg-surface-sunken border border-line">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs font-bold text-ink">
          {d.doctor_name && d.doctor_name !== 'Unknown' ? `Dr ${d.doctor_name}` : 'Prescription'}
          {d.date && d.date !== 'Unknown' ? ` · ${d.date}` : ''}
        </span>
        {doc.verified_at
          ? <Badge tone="low"><CheckCircle2 className="w-3 h-3" /> Verified</Badge>
          : <Badge tone="moderate"><AlertTriangle className="w-3 h-3" /> Unverified</Badge>}
      </div>

      {meds.length ? (
        <ul className="space-y-1.5">
          {meds.map((m, i) => (
            <li key={i} className="text-xs text-ink">
              <span className="font-semibold">{m.name}</span>
              {m.strength ? ` ${m.strength}` : ''}
              <span className="text-ink-muted">
                {[m.frequency, m.duration, m.instructions].filter(Boolean).length
                  ? ` — ${[m.frequency, m.duration, m.instructions].filter(Boolean).join(' · ')}`
                  : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-ink-muted">No medication lines were read from this document.</p>
      )}

      {d.diagnosis_notes && (
        <p className="mt-2 pt-2 border-t border-line text-xs text-ink-muted">
          <span className="font-semibold text-ink">Noted: </span>{d.diagnosis_notes}
        </p>
      )}
    </div>
  );
}

function LabReportDoc({ doc }) {
  const d = doc.extracted_data || {};
  const panels = d.panels || [];
  const abnormal = d.abnormal_findings || [];

  return (
    <div className="p-3 rounded-field bg-surface-sunken border border-line">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs font-bold text-ink">
          {d.clinic_name && d.clinic_name !== 'Unknown' ? d.clinic_name : 'Laboratory report'}
          {d.pages_read ? ` · ${d.pages_read} page(s)` : ''}
        </span>
        {doc.verified_at
          ? <Badge tone="low"><CheckCircle2 className="w-3 h-3" /> Verified</Badge>
          : <Badge tone="moderate"><AlertTriangle className="w-3 h-3" /> Unverified</Badge>}
      </div>

      {panels.map((panel, i) => (
        <div key={i} className="mb-2">
          <p className="text-[11px] font-bold text-ink-muted uppercase tracking-wide">{panel.panel_name}</p>
          <div className="mt-1 space-y-0.5">
            {(panel.tests || []).map((t, j) => (
              <div key={j} className="flex items-baseline justify-between gap-3 text-xs py-0.5 border-b border-line/60">
                <span className="text-ink truncate">{t.name}</span>
                <span className={cn(
                  'font-mono shrink-0',
                  t.flag === 'high' ? 'text-tier-emergency font-bold'
                    : t.flag === 'low' ? 'text-tier-moderate font-bold'
                      : 'text-ink-muted'
                )}>
                  {t.value} {t.unit}
                  {t.reference_range && t.reference_range !== 'Unknown' && (
                    <span className="text-ink-subtle font-normal"> ({t.reference_range})</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {abnormal.length > 0 && (
        <div className="mt-2 p-2 rounded bg-tier-emergencyBg border border-tier-emergency/25">
          <p className="text-[11px] font-bold text-tier-emergency">Outside reference range</p>
          {abnormal.map((a, i) => (
            <p key={i} className="text-[11px] text-tier-emergency">• {a}</p>
          ))}
        </div>
      )}

      {d.impression && (
        <p className="mt-2 text-xs text-ink-muted"><span className="font-semibold text-ink">Impression: </span>{d.impression}</p>
      )}
    </div>
  );
}

function WoundImage({ image }) {
  const obs = image.observation || {};
  const [broken, setBroken] = useState(false);
  const severity = image.severity_impression || obs.severity_impression;

  return (
    <div className="p-3 rounded-field bg-surface-sunken border border-line">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="sm:w-40 shrink-0">
          {image.image_url && !broken ? (
            <a href={image.image_url} target="_blank" rel="noreferrer">
              <img
                src={image.image_url}
                alt="Clinical photograph"
                onError={() => setBroken(true)}
                className="w-full h-32 sm:h-28 object-cover rounded border border-line"
              />
            </a>
          ) : (
            <div className="w-full h-32 sm:h-28 rounded border border-dashed border-line flex flex-col items-center justify-center text-ink-subtle">
              <ImageOff className="w-5 h-5" />
              <span className="text-[10px] mt-1">Image unavailable</span>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Badge tone={severity === 'HIGH' ? 'emergency' : severity === 'MEDIUM' ? 'moderate' : 'low'}>
              {severity || 'observed'}
            </Badge>
            {obs.body_region && obs.body_region !== 'Unknown' && (
              <span className="text-[11px] text-ink-muted">{obs.body_region}</span>
            )}
          </div>

          <p className="mt-1.5 text-xs text-ink leading-relaxed">{obs.cautious_summary}</p>

          {obs.extent?.approximate_area && obs.extent.approximate_area !== 'Unknown' && (
            <p className="mt-1 text-[11px] text-ink-muted">
              Extent: {obs.extent.approximate_area}
              {obs.extent.spread_pattern && obs.extent.spread_pattern !== 'Unknown' ? ` · ${obs.extent.spread_pattern}` : ''}
            </p>
          )}

          {(obs.possible_conditions || []).length > 0 && (
            <div className="mt-2">
              <p className="text-[11px] font-bold text-ink">Appearance consistent with</p>
              {obs.possible_conditions.map((c, i) => (
                <p key={i} className="text-[11px] text-ink-muted">
                  • {c.description} <span className="text-ink-subtle">({c.confidence} confidence)</span>
                </p>
              ))}
              <p className="text-[10px] text-ink-subtle mt-1">
                Computer-vision observation only — not a diagnosis.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CaseEvidence({ documents = [], images = [], className }) {
  const prescriptions = documents.filter((d) => d.document_type === 'prescription');
  const reports = documents.filter((d) => d.document_type === 'lab_report');
  const other = documents.filter((d) => !['prescription', 'lab_report'].includes(d.document_type));

  const nothing = !documents.length && !images.length;

  return (
    <Card className={className}>
      <CardHeader
        title="Evidence captured by the assistant"
        subtitle="Prescriptions, laboratory reports and clinical photographs"
        icon={FileText}
      />
      <div className="p-4 sm:p-5 space-y-3">
        {nothing ? (
          <EmptyState
            icon={FileText}
            title="No documents or photographs attached"
            description="The assistant recorded symptoms and vitals only for this visit."
          />
        ) : (
          <>
            {prescriptions.length > 0 && (
              <Collapsible icon={Pill} title="Paper prescriptions" count={prescriptions.length}>
                {prescriptions.map((d) => <PrescriptionDoc key={d.id} doc={d} />)}
              </Collapsible>
            )}

            {reports.length > 0 && (
              <Collapsible icon={FlaskConical} title="Laboratory / test reports" count={reports.length}>
                {reports.map((d) => <LabReportDoc key={d.id} doc={d} />)}
              </Collapsible>
            )}

            {images.length > 0 && (
              <Collapsible icon={Camera} title="Clinical photographs" count={images.length}>
                {images.map((img) => <WoundImage key={img.id} image={img} />)}
              </Collapsible>
            )}

            {other.length > 0 && (
              <Collapsible icon={FileText} title="Other documents" count={other.length} defaultOpen={false}>
                {other.map((d) => (
                  <div key={d.id} className="p-3 rounded-field bg-surface-sunken border border-line">
                    <p className="text-xs font-bold text-ink capitalize">{String(d.document_type).replace('_', ' ')}</p>
                    <p className="text-xs text-ink-muted mt-1 line-clamp-2">
                      {d.extracted_data?.raw_text_summary || d.ocr_text || 'No text extracted.'}
                    </p>
                  </div>
                ))}
              </Collapsible>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
