import React, { useState } from 'react';
import { FileText, CheckCircle2, Edit3, Save, AlertCircle, Sparkles, Loader2, Plus, Trash2 } from 'lucide-react';
import api from '../services/api';
import { useT } from '../i18n/index.jsx';

/**
 * Mandatory human verification of an OCR extraction, before it can reach the
 * clinical record.
 *
 * Handles two document shapes, because a prescription and a lab report carry
 * different data:
 *   - prescription: a list of medications (name, strength, frequency, ...)
 *   - lab_report:   panels of tests (name, value, unit, reference range, flag)
 *
 * For lab reports there is a second step beyond transcription: "Interpret
 * with AI" sends the transcribed values to a separate model call that reasons
 * about what the pattern suggests — never a diagnosis, always capped at
 * "moderate" confidence, always naming what the doctor should confirm.
 *
 * v1 posted `{ verified_data }`; the API has always expected `{ corrected_data }`
 * — that mismatch is why every verification failed with "corrected_data is
 * required" regardless of what was actually being verified.
 */

const emptyMed = () => ({ name: '', strength: '', frequency: '', duration: '', instructions: '' });
const emptyTest = () => ({ name: '', value: '', unit: '', reference_range: '', flag: 'unknown' });

/*
 * `flag` is stored and compared, so the values stay English; only the option
 * captions are translated.
 */
const FLAGS = [
  { value: 'unknown', key: 'lab.flag.unknown', label: '—' },
  { value: 'normal', key: 'lab.flag.normal', label: 'Normal' },
  { value: 'high', key: 'lab.flag.high', label: 'High' },
  { value: 'low', key: 'lab.flag.low', label: 'Low' }
];

