/**
 * A translator for code that is not a component.
 *
 * Validation rules, formatters and payload builders live in `config/` as plain
 * functions. They produce text a user reads — "Must be exactly 12 digits." —
 * but they cannot call `useT`, and turning every one of them into a hook would
 * be a large change to code that has nothing to do with rendering.
 *
 * The pattern used instead: each such function takes `t` as its last argument
 * and defaults it to `plainT`. Call sites inside components pass the real `t`
 * and get translated messages; the handful of call sites that do not care —
 * tests, and the payload builders — pass nothing and get exactly the English
 * they got before. No signature breaks, and nothing silently returns a key.
 *
 * This is deliberately the same shape as the real `t`: (key, fallback, vars).
 * That symmetry is what lets a function be written once and work either way.
 */

/** Substitute {name} placeholders. Mirrors the interpolation in index.jsx. */
export const interpolate = (str, vars) => {
  if (!vars) return str;
  let out = str;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(v == null ? '' : String(v));
  }
  return out;
};

/**
 * Ignores the key and renders the English fallback.
 *
 * The fallback is required rather than optional: a caller that passes only a
 * key would render a dotted string to a user, and on a clinical form that is a
 * validation message nobody can act on.
 */
export const plainT = (key, fallback = '', vars = null) => interpolate(fallback || key, vars);
