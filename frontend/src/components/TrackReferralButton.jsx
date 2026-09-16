import React, { useState } from 'react';
import { Link2, Loader2, CheckCircle2 } from 'lucide-react';
import api from '../services/api';
import { useI18n } from '../i18n/index.jsx';
import { useAuth } from '../context/AuthContext';
import { useFeature, FEATURES } from '../context/FeatureContext';
import { Button } from './ui';

/**
 * "We are sending the patient here" — the assistant's explicit confirmation on
 * an emergency referral (Roadmap v3, Phase 1).
 *
 * Explicit because a hospital being displayed is not a patient being sent: the
 * family may refuse, or choose another. Only a confirmed referral is followed
 * up, so completion counts real referrals rather than every map that was shown.
 *
 * Its own component so the referral panel's labels stay untouched, and so it
 * renders nothing for doctors (whose referrals are tracked from their decision)
 * or when referral_tracking is off.
 */
export default function TrackReferralButton({ visitId, hospital }) {
  const enabled = useFeature(FEATURES.REFERRAL_TRACKING);
  const { user } = useAuth();
  const { t } = useI18n();
  const [state, setState] = useState({ saving: false, result: null, error: null });

  if (!enabled || user?.role !== 'CLINIC_ASSISTANT' || !visitId || !hospital) return null;

  const hospitalName = hospital.name || hospital.hospital_name;
  if (!hospitalName) return null;

  const confirm = async () => {
    setState({ saving: true, result: null, error: null });
    try {
      const res = await api.post('/referral-tracking', {
        visit_id: visitId,
        hospital_name: hospitalName,
        hospital_district: hospital.district || null
      });
      setState({ saving: false, result: res.data, error: null });
    } catch (err) {
      setState({ saving: false, result: null, error: err.response?.data?.error || t('track.failed', 'The referral could not be recorded.') });
    }
  };

  if (state.result) {
    const url = `${window.location.origin}${state.result.ack_path}`;
    return (
      <div className="p-3 rounded-field bg-surface-sunken border border-line text-[11px] space-y-1">
        <p className="font-semibold text-ink flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-gov-600" />
          {t('track.done', 'Referral {code} is being followed up.', { code: state.result.referral.referral_code })}
        </p>
        <p className="text-ink-muted">
          {t('track.shareLink', 'The printed referral slip carries the hospital link. To send it now, share:')}
        </p>
        <p className="font-mono text-ink break-all">{url}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Button variant="secondary" className="w-full" disabled={state.saving} onClick={confirm}>
        {state.saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
        {t('track.confirm', 'Patient is being sent here — follow up')}
      </Button>
      {state.error && <p role="alert" className="text-[11px] text-tier-emergency">{state.error}</p>}
    </div>
  );
}
