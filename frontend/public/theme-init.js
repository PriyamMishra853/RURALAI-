/*
 * Loaded as a file, not inline, so the content security policy can refuse every
 * inline script without exception. Still a plain blocking script in <head>, so it
 * still runs before first paint.
 */
/**
 * Apply the saved theme before first paint.
 *
 * Without this the page renders light, then React swaps to dark a frame
 * later — a white flash straight into someone's eyes at night, which is
 * exactly when dark mode matters.
 */
(function () {
  try {
    var saved = localStorage.getItem('vvc_theme') || 'system';
    var dark = saved === 'dark' ||
      (saved === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  } catch (e) {
    /* storage blocked; light default is fine */
  }
})();
