/**
 * The backend is ESM ("type": "module"), so Jest runs through Node's VM modules
 * flag rather than Babel — see the `test` script in package.json.
 *
 * External APIs (Groq, Gemini, Supabase, Qdrant) are never called from this
 * suite. CI must stay free, deterministic, and must not spend AI quota;
 * anything that needs a live provider belongs in a separate check script.
 */
export default {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  transform: {},
  clearMocks: true,
  collectCoverageFrom: ['src/services/**/*.js', 'src/middleware/**/*.js']
};
