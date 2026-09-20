import React, { createContext, useContext, useEffect, useState } from 'react';
import api from '../services/api';

/**
 * Which optional features this deployment has switched on.
 *
 * Read once, from GET /api/features. The server enforces every flag on the
 * feature's own routes — a disabled feature's endpoints answer 404 — so this
 * list decides only what to render. Its job is to stop the interface offering
 * a button whose request would fail.
 *
 * Until the answer arrives, and if it never does, everything is off. The
 * checkpoint's behaviour is the safe default: a failed fetch must never be the
 * way an unfinished clinical feature appears on someone's screen.
 */

export const FEATURES = {
  BASELINE_METRICS: 'baseline_metrics',
  DOCTOR_REFERRAL: 'doctor_referral',
  VOICE_INTAKE: 'voice_intake',
  REFERRAL_TRACKING: 'referral_tracking',
  FOLLOW_UP_TRACKING: 'follow_up_tracking',
  FHIR_EXPORT: 'fhir_export',
  PATIENT_CONSENT: 'patient_consent',
  DISTRICT_OUTCOMES: 'district_outcomes'
};

const EMPTY = { features: new Set(), ready: false };
const FeatureContext = createContext(EMPTY);

export function FeatureProvider({ children }) {
  const [state, setState] = useState(EMPTY);

  useEffect(() => {
    let cancelled = false;
    api.get('/features')
      .then((res) => {
        if (!cancelled) setState({ features: new Set(res.data?.features ?? []), ready: true });
      })
      .catch(() => {
        if (!cancelled) setState({ features: new Set(), ready: true });
      });
    return () => { cancelled = true; };
  }, []);

  return <FeatureContext.Provider value={state}>{children}</FeatureContext.Provider>;
}

/** True only when the server has said this feature is on. */
export const useFeature = (name) => useContext(FeatureContext).features.has(name);
