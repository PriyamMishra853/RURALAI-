# Internationalisation

How the language choice reaches every part of this system, and where the
boundaries are.

## The rule

**One choice, everywhere.** A health worker picks a language once, on the gate
that appears before anything else, and from that point every screen, every
button, every validation message, every notification, the AI's prose, the
emergency referral panel and the PDF the patient carries home are in that
language.

The one exception is deliberate and is listed under *What is never translated*.

## Where it lives

```
frontend/src/i18n/
  index.jsx          the provider, t(), formatNumber, formatDate
  languages.js       the 32 offered languages, and intlTag()
  speech.js          which voice reads which language aloud
  plain.js           a translator for code that is not a component
  serverLabels.js    server enums and key/English pairs, rendered client-side
  locales/*.json     one file per language, lazily imported

frontend/scripts/
  i18n-extract.mjs   derives locales/en.json from the source
  i18n-translate.mjs fills the missing strings per locale, using a model
  i18n-status.mjs    coverage report

backend/src/config/languages.js     the same 32 languages, server-side
backend/src/services/reportLocale.js  fonts + catalogue for the PDF reports
backend/assets/fonts/README.md      which font files to install, and why
```

## Using it

```jsx
const t = useT();
<button>{t('common.save', 'Save')}</button>
```

The English lives at the call site. That is not redundancy — it is what makes
partial coverage safe to ship. A key nobody has translated renders a real
sentence rather than `common.save`, and on a clinical screen a raw key is not
a degraded experience, it is an unusable one.

The fallback chain is: **chosen language → English → the call site's default →
the key.**

For numbers and dates, use the formatters rather than `toLocaleString`:

```jsx
const { formatNumber, formatDate } = useI18n();
formatNumber(1880)                              // grouped for the reader's locale
formatDate(row.created_at, { dateStyle: 'medium' })
```

For code that is not a component — validators, formatters in `config/` — take
`t` as a trailing argument defaulting to `plainT`:

```js
export const validatePatient = (form, t = plainT) => { … };
```

A component passes the real translator and gets translated messages; a test
passes nothing and gets exactly the English it got before.

## The workflow

```bash
npm run i18n:extract     # rebuild locales/en.json from the source
npm run i18n:check       # fail if en.json is out of date (CI)
npm run i18n:status      # coverage per locale, worst first
npm run i18n:translate -- --all      # fill the gaps with a model
npm run i18n:translate -- --lang ta  # one language
```

`en.json` is **derived, never edited by hand**. Add a string by writing
`t('some.key', 'Some text')` and re-running extract.

The extractor reads three forms — a `t()` call, a key/English pair in a
literal, and `key`+`label` fields of one object — and then re-scans for
anything key-shaped it could not account for and **fails**. A key written in a
form nobody anticipated is a build error, not a string that is silently English
forever. Keys assembled at runtime (`t('tier.' + level, level)`) are declared in
`DYNAMIC_KEYS` at the top of the script.

### Translation

`i18n:translate` uses the Groq/Gemini keys this project already has. It is a
build-time script whose output is committed, rather than a runtime service,
for three reasons:

- **It is used where the network is worst.** A sub-centre on a weak link should
  not need a round trip to a model before it can render a button. The output is
  a 1–3 KB JSON chunk in the bundle, and it works with no connection at all.
- **It has to be reviewable.** A mistranslated triage tier changes what a health
  worker does with a dying patient. A file in the repository can be read by a
  speaker, corrected, and diffed. Text generated per page load cannot.
- **It has to be stable.** Two health workers comparing screens must not see
  different wording for the same tier.

It never overwrites an existing string without `--force` — some were written by
hand — and it rejects any output that dropped a `{placeholder}` rather than
shipping a sentence with a hole in it.

**Machine translation never sets `reviewed: true`.** That flag in
`languages.js` means a qualified speaker has checked the clinical strings, and
the language gate tells users which locales that applies to. Keep it honest.

## The server side

Every request carries `X-Language`, set once in the axios interceptor so no
call site can forget it. The server acts on it in three places.

**AI assessment.** `aiOrchestrator.js` appends a directive naming exactly which
fields move (the summary, first-aid steps, warnings) and which stay English
because they are machine-read (`risk_level`, `recommended_next_action`, and a
cited protocol's title/source/version). Every tier-dependent field is
re-derived afterwards, so a model that ignores the instruction degrades to
"could not raise the tier" rather than to a mis-triaged case. The rule engine's
inputs are untouched.

**Fixed server prose.** The tier workflow's headlines and notes, the referral
capacity instruction and the emergency-line labels are enumerable, so they are
emitted as `<field>` (English, unchanged on the wire) plus `<field>_key`. The
browser renders them with `serverText(t, obj, 'field')` from the catalogue it
already has — no model call, no latency, correct offline.

**PDF reports.** `reportLocale.js` reads the *same* catalogue the browser does,
rather than keeping a second copy of the same words that would drift.

A PDF carries its own fonts, and pdfkit's built-ins draw no Indic script — a
Devanagari report rendered with Helvetica is a page of empty boxes, silently.
So `reportLocale` looks for a Noto face for the script; when it is missing the
report renders in English **and prints a line saying why**. A health worker must
never hand over a sheet the household cannot read while believing otherwise.

```bash
cd backend && npm run check:fonts       # which languages can be printed
cd backend && npm run check:languages   # server and client lists agree
```

Devanagari is the highest-value single font: one face covers fourteen of the
offered languages.

## What is never translated

These stay as they are on every surface, including the PDF the patient takes
home. Each has a reason that is not stylistic:

| Kind | Examples | Why |
| --- | --- | --- |
| Enums on the wire | `SCHEDULED`, `HIGH`, `prescribe` | Compared in code, stored in Postgres, matched in tests, read in a log at 2am |
| Drug names and doses | `Paracetamol 500 mg`, `1-0-1` | A transliterated drug name is one a pharmacist may not recognise; a translated dose is a dosing error |
| Units and notation | `mmHg`, `bpm`, `°F`, `SpO₂`, `%` | International notation; a localised unit beside a clinical number is a misreading waiting to happen |
| Identifiers | Aadhaar number, visit code, coordinates, formulary ids | Machine-readable, and often the thing being looked up |
| Audit log values | `actor_role`, `action`, `entity_type` | The table is exported and quoted in incident reports. An action that reads differently depending on who opened the console is not an audit trail. (Its column *headings* are translated.) |
| Protocol citations | MoHFW title, source, version | A translated citation cannot be looked up |
| Raw diagnostics | Error messages, OCR JSON, DOMException names | Read out to whoever is supporting the user, and searched for |

## Adding a language

1. Add it to `frontend/src/i18n/languages.js` and
   `backend/src/config/languages.js` (`npm run check:languages` enforces that
   both happen).
2. Add its speech tag to `frontend/src/i18n/speech.js` — the nearest voice a
   speaker will actually understand, not the nearest language code.
3. If it uses a new script, add it to `SCRIPT_FONT` in `reportLocale.js` and
   install the font.
4. `npm run i18n:translate -- --lang <code>`.
5. Leave `reviewed: false` until a speaker has checked it.

Nothing else. The locale glob in `index.jsx` picks the new file up, and it
becomes its own lazily-loaded chunk.
