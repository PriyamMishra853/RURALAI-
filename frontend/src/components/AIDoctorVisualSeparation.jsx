import React from 'react';
import { Bot, Stethoscope, AlertTriangle, BookOpen, ShieldCheck, FileCheck2, UserCheck, Camera, FileText, Pill, Eye, RefreshCw, CheckCircle2 } from 'lucide-react';
import RiskBadge from './RiskBadge';
import { useI18n } from '../i18n/index.jsx';

/**
 * The AI's contribution and the doctor's decision, kept visually apart.
 *
 * Both halves are translated, including the section headings. This panel's
 * whole job is to make it obvious which statements carry a doctor's authority
 * and which do not, and a heading a reader cannot read cannot do that job.
 *
 * What is NOT translated, deliberately:
 *   - drug names, strengths and dose strings, which are canonical
 *   - the OCR extraction dump, which is diagnostic JSON
 *   - protocol titles from MoHFW, which are cited documents
 */
export default function AIDoctorVisualSeparation({ aiAssessment, doctorReview, prescription, documents = [], images = [] }) {
  const { t, formatNumber } = useI18n();
  const isAIProcessing = aiAssessment?.processing_status === 'processing';
  const notAvailable = t('cv.notAvailable', 'Not available from automated analysis');

  return (
    <div className="space-y-6">
      
      {/* 🤖 1. AI ASSISTANCE & CLINICAL ARTIFACTS SECTION */}
      <div className="rounded-field bg-surface-raised border border-line p-6 shadow-sm space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-line">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-field bg-gov-50 text-gov-600 border border-gov-200 flex items-center justify-center shrink-0">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-ink flex items-center gap-2">
                🤖 {t('aiPanel.title', 'AI Assessment Summary & Clinical Artifacts')}
              </h3>
              <p className="text-xs text-ink-muted">
                {t('aiPanel.subtitle', 'Database-backed AI synthesis, OCR extractions, and computer vision photo analysis.')}
              </p>
            </div>
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-wider bg-gov-50 text-gov-700 px-2.5 py-1 rounded border border-gov-200">
            {t('aiPanel.chip', 'AI Data Layer')}
          </span>
        </div>

        {/* Realtime Processing Banner */}
        {isAIProcessing && (
          <div className="p-4 rounded-field bg-gov-50 border border-gov-200 text-xs text-blue-800 flex items-center gap-2 font-medium">
            <RefreshCw className="w-4 h-4 text-gov-600 animate-spin shrink-0" />
            <span>{t('aiPanel.processing', 'AI Patient Assessment is processing in real-time… Please wait while clinical protocols are retrieved.')}</span>
          </div>
        )}

        {aiAssessment ? (
          <div className="space-y-4 text-xs text-ink">
            
            {/* Risk Status */}
            <div className="flex items-center justify-between p-3 rounded-field bg-surface-sunken border border-line">
              <span className="font-semibold text-ink-muted">{t('aiPanel.ruleRisk', 'Rule Engine Risk Status:')}</span>
              <RiskBadge level={aiAssessment.risk_level} />
            </div>

            {/* AI Summary */}
            <div className="p-4 rounded-field bg-surface-sunken border border-line">
              <div className="font-bold text-gov-700 mb-1 flex items-center gap-1.5">
                <Bot className="w-4 h-4 text-gov-600" /> {t('aiPanel.summaryTitle', 'Patient Assessment Summary')}
              </div>
              <p className="leading-relaxed text-ink font-medium">
                {aiAssessment.patient_summary
                  || aiAssessment.summary
                  || t('aiPanel.summaryLogged', 'Patient Assessment Summary Logged')}
              </p>
            </div>

            {/* Step-by-Step First Aid Guidance */}
            {aiAssessment.first_aid_steps && aiAssessment.first_aid_steps.length > 0 && (
              <div className="p-4 rounded-field bg-tier-lowBg/50 border border-tier-low/30 space-y-2">
                <div className="font-bold text-tier-low flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-tier-low" /> {t('aiPanel.firstAid', 'Step-by-Step First-Aid Guidance')}
                </div>
                <div className="space-y-1.5 text-ink">
                  {aiAssessment.first_aid_steps.map((step, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <span className="w-4 h-4 rounded-full bg-tier-lowBg text-tier-low font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                        {formatNumber(idx + 1)}
                      </span>
                      <span>{step}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/*
              This panel exists to show what the AI produced as distinct from
              what the doctor decided — so it is exactly the wrong place to
              print medicines. The AI side names none; medication appears only
              under the doctor's own decision below.
            */}
            <div className="p-4 rounded-field bg-surface-sunken border border-line space-y-1">
              <div className="font-bold text-ink-muted flex items-center gap-1.5">
                <Pill className="w-4 h-4" /> {t('aiPanel.noMedication', 'Medication — not suggested by the AI')}
              </div>
              <p className="text-xs text-ink-muted">
                {aiAssessment.medication_withheld_reason
                  || t('aiPanel.medicationReserved', 'Medication is a clinical decision reserved for the doctor.')}
              </p>
            </div>

            {/* Scanned Document OCR Data */}
            {documents && documents.length > 0 && (
              <div className="p-4 rounded-field bg-surface-sunken border border-line space-y-2">
                <div className="font-bold text-tier-low flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-tier-low" />{' '}
                  {t('aiPanel.ocrRecords', 'Scanned Document (OCR) Records ({count})', { count: formatNumber(documents.length) })}
                </div>
                {documents.map((doc, idx) => (
                  <div key={idx} className="p-2.5 rounded-field bg-surface-raised border border-line text-xs space-y-1">
                    <div className="font-semibold text-ink">
                      {doc.original_file_name || doc.file_name}{' '}
                      ({t('docType.' + doc.document_type, doc.document_type)})
                    </div>
                    {doc.document_extractions?.[0]?.structured_data && (
                      <div className="text-ink-muted">
                        {t('aiPanel.extracted', 'Extracted')}:{' '}
                        {/* Raw JSON on purpose — this is the diagnostic dump, not prose. */}
                        {JSON.stringify(doc.document_extractions[0].structured_data.medications || doc.document_extractions[0].structured_data)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* COMPLETE COMPUTER VISION & INJURY WOUND OBSERVATIONS (ALL FIELDS) */}
            {images && images.length > 0 && (
              <div className="p-4 rounded-field bg-surface-sunken border border-line space-y-4">
                <div className="font-bold text-purple-800 flex items-center gap-1.5 text-sm">
                  <Camera className="w-4 h-4 text-gov-600" />{' '}
                  {t('aiPanel.woundObs', 'Injury & Clinical Wound Photo Observations ({count})', { count: formatNumber(images.length) })}
                </div>
                
                {images.map((img, idx) => {
                  const imgUrl = img.image_url || null;
                  const cvData = img.computer_vision_analysis || {};
                  const obsFeatures = img.observable_features || [];
                  const warnings = img.warnings || [];

                  return (
                    <div key={idx} className="p-4 rounded-field bg-surface-raised border border-line text-xs space-y-4 shadow-sm">
                      
                      {/* Render Actual Wound Photo Image */}
                      {imgUrl ? (
                        <div className="rounded-field overflow-hidden border border-line max-h-72 bg-surface-sunken flex items-center justify-center p-2">
                          <img
                            src={imgUrl}
                            alt={t('cv.woundPhotoAlt', 'Uploaded clinical wound photo')}
                            className="max-h-64 object-contain rounded w-full"
                          />
                        </div>
                      ) : (
                        <div className="p-4 rounded bg-surface-sunken border text-ink-muted text-center">
                          {t('cv.previewPending', 'Image preview pending')}
                        </div>
                      )}

                      {/* 1. Computer Vision Surface Analysis Breakdown */}
                      <div className="space-y-2">
                        <div className="font-bold text-gov-600 flex items-center gap-1.5 text-xs">
                          <Eye className="w-4 h-4 text-gov-600" /> {t('cv.breakdown', 'Computer Vision Surface Feature Breakdown:')}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div className="p-2.5 rounded-field bg-gov-50/60 border border-gov-200">
                            <span className="font-bold text-gov-600 block text-[11px] uppercase tracking-wider mb-0.5">
                              {t('cv.tissueMargin', 'Tissue Margin Erythema')}
                            </span>
                            <span className="text-ink text-[11px] leading-snug block">
                              {cvData.tissue_margin || notAvailable}
                            </span>
                          </div>

                          <div className="p-2.5 rounded-field bg-gov-50/60 border border-gov-200">
                            <span className="font-bold text-gov-600 block text-[11px] uppercase tracking-wider mb-0.5">
                              {t('cv.surfaceFeatures', 'Surface Features & Swelling')}
                            </span>
                            <span className="text-ink text-[11px] leading-snug block">
                              {cvData.surface_features || notAvailable}
                            </span>
                          </div>

                          <div className="p-2.5 rounded-field bg-gov-50/60 border border-gov-200">
                            <span className="font-bold text-gov-600 block text-[11px] uppercase tracking-wider mb-0.5">
                              {t('cv.exudate', 'Exudate & Moisture')}
                            </span>
                            <span className="text-ink text-[11px] leading-snug block">
                              {cvData.exudate_observation || notAvailable}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* 2. Observable Features Bullet List */}
                      {obsFeatures && obsFeatures.length > 0 && (
                        <div className="space-y-1.5 pt-2 border-t border-line">
                          <div className="font-bold text-ink flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-tier-low" /> {t('cv.detected', 'Detected Anatomical Features & Findings:')}
                          </div>
                          <div className="space-y-1 text-ink-muted pl-1">
                            {obsFeatures.map((feat, fIdx) => (
                              <div key={fIdx} className="flex items-start gap-1.5">
                                <span className="text-gov-600 font-bold">•</span>
                                <span>{feat}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 3. Complete Untruncated Cautious Summary */}
                      <div className="p-3 rounded-field bg-surface-sunken border border-line text-ink space-y-1">
                        <div className="font-bold text-ink">{t('cv.cautiousSummary', 'Complete Cautious Summary for Doctor Review:')}</div>
                        <p className="leading-relaxed text-ink text-[11px]">
                          {img.cautious_summary
                            || t('cv.noAnalysis', 'No automated visual analysis is available for this photograph — please review the image directly.')}
                        </p>
                      </div>

                      {/* 4. Safety Warnings & Red Flag Guidance */}
                      {warnings && warnings.length > 0 && (
                        <div className="p-3 rounded-field bg-tier-moderateBg border border-tier-moderate/30 text-tier-moderate space-y-1 text-[11px]">
                          <div className="font-bold flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5 text-tier-moderate" /> {t('cv.precautions', 'Vision System Clinical Precautions:')}
                          </div>
                          <ul className="list-disc list-inside space-y-0.5 text-ink">
                            {warnings.map((w, wIdx) => (
                              <li key={wIdx}>{w}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                    </div>
                  );
                })}
              </div>
            )}

            {/* Warning Flags */}
            {aiAssessment.warnings && aiAssessment.warnings.length > 0 && (
              <div className="p-3.5 rounded-field bg-tier-moderateBg border border-tier-moderate/30 text-tier-moderate">
                <div className="font-bold flex items-center gap-1.5 mb-1">
                  <AlertTriangle className="w-4 h-4 text-tier-moderate" /> {t('aiPanel.warningFlags', 'Warning Flags & Safety Checks')}
                </div>
                <ul className="list-disc list-inside space-y-1 text-ink">
                  {aiAssessment.warnings.map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Protocol References */}
            {aiAssessment.protocol_matches && aiAssessment.protocol_matches.length > 0 && (
              <div className="p-4 rounded-field bg-surface-sunken border border-line">
                <div className="font-bold text-blue-800 flex items-center gap-1.5 mb-2">
                  <BookOpen className="w-4 h-4 text-gov-600" /> {t('aiPanel.protocols', 'Approved MoHFW Clinical Protocols')}
                </div>
                <div className="space-y-2">
                  {aiAssessment.protocol_matches.map((p, idx) => (
                    <div key={idx} className="p-3 rounded-field bg-surface-raised border border-line">
                      <div className="font-semibold text-ink">{p.title} ({p.source || 'MoHFW'})</div>
                      <p className="text-xs text-ink-muted mt-1 leading-relaxed">{p.guidance || p.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        ) : (
          <div className="p-4 rounded-field bg-gov-50 border border-gov-200 text-xs text-blue-800 flex items-center gap-2 font-medium">
            <RefreshCw className="w-4 h-4 text-gov-600 animate-spin shrink-0" />
            <span>{t('aiPanel.pending', 'AI Patient Assessment is processing or pending for this visit. Uploads will appear live once generated.')}</span>
          </div>
        )}
      </div>

      {/* 👨‍⚕️ 2. DOCTOR DECISION SECTION */}
      <div className="rounded-field bg-surface-raised border border-line p-6 shadow-sm space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-line">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-field bg-tier-lowBg text-tier-low border border-emerald-100 flex items-center justify-center shrink-0">
              <Stethoscope className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-ink flex items-center gap-2">
                👨‍⚕️ {t('doctorPanel.title', 'Qualified Doctor Medical Decision')}
              </h3>
              <p className="text-xs text-ink-muted">
                {t('doctorPanel.subtitle', 'Final clinical diagnosis, prescription issuance, and treatment decisions by Registered Doctor.')}
              </p>
            </div>
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-wider bg-tier-lowBg text-tier-low px-2.5 py-1 rounded border border-tier-low/30">
            {t('doctorPanel.chip', 'Doctor Medical Decision')}
          </span>
        </div>

        {doctorReview ? (
          <div className="space-y-4 text-xs">
            <div className="p-3.5 rounded-field bg-surface-sunken border border-line flex items-center justify-between">
              <div>
                <span className="text-ink-muted">{t('doctorPanel.decision', 'Doctor Decision:')}</span>
                <span className="ml-2 font-bold text-sm text-tier-low uppercase">
                  {t('decision.' + String(doctorReview.decision || '').replace(/_(.)/g, (m, c) => c.toUpperCase()), doctorReview.decision)}
                </span>
              </div>
              <span className="text-ink-muted flex items-center gap-1">
                <UserCheck className="w-3.5 h-3.5 text-tier-low" /> {t('doctorPanel.reviewedBy', 'Reviewed by Registered Doctor')}
              </span>
            </div>

            {doctorReview.doctor_notes && (
              <div className="p-3.5 rounded-field bg-surface-sunken border border-line">
                <div className="font-bold text-tier-low mb-1">{t('doctorPanel.notes', 'Clinical Notes & Observations')}</div>
                <p className="text-ink leading-relaxed">{doctorReview.doctor_notes}</p>
              </div>
            )}

            {prescription && prescription.prescription_data && (
              <div className="p-4 rounded-field bg-tier-lowBg/50 border border-tier-low/30">
                <div className="font-bold text-tier-low flex items-center gap-1.5 mb-2 text-sm">
                  <FileCheck2 className="w-4 h-4 text-tier-low" /> {t('doctorPanel.signedRx', 'Official Signed Digital Prescription')}
                </div>
                <div className="space-y-2">
                  {(prescription.prescription_data.medications || prescription.prescription_data || []).map((med, idx) => (
                    <div key={idx} className="p-2.5 rounded-field bg-surface-raised border border-line flex items-center justify-between">
                      <span className="font-semibold text-ink">{med.name} ({med.strength})</span>
                      <span className="text-ink-muted">
                        {t('rx.forDuration', '{frequency} for {duration}', {
                          frequency: med.frequency, duration: med.duration
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 rounded-field bg-surface-sunken border border-dashed border-line text-center text-xs text-ink-muted">
            ⏳ {t('doctorPanel.pending', 'Pending Remote Doctor Review & Final Medical Decision.')}
          </div>
        )}
      </div>

    </div>
  );
}
