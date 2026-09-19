/**
 * What a deployment gets when nobody sets FEATURE_FLAGS.
 *
 * The flags existed so unproven work could ship dark. Now that these features
 * are released, the repository decides — a push is the release. The variable
 * remains the way to switch something off, including everything.
 */
import { describe, expect, it, beforeEach, jest } from '@jest/globals';

const load = async (value) => {
  jest.resetModules();
  if (value === undefined) delete process.env.FEATURE_FLAGS;
  else process.env.FEATURE_FLAGS = value;
  return import(`../src/config/features.js?${Math.random()}`);
};

beforeEach(() => { delete process.env.FEATURE_FLAGS; });

describe('the default set', () => {
  it('turns every released feature on when the variable is unset', async () => {
    const { enabledFeatures, DEFAULT_FEATURES } = await load(undefined);
    expect(enabledFeatures()).toEqual(DEFAULT_FEATURES.split(',').sort());
  });

  it('is exactly the five released features', async () => {
    const { DEFAULT_FEATURES, FEATURES } = await load(undefined);
    expect(DEFAULT_FEATURES.split(',').sort()).toEqual(Object.values(FEATURES).sort());
  });

  it('is overridden by a shorter list', async () => {
    const { enabledFeatures } = await load('voice_intake');
    expect(enabledFeatures()).toEqual(['voice_intake']);
  });

  it('is turned off entirely by an empty string — the checkpoint behaviour', async () => {
    const { enabledFeatures } = await load('');
    expect(enabledFeatures()).toEqual([]);
  });
});