export default function OCRVerificationModal({ documentId, visitId, initialData, rawText, onVerified, onClose }) {
  const t = useT();
  const isLabReport = initialData?.document_type === 'lab_report';

  const [medications, setMedications] = useState(initialData?.medications || []);
  const [diagnosisNotes, setDiagnosisNotes] = useState(initialData?.diagnosis_notes || '');
  const [advice, setAdvice] = useState(initialData?.advice || '');

  const [panels, setPanels] = useState(
    (initialData?.panels || []).map((p) => ({ ...p, tests: p.tests || [] }))
  );
  const [impression, setImpression] = useState(initialData?.impression || '');
  const [aiInterpretation, setAiInterpretation] = useState(null);
  const [interpreting, setInterpreting] = useState(false);
  const [interpretError, setInterpretError] = useState(null);

  const [editingMed, setEditingMed] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // ---- prescription editing ----
  const updateMed = (i, field, value) => {
    const next = [...medications];
    next[i] = { ...next[i], [field]: value };
    setMedications(next);
  };
  const addMed = () => setMedications([...medications, emptyMed()]);
  const removeMed = (i) => setMedications(medications.filter((_, idx) => idx !== i));

  // ---- lab report editing ----
  const updateTest = (pIdx, tIdx, field, value) => {
    const next = [...panels];
    next[pIdx] = { ...next[pIdx], tests: [...next[pIdx].tests] };
    next[pIdx].tests[tIdx] = { ...next[pIdx].tests[tIdx], [field]: value };
    setPanels(next);
  };
  const addTest = (pIdx) => {
    const next = [...panels];
    next[pIdx] = { ...next[pIdx], tests: [...next[pIdx].tests, emptyTest()] };
    setPanels(next);
  };
  const removeTest = (pIdx, tIdx) => {
    const next = [...panels];
    next[pIdx] = { ...next[pIdx], tests: next[pIdx].tests.filter((_, idx) => idx !== tIdx) };
    setPanels(next);
  };
  // The panel name is user-editable content that ends up in the record, so the
  // starting value is translated the same way a placeholder would be.
  const addPanel = () => setPanels([...panels, { panel_name: t('lab.newPanel', 'New panel'), tests: [] }]);

  const handleInterpret = async () => {
    setInterpreting(true);
    setInterpretError(null);
    try {
      const abnormal = panels.flatMap((p) =>
        (p.tests || [])
          .filter((t) => t.flag === 'high' || t.flag === 'low')
          .map((t) => `${t.name}: ${t.value} ${t.unit} (${t.flag}, ref ${t.reference_range})`)
      );
      const res = await api.post('/ai/interpret-report', {
        document_id: documentId,
        visit_id: visitId,
        lab_data: { panels, abnormal_findings: abnormal }
      });
      setAiInterpretation(res.data);
    } catch (err) {
      setInterpretError(err.response?.data?.error || t('lab.interpretFailed', 'Interpretation failed.'));
    } finally {
      setInterpreting(false);
    }
  };

  const handleConfirmVerification = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const corrected_data = isLabReport
        ? {
            ...initialData,
            document_type: 'lab_report',
            panels,
            impression,
            ai_interpretation: aiInterpretation || undefined
          }
        : {
            ...initialData,
            document_type: 'prescription',
            medications,
            diagnosis_notes: diagnosisNotes,
            advice
          };

      const res = await api.post(`/documents/${documentId}/verify`, { corrected_data });
      if (onVerified) onVerified(res.data.document.extracted_data);
      if (onClose) onClose();
    } catch (err) {
      setSaveError(err.response?.data?.error || err.message || t('ocr.verifyFailed', 'Verification failed.'));
    } finally {
      setSaving(false);
    }
  };

  const flagClass = (flag) =>
    flag === 'high' ? 'text-tier-emergency border-tier-emergency/40 bg-tier-emergencyBg'
      : flag === 'low' ? 'text-tier-moderate border-tier-moderate/40 bg-tier-moderateBg'
      : 'text-ink-muted border-line-strong bg-surface-raised';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-sunken/50 backdrop-blur-sm">
      <div className="bg-surface-raised w-full max-w-3xl rounded-field border border-line p-6 shadow-xl flex flex-col max-h-[90vh]">

        <div className="flex items-center justify-between pb-4 border-b border-line">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-field bg-gov-50 text-gov-600 flex items-center justify-center border border-gov-200">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-ink flex items-center gap-2">
                {isLabReport
                  ? t('ocr.verifyLab', 'Verify Lab Report')
                  : t('ocr.verifyRx', 'Verify Prescription')}
                <span className="text-[10px] font-semibold bg-tier-moderateBg text-tier-moderate px-2 py-0.5 rounded border border-tier-moderate/30">
                  {t('ocr.required', 'Verification required')}
                </span>
              </h3>
              <p className="text-xs text-ink-muted">
                {t('ocr.correctHint', 'Correct anything the reader misread before this joins the patient record.')}
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-4 space-y-4 pr-1">
          <div className="p-3 rounded-field bg-tier-moderateBg border border-tier-moderate/30 text-xs text-tier-moderate flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-tier-moderate shrink-0 mt-0.5" />
            <span>{t('ocr.notice', 'OCR extractions do not automatically enter the record. Check every value against the document before confirming.')}</span>
          </div>

          {saveError && (
            <div role="alert" className="p-3 rounded-field bg-tier-emergencyBg border border-tier-emergency/30 text-xs text-tier-emergency font-semibold">
              {saveError}
            </div>
          )}

          {!isLabReport ? (
            <>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-ink-muted">{t('section.medications', 'Medications')}</h4>
                  <button type="button" onClick={addMed} className="text-xs text-gov-600 hover:text-gov-700 font-semibold flex items-center gap-1">
                    <Plus className="w-3.5 h-3.5" /> {t('common.add', 'Add')}
                  </button>
                </div>

                {medications.length === 0 && (
                  <p className="text-xs text-ink-muted p-3 border border-dashed border-line-strong rounded-field text-center">
                    {t('ocr.noMeds', 'No medications were read. Add them manually below.')}
                  </p>
                )}

                <div className="space-y-3">
                  {medications.map((med, idx) => (
                    <div key={idx} className="p-3.5 rounded-field bg-surface-sunken border border-line flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                      {editingMed === idx ? (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 w-full">
                          <input value={med.name} onChange={(e) => updateMed(idx, 'name', e.target.value)} placeholder={t('field.medicineName', 'Medicine name')} className="bg-surface-raised border border-line-strong text-xs text-ink rounded px-2.5 py-1.5 focus:border-gov-500 outline-none" />
                          <input value={med.strength} onChange={(e) => updateMed(idx, 'strength', e.target.value)} placeholder={t('field.strength', 'Strength (e.g. 500mg)')} className="bg-surface-raised border border-line-strong text-xs text-ink rounded px-2.5 py-1.5 focus:border-gov-500 outline-none" />
                          <input value={med.frequency} onChange={(e) => updateMed(idx, 'frequency', e.target.value)} placeholder={t('field.frequency', 'Frequency')} className="bg-surface-raised border border-line-strong text-xs text-ink rounded px-2.5 py-1.5 focus:border-gov-500 outline-none" />
                          <input value={med.duration} onChange={(e) => updateMed(idx, 'duration', e.target.value)} placeholder={t('field.duration', 'Duration')} className="bg-surface-raised border border-line-strong text-xs text-ink rounded px-2.5 py-1.5 focus:border-gov-500 outline-none" />
                        </div>
                      ) : (
                        <div className="flex-1">
                          <div className="font-semibold text-sm text-ink flex items-center gap-2">
                            {med.name || <span className="text-ink-subtle italic">{t('ocr.unnamed', 'Unnamed')}</span>}
                            {med.strength && <span className="text-xs bg-surface-sunken text-ink-muted px-2 py-0.5 rounded font-medium">{med.strength}</span>}
                          </div>
                          <div className="text-xs text-ink-muted mt-1">
                            {med.frequency} {med.duration && `· ${med.duration}`} {med.instructions && `(${med.instructions})`}
                          </div>
                        </div>
                      )}
                      <div className="flex items-center gap-2 shrink-0">
                        {editingMed === idx ? (
                          <button type="button" onClick={() => setEditingMed(null)} className="px-3 py-1.5 rounded-field bg-tier-low hover:opacity-90 text-white text-xs font-medium flex items-center gap-1">
                            <Save className="w-3.5 h-3.5" /> {t('common.save', 'Save')}
                          </button>
                        ) : (
                          <button type="button" onClick={() => setEditingMed(idx)} className="px-2.5 py-1 rounded-field bg-surface-sunken hover:bg-slate-300 text-ink-muted text-xs font-medium flex items-center gap-1">
                            <Edit3 className="w-3.5 h-3.5" /> {t('common.edit', 'Edit')}
                          </button>
                        )}
                        <button type="button" onClick={() => removeMed(idx)} aria-label={t('ocr.removeMed', 'Remove medication')} className="p-1.5 rounded-field text-ink-subtle hover:text-tier-emergency hover:bg-tier-emergencyBg">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-ink-muted mb-1">
                  {t('ocr.diagnosisContext', 'Diagnosis / context on the prescription')}
                </label>
                <textarea rows={2} value={diagnosisNotes} onChange={(e) => setDiagnosisNotes(e.target.value)}
                  className="w-full bg-surface-raised border border-line-strong rounded-field p-2.5 text-xs text-ink focus:border-gov-500 outline-none" />
              </div>
            </>
          ) : (
            <>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-ink-muted">{t('lab.panels', 'Test panels')}</h4>
                  <button type="button" onClick={addPanel} className="text-xs text-gov-600 hover:text-gov-700 font-semibold flex items-center gap-1">
                    <Plus className="w-3.5 h-3.5" /> {t('lab.addPanel', 'Add panel')}
                  </button>
                </div>

                {panels.length === 0 && (
                  <p className="text-xs text-ink-muted p-3 border border-dashed border-line-strong rounded-field text-center">
                    {t('lab.noTests', 'No test values were read from this report.')}
                  </p>
                )}

                <div className="space-y-4">
                  {panels.map((panel, pIdx) => (
                    <div key={pIdx} className="p-3 rounded-field bg-surface-sunken border border-line">
                      <input
                        value={panel.panel_name}
                        onChange={(e) => {
                          const next = [...panels]; next[pIdx] = { ...panel, panel_name: e.target.value }; setPanels(next);
                        }}
                        className="font-semibold text-xs text-ink bg-transparent border-b border-transparent hover:border-line-strong focus:border-gov-500 outline-none mb-2 w-full"
                      />
                      <div className="space-y-1.5">
                        {panel.tests.map((t, tIdx) => (
                          <div key={tIdx} className="grid grid-cols-12 gap-1.5 items-center">
                            <input value={t.name} onChange={(e) => updateTest(pIdx, tIdx, 'name', e.target.value)} placeholder={t('field.testName', 'Test name')} className="col-span-4 bg-surface-raised border border-line-strong text-[11px] rounded px-2 py-1 focus:border-gov-500 outline-none" />
                            <input value={t.value} onChange={(e) => updateTest(pIdx, tIdx, 'value', e.target.value)} placeholder={t('field.value', 'Value')} className="col-span-2 bg-surface-raised border border-line-strong text-[11px] rounded px-2 py-1 focus:border-gov-500 outline-none font-mono" />
                            <input value={t.unit} onChange={(e) => updateTest(pIdx, tIdx, 'unit', e.target.value)} placeholder={t('field.unit', 'Unit')} className="col-span-2 bg-surface-raised border border-line-strong text-[11px] rounded px-2 py-1 focus:border-gov-500 outline-none" />
                            <input value={t.reference_range} onChange={(e) => updateTest(pIdx, tIdx, 'reference_range', e.target.value)} placeholder={t('field.reference', 'Reference')} className="col-span-2 bg-surface-raised border border-line-strong text-[11px] rounded px-2 py-1 focus:border-gov-500 outline-none" />
                            <select value={t.flag} onChange={(e) => updateTest(pIdx, tIdx, 'flag', e.target.value)} className={`col-span-1 text-[10px] rounded px-1 py-1 border outline-none ${flagClass(t.flag)}`}>
                              {FLAGS.map((f) => (
                                <option key={f.value} value={f.value}>{t(f.key, f.label)}</option>
                              ))}
                            </select>
                            <button type="button" onClick={() => removeTest(pIdx, tIdx)} aria-label={t('lab.removeTest', 'Remove test')} className="col-span-1 p-1 rounded text-ink-subtle hover:text-tier-emergency">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                        <button type="button" onClick={() => addTest(pIdx)} className="text-[11px] text-gov-600 hover:text-gov-700 font-semibold mt-1">
                          {t('lab.addTestRow', '+ Add test row')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-ink-muted mb-1">
                  {t('lab.impression', 'Impression printed on report (optional)')}
                </label>
                <textarea rows={2} value={impression} onChange={(e) => setImpression(e.target.value)}
                  placeholder={t('lab.impressionHint', 'Copy the lab’s own impression/comments section here if it has one')}
                  className="w-full bg-surface-raised border border-line-strong rounded-field p-2.5 text-xs text-ink focus:border-gov-500 outline-none" />
              </div>

              {/* AI interpretation — a second, separate step from transcription */}
              <div className="p-4 rounded-field bg-gov-50 border border-gov-200 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-gov-600 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4" /> {t('lab.aiTitle', 'AI interpretation of these values')}
                  </h4>
                  <button
                    type="button"
                    onClick={handleInterpret}
                    disabled={interpreting || panels.every((p) => !p.tests.length)}
                    className="px-3 py-1.5 rounded-field bg-gov-600 hover:bg-gov-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5"
                  >
                    {interpreting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {aiInterpretation ? t('lab.rerun', 'Re-run') : t('lab.interpret', 'Interpret with AI')}
                  </button>
                </div>
                <p className="text-[11px] text-purple-800">
                  {t('lab.aiHint', 'Reasons about the pattern in the values above — never a diagnosis, and always doctor-reviewed.')}
                </p>

                {interpretError && <p className="text-[11px] text-tier-emergency font-semibold">{interpretError}</p>}

                {aiInterpretation && (
                  <div className="space-y-2 pt-2 border-t border-gov-200">
                    <p className="text-xs text-gov-600 font-medium">{aiInterpretation.overall_impression}</p>

                    {aiInterpretation.possible_conditions?.map((c, i) => (
                      <div key={i} className="text-[11px] bg-surface-raised rounded-field p-2.5 border border-purple-100">
                        <div className="font-semibold text-ink">
                          {c.description}{' '}
                          <span className="text-ink-subtle font-normal">
                            ({t('scan.confidence', '{level} confidence', {
                              level: t('scan.confidence.' + c.confidence, c.confidence)
                            })})
                          </span>
                        </div>
                        {c.supporting_values?.length > 0 && (
                          <div className="text-ink-muted mt-0.5">
                            {t('lab.basedOn', 'Based on: {values}', { values: c.supporting_values.join(', ') })}
                          </div>
                        )}
                        {c.doctor_should_confirm && (
                          <div className="text-ink-muted mt-0.5 italic">
                            {t('lab.doctorConfirm', 'Doctor should confirm: {what}', { what: c.doctor_should_confirm })}
                          </div>
                        )}
                      </div>
                    ))}

                    {aiInterpretation.urgency_flags?.length > 0 && (
                      <div className="p-2 rounded-field bg-tier-emergencyBg border border-tier-emergency/30 text-[11px] text-tier-emergency">
                        <strong>{t('lab.urgencyFlags', 'Flagged for urgency:')}</strong>{' '}
                        {aiInterpretation.urgency_flags.join('; ')}
                      </div>
                    )}
                    <p className="text-[10px] text-gov-600">
                      {t('lab.observationOnly', 'Observation only, not a diagnosis — saved with this report for the reviewing doctor.')}
                    </p>
                  </div>
                )}
              </div>
            </>
          )}

          {rawText && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-ink-muted mb-1">{t('ocr.rawText', 'Raw OCR text')}</h4>
              <pre className="p-3 rounded-field bg-surface-sunken border border-line text-[11px] text-ink-muted overflow-x-auto max-h-32 whitespace-pre-wrap">
                {rawText}
              </pre>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-line">
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-medium text-ink-muted hover:text-ink border border-line rounded-field bg-surface-sunken">
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={handleConfirmVerification}
            disabled={saving}
            className="px-5 py-2 rounded-field bg-gov-600 hover:bg-gov-700 disabled:opacity-60 text-white font-semibold text-xs shadow-sm flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4" />{' '}
            {saving ? t('common.saving', 'Saving…') : t('ocr.confirmAttach', 'Confirm & attach to visit')}
          </button>
        </div>
      </div>
    </div>
  );
}
