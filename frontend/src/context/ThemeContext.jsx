import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

/**
 * Theme: light / dark / system.
 *
 * Three states, not two. "System" is the default because a health worker on a
 * phone at night has already told their OS what they want, and a clinical tool
 * that ignores that is one more thing to fight. An explicit choice overrides it
 * and persists.
 *
 * The class is applied to <html> before React paints (see the inline script in
 * index.html), so there is no white flash on a dark-mode load.
 */

const ThemeContext = createContext(null);
const STORAGE_KEY = 'vvc_theme';

const systemPrefersDark = () =>
  window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;

const resolve = (choice) => (choice === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : choice);

export function ThemeProvider({ children }) {
  const [choice, setChoice] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
    } catch {
      // Private mode or blocked storage — fall back rather than crash.
      return 'system';
    }
  });

  const [resolved, setResolved] = useState(() => resolve(choice));

  useEffect(() => {
    const apply = () => {
      const next = resolve(choice);
      setResolved(next);
      document.documentElement.classList.toggle('dark', next === 'dark');
      document.documentElement.style.colorScheme = next;
    };

    apply();
    try { localStorage.setItem(STORAGE_KEY, choice); } catch { /* non-fatal */ }

    // Follow the OS live, but only while the user has not chosen explicitly.
    if (choice !== 'system') return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [choice]);

  /** Cycle light → dark → system, which is what a single toggle button needs. */
  const cycle = useCallback(() => {
    setChoice((c) => (c === 'light' ? 'dark' : c === 'dark' ? 'system' : 'light'));
  }, []);

  return (
    <ThemeContext.Provider value={{ choice, resolved, setChoice, cycle, isDark: resolved === 'dark' }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
};
