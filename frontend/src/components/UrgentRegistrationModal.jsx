import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Siren, Loader2, AlertTriangle } from 'lucide-react';
import api from '../services/api';
import { Button, Input, Alert } from './ui';

/**
 * Emergency bypass registration.
 *
 * A patient who needs care now, before their documents exist. This used to
 * link to the full registration form, which asks for Aadhaar, address, PIN
 * code and phone — the form is the thing being bypassed, so sending the
 * assistant to it defeated the purpose.
 *
 * Two fields are asked for, and only two, because both change how the patient
 * is triaged: age thresholds differ for children and the elderly, and some
 * rules are sex-specific. Everything else — name included — can wait. The
 * server issues the provisional identifier and leaves the identity fields
 * empty rather than inventing them.
 *
 * On success this goes straight to the assessment screen, because the next
 * thing that should happen is recording what is wrong with the patient.
 */

const GENDERS = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'other', label: 'Other' }
];

export default function UrgentRegistrationModal({ onClose }) {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [gender, setGender] = useState('');
  const [ageYears, setAgeYears] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    try {
      const res = await api.post('/patients/urgent', {
        full_name: fullName.trim() || undefined,
        gender,
        age_years: ageYears
      });
      // The server says where to go next; it knows the provisional identifier.
      navigate(res.data.next || `/assistant/assessment/${res.data.aadhaar_number}`);
    } catch (err) {
      const data = err.response?.data;
      setFieldErrors(data?.fields || {});
      setError(data?.error || 'The emergency registration could not be saved.');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-surface-sunken/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface-raised rounded-card w-full max-w-md shadow-xl">
        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded-field bg-tier-emergencyBg text-tier-emergency flex items-center justify-center shrink-0">
              <Siren className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h3 className="font-bold text-ink text-sm">Urgent registration</h3>
              <p className="text-[11px] text-ink-muted">No documents needed — record details later</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-field text-ink-subtle hover:bg-surface-sunken">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          {error && (
            <Alert tone="danger" icon={AlertTriangle}>{error}</Alert>
          )}

          <Input
            label="Name (optional)"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Leave blank if unknown"
            hint="A guest number is issued if this is empty."
            autoFocus
          />

          <div>
            <span className="block text-xs font-semibold text-ink-muted mb-1.5">Sex *</span>
            <div className="grid grid-cols-3 gap-2">
              {GENDERS.map((g) => (
                <button
                  key={g.value}
                  type="button"
                  onClick={() => setGender(g.value)}
                  className={`py-2.5 rounded-field border text-xs font-semibold transition-colors ${
                    gender === g.value
                      ? 'border-gov-600 bg-gov-50 text-gov-700 ring-2 ring-blue-200'
                      : 'border-line bg-surface-raised text-ink-muted hover:border-gov-300'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
            {fieldErrors.gender && <p className="text-[11px] text-tier-emergency mt-1">{fieldErrors.gender}</p>}
          </div>

          <Input
            label="Estimated age (years) *"
            type="number"
            min="0"
            max="120"
            value={ageYears}
            onChange={(e) => setAgeYears(e.target.value)}
            placeholder="e.g. 45"
            error={fieldErrors.age_years}
            hint="An estimate is fine — triage thresholds depend on age, so it cannot be skipped."
          />

          <div className="flex gap-2 pt-1">
            <Button type="submit" variant="danger" disabled={busy || !gender || !ageYears} className="flex-1">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Siren className="w-4 h-4" />}
              {busy ? 'Registering…' : 'Register and record symptoms'}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
          </div>

          <p className="text-[11px] text-ink-subtle">
            A provisional record is created. Add the Aadhaar and address once the
            patient is stable — the record stays flagged until then.
          </p>
        </form>
      </div>
    </div>
  );
}
