import React, { useState, useEffect } from 'react';
import { Stethoscope, CheckCircle2, BadgeCheck } from 'lucide-react';
import api from '../services/api';

/**
 * Doctor selection grid for the clinic assistant portal.
 * Fetches the live doctor directory and renders selectable cards.
 *
 * Props:
 *  - multiSelect: false -> radio behaviour, onChange(doctor | null)
 *                 true  -> checkbox behaviour, onChange(doctor[])
 *  - selected: (single) doctor object | (multi) array of doctor objects
 *  - compact: smaller cards for use inside modals
 */
export default function DoctorSelectGrid({ multiSelect = false, selected, onChange, compact = false }) {
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/doctor/directory')
      .then((res) => setDoctors(res.data?.doctors || []))
      .catch((err) => setError(err.response?.data?.error || 'Failed to load the doctor directory'))
      .finally(() => setLoading(false));
  }, []);

  const isSelected = (doc) =>
    multiSelect
      ? (selected || []).some((d) => d.id === doc.id)
      : selected?.id === doc.id;

  const toggle = (doc) => {
    if (multiSelect) {
      const current = selected || [];
      onChange(isSelected(doc) ? current.filter((d) => d.id !== doc.id) : [...current, doc]);
    } else {
      onChange(isSelected(doc) ? null : doc);
    }
  };

  if (loading) {
    return <div className="p-4 text-center text-xs text-ink-muted">Loading available doctors...</div>;
  }
  if (error) {
    return <div className="p-4 rounded-field bg-tier-emergencyBg border border-tier-emergency/30 text-xs text-tier-emergency font-medium">{error}</div>;
  }
  if (doctors.length === 0) {
    return (
      <div className="p-4 rounded-field border border-dashed border-line-strong text-center text-xs text-ink-muted">
        No doctors are registered yet. Run the doctor seeding script or register a doctor account.
      </div>
    );
  }

  return (
    <div className={`grid grid-cols-1 ${compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3'} gap-3`}>
      {doctors.map((doc) => {
        const active = isSelected(doc);
        return (
          <button
            key={doc.id}
            type="button"
            onClick={() => toggle(doc)}
            aria-pressed={active}
            className={`text-left p-3.5 rounded-field border transition-all ${
              active
                ? 'border-blue-500 bg-gov-50 ring-2 ring-blue-200 shadow-sm'
                : 'border-line bg-surface-raised hover:border-gov-300 hover:bg-surface-sunken'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className={`w-8 h-8 rounded-field flex items-center justify-center border shrink-0 ${
                active ? 'bg-gov-600 text-white border-blue-600' : 'bg-gov-50 text-gov-600 border-gov-200'
              }`}>
                <Stethoscope className="w-4 h-4" />
              </div>
              {active && <CheckCircle2 className="w-5 h-5 text-gov-600 shrink-0" />}
            </div>

            <div className="mt-2 font-bold text-xs text-ink">{doc.name}</div>
            <div className="text-[11px] font-semibold text-gov-700">{doc.specialization}</div>
            {!compact && doc.qualification && (
              <div className="text-[10px] text-ink-muted mt-0.5 leading-snug">{doc.qualification}</div>
            )}
            {doc.registration_number && (
              <div className="text-[10px] text-ink-subtle mt-1 flex items-center gap-1">
                <BadgeCheck className="w-3 h-3" /> {doc.registration_number}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
