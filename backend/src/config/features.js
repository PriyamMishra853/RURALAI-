/**
 * Feature flags — every new capability ships switched off.
 *
 * The platform is being extended while a checkpoint of it is being
 * demonstrated. Those two facts only coexist if new behaviour stays invisible
 * until somebody deliberately turns it on: a current build with no flags set
 * behaves like the checkpoint, and a flag can be switched off again without a
 * redeploy of different code.
 *
 * Set on the server as a comma-separated list:
 *
 *   FEATURE_FLAGS=doctor_referral,baseline_metrics
 *
 * An unknown name is ignored with a warning rather than enabling anything. A
 * typo must never be the way a clinical feature reaches production — and it
 * must not silently fail either, which is why it is logged.
 *
 * A route behind a disabled flag answers 404, as if it did not exist. That is
 * what the checkpoint would answer, so a client written against either build
 * sees the same thing.
 */

export const FEATURES = {
  /** Phase 0 — outcome measurements for administrators. */
  BASELINE_METRICS: 'baseline_metrics',
  /** Phase 1 — F1, a doctor referring a case to another doctor. */
  DOCTOR_REFERRAL: 'doctor_referral',
  /** Phase 2 — F2, CHATBOX voice intake. */
  VOICE_INTAKE: 'voice_intake',
  /** Phase 1 — closed-loop hospital referral and the hospital acknowledgement link. */
  REFERRAL_TRACKING: 'referral_tracking',
  FOLLOW_UP_TRACKING: 'follow_up_tracking'
};

const KNOWN = new Set(Object.values(FEATURES));

export const parseFlags = (raw) => {
  const enabled = new Set();
  for (const name of String(raw || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    if (KNOWN.has(name)) enabled.add(name);
    else console.warn(`FEATURE_FLAGS: unknown feature "${name}" ignored. Known: ${[...KNOWN].join(', ')}`);
  }
  return enabled;
};

let enabled = parseFlags(process.env.FEATURE_FLAGS);

export const isEnabled = (flag) => enabled.has(flag);

export const enabledFeatures = () => [...enabled].sort();

/** Route guard: a disabled feature's endpoints do not exist. */
export const requireFeature = (flag) => (req, res, next) =>
  (isEnabled(flag) ? next() : res.status(404).json({ error: 'Not found.' }));

/** Tests only. Production reads FEATURE_FLAGS once, at boot. */
export const setFlagsForTest = (raw) => { enabled = parseFlags(raw); };
