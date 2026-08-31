/**
 * Risk tier translation.
 *
 * The rule engine tiers a case as LOW / MEDIUM / HIGH. The `risk_level` enum
 * is low / moderate / high / emergency. `/ai/assess` returns the engine's
 * spelling to the browser, so a screen that echoed the assessment's risk back
 * when handing the case over sent "medium" — which the enum does not have.
 *
 * Every MEDIUM case therefore failed the handoff with a 400, and MEDIUM is the
 * most common tier there is. These cases pin the translation so that cannot
 * silently return.
 */
import { describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../src/config/supabase.js', () => ({
  supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }
}));

const { normaliseRiskTier } = await import('../src/controllers/visit.controller.js');

const ENUM_VALUES = ['low', 'moderate', 'high', 'emergency'];

describe('normaliseRiskTier', () => {
  it('translates the rule engine vocabulary to the database enum', () => {
    expect(normaliseRiskTier('LOW')).toBe('low');
    expect(normaliseRiskTier('MEDIUM')).toBe('moderate');
    expect(normaliseRiskTier('HIGH')).toBe('high');
    expect(normaliseRiskTier('EMERGENCY')).toBe('emergency');
  });

  it('maps MEDIUM to moderate — the case that broke every handoff', () => {
    // Guard against anyone "simplifying" this to a lowercase() call.
    expect(normaliseRiskTier('MEDIUM')).toBe('moderate');
    expect(normaliseRiskTier('MEDIUM')).not.toBe('medium');
    expect(ENUM_VALUES).toContain(normaliseRiskTier('MEDIUM'));
  });

  it('passes through values that are already enum values', () => {
    for (const tier of ENUM_VALUES) expect(normaliseRiskTier(tier)).toBe(tier);
  });

  it('is case and whitespace insensitive', () => {
    expect(normaliseRiskTier('  Moderate ')).toBe('moderate');
    expect(normaliseRiskTier('medium')).toBe('moderate');
    expect(normaliseRiskTier('High')).toBe('high');
  });

  it('accepts the synonyms clinical text actually uses', () => {
    expect(normaliseRiskTier('mild')).toBe('low');
    expect(normaliseRiskTier('severe')).toBe('high');
    expect(normaliseRiskTier('critical')).toBe('emergency');
  });

  it('returns null for anything it does not recognise, rather than guessing', () => {
    // A wrong tier is worse than a rejected one: it decides queue order.
    expect(normaliseRiskTier('banana')).toBeNull();
    expect(normaliseRiskTier('')).toBeNull();
    expect(normaliseRiskTier('   ')).toBeNull();
    expect(normaliseRiskTier(null)).toBeNull();
    expect(normaliseRiskTier(undefined)).toBeNull();
  });

  it('only ever returns a value the database enum accepts', () => {
    const inputs = ['LOW', 'MEDIUM', 'HIGH', 'EMERGENCY', 'mild', 'severe', 'critical', 'moderate'];
    for (const input of inputs) expect(ENUM_VALUES).toContain(normaliseRiskTier(input));
  });
});
