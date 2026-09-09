import React, {
  createContext, useContext, useState, useCallback, useEffect, useMemo, useRef
} from 'react';
import {
  LANGUAGES, DEFAULT_LANGUAGE, LANGUAGE_BY_CODE, isRtl, suggestedLanguage, intlTag
} from './languages.js';
import en from './locales/en.json';

/**
 * Translation, centrally.
 *
 * Deliberately not i18next. The app ships three large dependencies already and
 * this needs exactly four things — a key lookup, a fallback chain, a stored
 * preference and lazy loading. A library for that is 40 KB across a rural
 * connection to solve a problem a hundred lines solve, and the brief was
 * explicitly to keep performance unchanged.
 *
 * ── The fallback chain, and why it never shows a key ─────────────────────────
 *
 *   chosen language -> English -> the key's own default -> the key
 *
 * A missing translation renders readable English, never `nav.dashboard`. That
 * matters more here than the usual reason: this is a clinical screen, and a
 * health worker who sees a raw key does not get a degraded experience, they get
 * an unusable one. Partial coverage in a new locale is therefore safe to ship —
 * translated where translated, English where not.
 *
 * ── Why the locales are lazy and English is not ──────────────────────────────
 *
 * English is imported statically because it is the fallback: it has to be in
 * memory before the first render or the whole interface renders raw keys for a
 * frame. Every other locale is a dynamic import, so a Hindi user downloads
 * `en.json` + `hi.json` and none of the other thirty-one. On a slow connection
 * at a sub-centre that difference is most of the page-load budget.
 *
 * While a locale is in flight `t()` answers from English rather than blocking.
 * A brief flash of English beats a blank clinical screen.
 */

const STORAGE_KEY = 'vvc_lang';
const CHOSEN_KEY = 'vvc_lang_chosen';

const I18nContext = createContext(null);

/*
 * Vite resolves this glob at build time into one chunk per locale, so adding
 * `locales/xx.json` is the entire cost of adding a language — no registry to
 * update, nothing to import by hand.
 *
 * English is excluded on purpose. It is imported statically above because it
 * is the fallback and has to be in memory before the first render; leaving it
 * in the glob as well made Vite warn that one module was both statically and
 * dynamically imported, and emit it into the main chunk anyway. Excluding it
 * says the intent outright and keeps the build log clean.
 */
const LOADERS = import.meta.glob(['./locales/*.json', '!./locales/en.json']);

/** Loaded tables, by code. English is present from the first tick. */
const TABLES = { [DEFAULT_LANGUAGE]: en };
/** In-flight loads, so two components mounting at once fetch a locale once. */
const PENDING = {};

const loadLocale = (code) => {
  if (TABLES[code]) return Promise.resolve(TABLES[code]);
  if (PENDING[code]) return PENDING[code];

  const loader = LOADERS[`./locales/${code}.json`];
  if (!loader) {
    // A language listed in languages.js with no catalogue yet. Legitimate:
    // it renders entirely in English until somebody adds the file.
    TABLES[code] = {};
    return Promise.resolve(TABLES[code]);
  }

  PENDING[code] = loader()
    .then((mod) => {
      TABLES[code] = mod.default || mod;
      delete PENDING[code];
      return TABLES[code];
    })
    .catch(() => {
      // A failed chunk fetch must not take the app down; English is right here.
      TABLES[code] = {};
      delete PENDING[code];
      return TABLES[code];
    });

  return PENDING[code];
};

/** Warm a locale without switching to it — used to make the switcher instant. */
export const preloadLocale = loadLocale;

const readStored = () => {
  try {
    const code = localStorage.getItem(STORAGE_KEY);
    return code && LANGUAGE_BY_CODE[code] ? code : null;
  } catch {
    return null;
  }
};

const readChosen = () => {
  try { return localStorage.getItem(CHOSEN_KEY) === 'yes'; } catch { return false; }
};

/** Substitute {name} placeholders. Kept out of `t` so it is testable alone. */
const interpolate = (str, vars) => {
  if (!vars) return str;
  let out = str;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(v == null ? '' : String(v));
  }
  return out;
};

