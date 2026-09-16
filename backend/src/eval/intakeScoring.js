/**
 * Scoring the CHATBOX against a fixed set of spoken intakes (Roadmap v3, Phase 2).
 *
 * The phase's exit criterion is that vitals captured by voice are exact-match
 * on a test set. "Close" is not a pass: 140/90 read as 140/80 is a different
 * patient. So a vital either equals what was said or the case fails, and a
 * vital that appears when nobody said one — a fabricated observation — fails
 * the case whatever else it got right.
 *
 * Pure: takes a case and the extraction's `accept`/`vital_errors`, returns
 * checks. The runner (scripts/evalIntakeExtraction.js) does the calling.
 */

export const VITAL_KEYS = [
  'temperature_f', 'blood_pressure_systolic', 'blood_pressure_diastolic',
  'pulse_bpm', 'spo2_percent', 'respiratory_rate', 'blood_glucose_mgdl'
];

const valueOf = (accept, key) => accept?.[key]?.value;

export const scoreCase = (testCase, result) => {
  const accept = result?.accept || {};
  const vitalErrors = result?.vital_errors || [];
  const checks = [];
  const check = (kind, field, expected, got, ok) => checks.push({ kind, field, expected, got, ok });

  const expectedVitals = testCase.vitals || {};
  for (const [key, expected] of Object.entries(expectedVitals)) {
    const got = valueOf(accept, key);
    check('vital', key, expected, got ?? null, got !== undefined && Number(got) === Number(expected));
  }

  // Never said, so never allowed to appear.
  const fabricated = VITAL_KEYS.filter((key) => !(key in expectedVitals) && valueOf(accept, key) !== undefined);
  for (const key of fabricated) check('fabricated', key, null, valueOf(accept, key), false);

  for (const key of testCase.rejected || []) {
    check('rejected', key, 'refused', valueOf(accept, key) ?? null, valueOf(accept, key) === undefined && vitalErrors.length > 0);
  }

  if (testCase.duration !== undefined) {
    const got = valueOf(accept, 'symptom_duration_value') === undefined
      ? null
      : { value: valueOf(accept, 'symptom_duration_value'), unit: valueOf(accept, 'symptom_duration_unit') };
    const expected = testCase.duration;
    const ok = expected === null
      ? got === null
      : got !== null && Number(got.value) === expected.value && got.unit === expected.unit;
    check('duration', 'symptom_duration', expected, got, ok);
  }

  // "a|b" accepts either field: the form puts the complaint and the other
  // symptoms in one box, so the model choosing either is equally right.
  for (const spec of testCase.present || []) {
    const keys = spec.split('|');
    const got = keys.map((key) => valueOf(accept, key)).find((v) => v !== undefined && v !== null && v !== '');
    check('present', spec, 'present', got ?? null, got !== undefined);
  }

  for (const [key, needle] of Object.entries(testCase.contains || {})) {
    const got = valueOf(accept, key);
    check('contains', key, needle, got ?? null, String(got ?? '').toLowerCase().includes(String(needle).toLowerCase()));
  }

  for (const key of testCase.absent || []) {
    const got = valueOf(accept, key);
    check('absent', key, null, got ?? null, got === undefined);
  }

  const vitalChecks = checks.filter((c) => c.kind === 'vital');
  return {
    id: testCase.id,
    lang: testCase.lang,
    pass: checks.every((c) => c.ok),
    checks,
    vitals_expected: vitalChecks.length,
    vitals_exact: vitalChecks.filter((c) => c.ok).length,
    fabricated
  };
};

export const summarise = (scores) => {
  const sum = (key) => scores.reduce((n, s) => n + s[key], 0);
  const expected = sum('vitals_expected');
  const exact = sum('vitals_exact');
  const byLang = {};
  for (const s of scores) {
    byLang[s.lang] = byLang[s.lang] || { cases: 0, passed: 0 };
    byLang[s.lang].cases += 1;
    if (s.pass) byLang[s.lang].passed += 1;
  }
  return {
    cases: scores.length,
    passed: scores.filter((s) => s.pass).length,
    vitals_expected: expected,
    vitals_exact: exact,
    vitals_exact_rate: expected ? Math.round((exact / expected) * 1000) / 1000 : null,
    fabricated_vitals: scores.reduce((n, s) => n + s.fabricated.length, 0),
    by_language: byLang,
    // The exit criterion, stated as a boolean so nobody has to interpret it.
    exit_criterion_met: expected > 0 && exact === expected && scores.every((s) => s.fabricated.length === 0)
  };
};
