/**
 * Speech intake guards.
 *
 * This service previously fabricated clinical data in three places — a fixed
 * Hindi fever/cough/body-pain transcript when transcription produced nothing,
 * the same symptoms as the default `extracted_symptoms`, and again in the
 * outer catch. "fever" plus "cough" is a MEDIUM-tier rule in riskEngine.js, so
 * a silent recording could produce a fully triaged case describing a patient
 * who does not exist.
 *
 * These tests exist so that never comes back.
 */
import { describe, expect, it } from '@jest/globals';
import { isPaddingArtifact, looksHallucinated } from '../src/services/speechService.js';

describe('hallucination patterns', () => {
  it.each([
    'www.pengali.com',
    'https://example.com',
    'Thank you.',
    'Thanks',
    'Thanks for watching!',
    'Please subscribe',
    'Subtitles by the Amara.org community',
    '...',
    '।',
    '   '
  ])('rejects the artifact %p', (text) => {
    expect(looksHallucinated(text)).toBe(true);
  });

  it.each([
    'मुझे तीन दिन से बुखार है',
    'The patient has a cough and fever for two days',
    'Thank you doctor, the pain started yesterday in my chest',
    'chest pain since morning'
  ])('keeps genuine speech %p', (text) => {
    expect(looksHallucinated(text)).toBe(false);
  });

  it('only rejects a bare thanks, not speech containing it', () => {
    expect(looksHallucinated('Thank you.')).toBe(true);
    expect(looksHallucinated('Thank you, my head hurts badly')).toBe(false);
  });
});

describe('padding artifact detection', () => {
  it('flags a segment that runs far past the real audio duration', () => {
    // The observed real case: 1 second of digital silence, transcribed as
    // "Thank you." with no_speech_prob 0 and a segment ending at 29.98.
    expect(
      isPaddingArtifact({
        duration: 1,
        segments: [{ start: 0, end: 29.98, no_speech_prob: 0, text: ' Thank you.' }]
      })
    ).toBe(true);
  });

  it('does not flag genuine short speech', () => {
    expect(
      isPaddingArtifact({
        duration: 1.4,
        segments: [{ start: 0, end: 1.4, no_speech_prob: 0.01, text: 'bukhaar hai' }]
      })
    ).toBe(false);
  });

  it('does not flag a normal full-length recording', () => {
    expect(
      isPaddingArtifact({
        duration: 28,
        segments: [
          { start: 0, end: 14, no_speech_prob: 0.02 },
          { start: 14, end: 27.6, no_speech_prob: 0.03 }
        ]
      })
    ).toBe(false);
  });

  it('is inert when the provider returns no segment data', () => {
    expect(isPaddingArtifact({ duration: 5 })).toBe(false);
    expect(isPaddingArtifact({})).toBe(false);
  });
});