export const I18nProvider = ({ children }) => {
  const [lang, setLang] = useState(() => readStored() || DEFAULT_LANGUAGE);
  // Whether the user has ever made an explicit choice. Drives the first-visit
  // gate, and is separate from `lang` so a stored default is not mistaken for
  // a decision.
  const [chosen, setChosen] = useState(readChosen);
  // Bumped when a locale table arrives. `t` closes over the table, so without
  // this the tree would keep rendering the English it resolved a moment ago.
  const [revision, setRevision] = useState(0);

  const langRef = useRef(lang);
  langRef.current = lang;

  useEffect(() => {
    let cancelled = false;
    loadLocale(lang).then(() => {
      // Ignore a load that finished after the user moved on to another
      // language — otherwise a slow chunk re-renders the app in a language
      // nobody is looking at any more.
      if (!cancelled && langRef.current === lang) setRevision((n) => n + 1);
    });
    return () => { cancelled = true; };
  }, [lang]);

  const choose = useCallback((code) => {
    if (!LANGUAGE_BY_CODE[code]) return;
    setLang(code);
    setChosen(true);
    try {
      localStorage.setItem(STORAGE_KEY, code);
      localStorage.setItem(CHOSEN_KEY, 'yes');
    } catch { /* preference simply will not persist */ }
  }, []);

  /*
   * Tell the document what it is rendering.
   *
   * `lang` lets the browser pick correct fonts and hyphenation for Indic
   * scripts, and lets a screen reader switch voice. `dir` is not cosmetic for
   * Urdu, Kashmiri and Sindhi — without it the whole interface reads backwards.
   */
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = lang;
    document.documentElement.dir = isRtl(lang) ? 'rtl' : 'ltr';
  }, [lang]);

  /*
   * The browser tab, too.
   *
   * index.html carries an English <title> because something has to be there
   * before the bundle loads. Leaving it at that means a health worker with six
   * tabs open picks this one out by an English string on an otherwise
   * translated device — a small thing, and exactly the kind of small thing
   * that adds up to an interface that is only half in your language.
   *
   * Runs after the catalogue lands (hence the revision dependency), so it
   * sets the translated name rather than the English fallback it would see
   * on the first tick.
   */
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const name = TABLES[lang]?.['app.name'] || en['app.name'];
    const tagline = TABLES[lang]?.['app.subtitle'] || en['app.subtitle'];
    if (name && tagline) document.title = name + ' — ' + tagline;
  }, [lang, revision]);

  /**
   * t('some.key', 'English default', { name: 'x' })
   *
   * The English default sits at the call site on purpose. It keeps the JSX
   * readable, and it guarantees that a key nobody has translated yet still
   * renders a real sentence.
   */
  const t = useCallback((key, fallback = '', vars = null) => {
    let out = TABLES[lang]?.[key];
    if (out === undefined && lang !== DEFAULT_LANGUAGE) out = en[key];
    if (out === undefined) out = fallback || key;
    return interpolate(out, vars);
  // `revision` is a genuine dependency: the table `t` reads is filled in
  // asynchronously, so this is what tells React the result changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, revision]);

  /**
   * Numbers in the reader's own numerals where the locale uses them.
   *
   * A chart axis reading "12" beside a caption reading "१२" is exactly the kind
   * of half-translation this change exists to remove. Wrapped in a guard
   * because several of the regional codes here are valid ISO 639-3 but not tags
   * any browser's Intl data knows.
   */
  const formatNumber = useCallback((value, opts) => {
    if (value == null || Number.isNaN(Number(value))) return '';
    try {
      return new Intl.NumberFormat(intlTag(lang), opts).format(Number(value));
    } catch {
      return String(value);
    }
  }, [lang]);

  const formatDate = useCallback((value, opts = { dateStyle: 'medium' }) => {
    if (!value) return '';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    try {
      return new Intl.DateTimeFormat(intlTag(lang), opts).format(d);
    } catch {
      return d.toLocaleString();
    }
  }, [lang]);

  const value = useMemo(() => ({
    lang,
    language: LANGUAGE_BY_CODE[lang] || LANGUAGE_BY_CODE[DEFAULT_LANGUAGE],
    languages: LANGUAGES,
    chosen,
    choose,
    suggested: suggestedLanguage(),
    rtl: isRtl(lang),
    t,
    formatNumber,
    formatDate
  }), [lang, chosen, choose, t, formatNumber, formatDate]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = () => {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
};

/** Shorthand for the common case. */
export const useT = () => useI18n().t;

/**
 * The current language code, readable outside React.
 *
 * `services/api.js` needs it to set Accept-Language on every request, and an
 * axios interceptor is not a component. Reading localStorage keeps that from
 * becoming a second source of truth: the provider writes it on every choice.
 */
export const currentLang = () => readStored() || DEFAULT_LANGUAGE;
