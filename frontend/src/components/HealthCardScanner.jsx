import React, { useRef, useState } from 'react';
import { Camera, Loader2, CheckCircle2, AlertTriangle, X, ScanLine } from 'lucide-react';
import api from '../services/api';

/**
 * Read a health / ABHA card to help fill the registration form.
 *
 * Nothing is applied automatically. The card is a suggestion and the operator
 * is the one who decides, for two reasons that both end in the same place — a
 * medical record attached to the wrong person:
 *
 *   OCR misreads. Indian cards are frequently laminated, glared, worn or
 *   transliterated inconsistently, and a confidently wrong name looks exactly
 *   like a correct one once it is sitting in a text box.
 *
 *   Typed values are evidence too. If the operator has already entered a name,
 *   they got it from somewhere — usually the patient in front of them, who is
 *   a better source than a photograph. Overwriting that silently would destroy
 *   the better value with the worse one.
 *
 * So every field is offered as a comparison, and a field that already has a
 * value shows what would be replaced before anything replaces it.
 */

const FIELD_LABELS = {
  full_name: 'Name',
  gender: 'Sex',
  date_of_birth: 'Date of birth'
};

const CONFIDENCE_TONE = {
  high: 'text-tier-low bg-tier-lowBg border-tier-low/30',
  medium: 'text-tier-moderate bg-tier-moderateBg border-tier-moderate/30',
  low: 'text-tier-emergency bg-tier-emergencyBg border-tier-emergency/30'
};

export default function HealthCardScanner({ form, onApply }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [applied, setApplied] = useState({});

  const scan = async (files) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setApplied({});

    const body = new FormData();
    for (const f of files) body.append('files', f);

    try {
      const res = await api.post('/documents/health-card', body, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setResult(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'The card could not be read. Enter the details by hand.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const apply = (key, value) => {
    onApply(key, value);
    setApplied((a) => ({ ...a, [key]: true }));
  };

  const proposals = Object.entries(result?.fields || {})
    .filter(([key]) => key in FIELD_LABELS);

  return (
    <div className="p-4 rounded-field border border-dashed border-line-strong bg-surface-sunken space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xs font-bold text-ink flex items-center gap-1.5">
            <ScanLine className="w-4 h-4 text-gov-600" /> Scan a health card (optional)
          </h3>
          <p className="text-[11px] text-ink-muted mt-0.5">
            Photograph an ABHA or health card to read the name, sex and date of birth.
            Nothing is filled in until you accept it.
          </p>
        </div>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="shrink-0 px-3 py-2 rounded-field bg-gov-600 hover:bg-gov-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
          {busy ? 'Reading…' : 'Scan card'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          multiple
          hidden
          onChange={(e) => scan(Array.from(e.target.files || []))}
        />
      </div>

      {error && (
        <div role="alert" className="p-2.5 rounded-field bg-tier-emergencyBg border border-tier-emergency/30 text-[11px] text-tier-emergency flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${CONFIDENCE_TONE[result.confidence] || CONFIDENCE_TONE.low}`}>
              {result.confidence} confidence
            </span>
            <button
              type="button"
              onClick={() => setResult(null)}
              className="text-[11px] text-ink-subtle hover:text-ink flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Dismiss
            </button>
          </div>

          {result.confidence === 'low' && (
            <p className="text-[11px] text-tier-moderate">
              The image was hard to read. Check every value against the card before accepting it.
            </p>
          )}

          {proposals.length === 0 ? (
            <p className="text-[11px] text-ink-muted">
              Nothing usable was read from this card. Enter the details by hand.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {proposals.map(([key, value]) => {
                const current = form[key];
                const same = String(current || '') === String(value);
                return (
                  <li key={key} className="flex items-center gap-2 text-[11px] bg-surface-raised border border-line rounded-field px-2.5 py-2">
                    <span className="text-ink-muted w-24 shrink-0">{FIELD_LABELS[key]}</span>
                    <span className="font-semibold text-ink truncate flex-1">{value}</span>

                    {same ? (
                      <span className="text-tier-low flex items-center gap-1 shrink-0">
                        <CheckCircle2 className="w-3.5 h-3.5" /> matches
                      </span>
                    ) : applied[key] ? (
                      <span className="text-tier-low flex items-center gap-1 shrink-0">
                        <CheckCircle2 className="w-3.5 h-3.5" /> applied
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => apply(key, value)}
                        className="shrink-0 px-2 py-1 rounded bg-gov-600 hover:bg-gov-700 text-white font-semibold"
                      >
                        {/* Naming what is being lost, rather than a bare "Use". */}
                        {current ? `Replace “${String(current).slice(0, 18)}”` : 'Use'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {result.rejected?.length > 0 && (
            <p className="text-[11px] text-ink-subtle">
              Not read from this card: {result.rejected.map((k) => FIELD_LABELS[k] || k).join(', ')}. Enter by hand.
            </p>
          )}

          {result.fields?.year_of_birth && !result.fields?.date_of_birth && (
            <p className="text-[11px] text-ink-muted">
              The card shows only a year of birth ({result.fields.year_of_birth}). Enter the full date, or the
              patient&apos;s stated age.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
