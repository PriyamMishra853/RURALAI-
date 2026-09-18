/**
 * Weight and height, which the form collected from the beginning and this
 * module used to drop on the floor: there was no column for them until
 * migration 19, so `cleanVitals` never carried them and nothing was stored.
 */
import { describe, expect, it } from '@jest/globals';

const { validateVitalsRanges } = await import('../src/services/vitalsValidation.js');

describe('weight and height', () => {
  it('stores them, under the column names', () => {
    const { isValid, cleanVitals } = validateVitalsRanges({ weight: '62.5', height: '168' });
    expect(isValid).toBe(true);
    expect(cleanVitals.weight_kg).toBe(62.5);
    expect(cleanVitals.height_cm).toBe(168);
  });

  it('leaves them out entirely when they were not measured', () => {
    const { cleanVitals } = validateVitalsRanges({ pulse: '80' });
    expect('weight_kg' in cleanVitals).toBe(false);
    expect('height_cm' in cleanVitals).toBe(false);
  });

  it('refuses an impossible one, with the field named', () => {
    const { isValid, errors } = validateVitalsRanges({ weight: '600', height: '15' });
    expect(isValid).toBe(false);
    expect(errors.join(' ')).toMatch(/Weight 600 kg/);
    expect(errors.join(' ')).toMatch(/Height 15 cm/);
  });
});
