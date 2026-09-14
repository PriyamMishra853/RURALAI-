/**
 * Build `locales/en.json` from the source.
 *
 * Every translatable string in this app is written at its call site as
 * `t('some.key', 'The English text')`. That is deliberate — it keeps the JSX
 * readable and it guarantees a key nobody has translated still renders a real
 * sentence — but it also means the English catalogue is derivable rather than
 * maintained by hand. This script derives it.
 *
 *   node scripts/i18n-extract.mjs          # rewrite locales/en.json
 *   node scripts/i18n-extract.mjs --check  # fail if it is out of date
 *   node scripts/i18n-extract.mjs --soft   # rewrite, never exit non-zero
 *
 * `--soft` is what the production build runs. It regenerates the catalogue so
 * that what ships always matches the source that shipped with it, and reports
 * anything wrong without failing the deploy.
 *
 * That is deliberate. A stale catalogue, a duplicated key or a key written in
 * a form this script cannot see are all bookkeeping mistakes the running app
 * already survives — every call site carries its own English fallback, so the
 * worst case is a string that renders in English. Blocking a deploy over one
 * would take a working clinical system offline to fix something cosmetic.
 * `--check` stays strict for CI and pre-commit, where failing is free.
 *
 * ── Three ways a key is written, and all three are read ─────────────────────
 *
 *   1. At a call site:      t('nav.queue', 'Review Queue')
 *   2. As adjacent data:    ['decision.prescribe', 'Prescription issued']
 *   3. As named fields:     { labelKey: 'choose.refer', label: 'Refer to hospital' }
 *
 * Forms 2 and 3 exist because several tables here pair a key with its English
 * inside a data structure rather than at the point of render. An earlier
 * version of this script only understood form 1, and quietly missed 84 keys —
 * every triage decision the doctor picks from, every notification type, every
 * lab flag. They rendered in English in every language and nothing reported it,
 * which is exactly the failure this whole change exists to remove.
 *
 * ── What it still cannot see ────────────────────────────────────────────────
 *
 * Keys assembled at runtime — `t('tier.' + level, level)` — and keys paired
 * with their English positionally across two separate arrays. Those live in
 * DYNAMIC_KEYS below, listed explicitly.
 *
 * ── The backstop ────────────────────────────────────────────────────────────
 *
 * After extraction the script re-scans for anything key-SHAPED in the source
 * and fails if it is not in the output. So a new key written in a fourth form
 * nobody anticipated is a build failure, not a string that is silently English
 * forever.
 *
 * The script never deletes a key it cannot prove is unused — see --check.
 * Removing a key that turns out to be reachable is how a locale loses a string
 * that was already translated.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src');
const EN = path.resolve(SRC, 'i18n/locales/en.json');

/**
 * Keys assembled at runtime, with the English they should render.
 *
 * Grouped by what builds them so it is obvious where to look when one is
 * wrong. The value is what a locale sees if it has not translated the key.
 */
const DYNAMIC_KEYS = {
  // TierSystem.jsx — TIER_META[*].labelKey / headlineKey / blurbKey
  'tier.low': 'Low risk',
  'tier.moderate': 'Moderate risk',
  'tier.high': 'High risk',
  'tier.emergency': 'Emergency',
  'tier.low.headline': 'Protocol care — complete plan issued',
  'tier.moderate.headline': 'Video consultation required',
  'tier.high.headline': 'Urgent doctor review',
  'tier.emergency.headline': 'Refer immediately',
  'tier.low.blurb': 'The assistant can act on this now. Queued for the doctor’s daily review.',
  'tier.moderate.blurb': 'A doctor must see this patient before treatment. Book now or find one available.',
  'tier.high.blurb': 'Escalated to the top of the doctor’s queue. Do not wait for the daily round.',
  'tier.emergency.blurb': 'This case leaves the platform. Issue the referral and arrange transport now.',

  // config/roles.js — ROLE_KEY
  'role.superAdmin': 'Super Administrator',
  'role.stateAdmin': 'State Administrator',
  'role.districtAdmin': 'District Administrator',
  'role.doctor': 'Doctor',
  'role.assistant': 'Clinic Assistant',
  'role.auditor': 'Auditor',
  'role.staff': 'Staff',

  // config/vitals.js — VITAL_FIELDS[*].labelKey
  'vital.temperature': 'Temperature',
  'vital.blood_pressure_systolic': 'Systolic BP',
  'vital.blood_pressure_diastolic': 'Diastolic BP',
  'vital.pulse': 'Pulse',
  'vital.spo2': 'SpO₂',
  'vital.respiratory_rate': 'Respiratory rate',
  'vital.weight': 'Weight',
  'vital.height': 'Height',
  'vital.bpShort': 'BP',
  'vital.rrShort': 'RR',

  // AppShell.jsx / LandingPage.jsx — t('theme.' + choice)
  'theme.light': 'light',
  'theme.dark': 'dark',
  'theme.system': 'system',

  // patientFields.js / UrgentRegistrationModal.jsx — GENDERS[*].key
  'gender.male': 'Male',
  'gender.female': 'Female',
  'gender.other': 'Other',

  // AdminDashboard.jsx — t('admin.scope.' + scope) and t('status.' + u.status)
  'admin.scope.district': 'district',
  'admin.scope.state': 'state',
  'admin.scope.national': 'national',
  'status.active': 'active',
  'status.suspended': 'suspended',

  // Vision severity — t('severity.' + level)
  'severity.low': 'LOW',
  'severity.medium': 'MEDIUM',
  'severity.high': 'HIGH',
  'severity.observed': 'observed',

  // HealthCardScanner / lab interpretation — t('scan.confidence.' + level)
  'scan.confidence.high': 'high',
  'scan.confidence.medium': 'medium',
  'scan.confidence.low': 'low',

  // Document types — t('docType.' + type)
  'docType.prescription': 'Prescription',
  'docType.lab_report': 'Lab report',
  'docType.other': 'Other',

  // Symptom provenance — t('symptomSource.' + source)
  'symptomSource.voice': 'voice',
  'symptomSource.typed': 'typed',
  'symptomSource.ocr': 'OCR',

  // AI next action — t('nextAction.' + action)
  'nextAction.self_care': 'self care',
  'nextAction.teleconsult': 'teleconsult',
  'nextAction.doctor_review': 'doctor review',
  'nextAction.refer_hospital': 'refer hospital',
  'nextAction.emergency_referral': 'emergency referral',

  // Consultation type — t('consultType.' + type)
  'consultType.INSTANT': 'Instant',
  'consultType.SCHEDULED': 'Scheduled',

  // Duration units — assessment page
  'unit.days': 'days',
  'unit.months': 'months',
  'unit.years': 'years',
  'unit.days.one': '{count} day',
  'unit.days.many': '{count} days',
  'unit.months.one': '{count} month',
  'unit.months.many': '{count} months',
  'unit.years.one': '{count} year',
  'unit.years.many': '{count} years',

  // Doctor specialities — t('specialty.<squashed>', doc.specialization).
  // The stored value is the fallback, so an unlisted speciality still renders.
  'specialty.generalphysician': 'General Physician',
  'specialty.generalmedicine': 'General Medicine',
  'specialty.paediatrics': 'Paediatrics',
  'specialty.pediatrics': 'Pediatrics',
  'specialty.obstetricsgynaecology': 'Obstetrics & Gynaecology',
  'specialty.orthopaedics': 'Orthopaedics',
  'specialty.dermatology': 'Dermatology',
  'specialty.cardiology': 'Cardiology',
  'specialty.psychiatry': 'Psychiatry',
  'specialty.ophthalmology': 'Ophthalmology',
  'specialty.ent': 'ENT',
  'specialty.pulmonology': 'Pulmonology',
  'specialty.surgery': 'Surgery',

  // ReferralPanel.jsx — key(name) over the EN table
  'referral.approxMinutes': '~{minutes} min',
  'referral.title': 'Refer to hospital now',
  'referral.confirmFirst': 'Phone before you travel',
  'referral.confirmBody': 'Bed availability is not published live. Call and confirm the hospital can admit this patient before setting off.',
  'referral.call': 'Call 108 — ambulance',
  'referral.directions': 'Start directions',
  'referral.locating': 'Finding your location…',
  'referral.useLocation': 'Use my location for accurate distance',
  'referral.alternatives': 'Other hospitals',
  'referral.straightLine': 'straight-line distance',
  'referral.byRoad': 'by road',
  'referral.fromDistrict': 'Distance measured from your clinic district — location not available',
  'referral.fromGps': 'Distance from your current location',
  'referral.insecure': 'Location needs a secure (https) connection. Open the main site address rather than a preview link.',
  'referral.denied': 'Location permission is blocked for this site. Allow it in your browser settings, or continue with your clinic district.',
  'referral.noFix': 'No location fix yet — showing distance from your clinic district.',
  'referral.noGeo': 'This device cannot report a location — showing distance from your clinic district.',
  'referral.outOfBounds': 'That location reading looked wrong, so your clinic district was used instead.',
  'referral.loadFailed': 'Could not load hospital details. Call 108 for an ambulance.',
  'referral.callHospital': 'Call the hospital',
  'referral.confirmCapacity': 'Call to confirm capacity before travelling',
  'referral.capabilityUnverified': 'Services not verified — ask when you call',
  'referral.capabilityConfirmed': 'Listed for this kind of case',
  'referral.nabh': 'NABH accredited',
  'referral.beds': 'licensed beds',
  'referral.ratingNote': 'Public review score — not a measure of clinical quality',
  'referral.whyFirst': 'Why this one',

  // components/landing/Interactive.jsx — TIERS pairs `outputKeys` with
  // `outputs` positionally, across two arrays, so no pattern can associate
  // them. Declared here instead.
  'landing.tier.low.label': 'Low',
  'landing.tier.low.headline': 'Complete plan, issued on the spot',
  'landing.tier.low.note': 'The assistant can act immediately. A doctor still sees every case, batched rather than as an interruption.',
  'landing.tier.low.out1': 'First aid the assistant performs now',
  'landing.tier.low.out2': 'Medication — from a formulary signed by a registered practitioner',
  'landing.tier.low.out3': 'Precautions, point by point',
  'landing.tier.low.out4': 'Diet guidance where it is relevant',
  'landing.tier.low.out5': 'Queued for the doctor’s daily review',

  'landing.tier.moderate.label': 'Moderate',
  'landing.tier.moderate.headline': 'A doctor sees the patient before treatment',
  'landing.tier.moderate.note': 'No medication is issued at this tier without the consultation. The call is the gate.',
  'landing.tier.moderate.out1': 'First aid the assistant performs now',
  'landing.tier.moderate.out2': 'Video consultation, booked or instant',
  'landing.tier.moderate.out3': 'Doctor chosen by speciality and current load',
  'landing.tier.moderate.out4': 'Precautions, point by point',
  'landing.tier.moderate.out5': 'The doctor’s review returns to the assistant’s screen',

  'landing.tier.high.label': 'High',
  'landing.tier.high.headline': 'Straight to the top of the queue',
  'landing.tier.high.note': 'Escalation is one-way. The rules engine may raise a tier; the language model can never lower one.',
  'landing.tier.high.out1': 'First aid the assistant performs now',
  'landing.tier.high.out2': 'Escalated above every routine case',
  'landing.tier.high.out3': 'Doctor notified in real time, not on the next round',
  'landing.tier.high.out4': 'Precautions, point by point',
  'landing.tier.high.out5': 'Consultation or referral, decided by the doctor',

  'landing.tier.emergency.label': 'Emergency',
  'landing.tier.emergency.headline': 'The case leaves the platform',
  'landing.tier.emergency.note': 'Bed availability is never invented. The screen shows the hospital’s number and says to confirm by phone before transporting.',
  'landing.tier.emergency.out1': 'First aid the assistant performs now',
  'landing.tier.emergency.out2': 'Danger-zone screen — every other option removed',
  'landing.tier.emergency.out3': 'Nearest district hospital by real coordinates',
  'landing.tier.emergency.out4': 'Printable referral, issued instantly',
  'landing.tier.emergency.out5': 'Nothing queued to a doctor — arrange transport',

  /*
   * Counted nouns, one key per number.
   *
   * English forms a plural by appending "s"; most of the languages here do
   * not, and several do not mark a counted noun for plural at all. Two keys
   * let each locale answer in its own grammar instead of having an English
   * rule applied to it.
   */
  'notify.count.photo': '{count} photo',
  'notify.count.photos': '{count} photos',
  'notify.count.doc': '{count} doc',
  'notify.count.docs': '{count} docs',
  'notify.count.medicine': '{count} medicine',
  'notify.count.medicines': '{count} medicines',

  'handoff.vitalsOne': '{count} vitals record',
  'handoff.vitalsMany': '{count} vitals records',
  'handoff.symptomOne': '{count} symptom entry',
  'handoff.symptomMany': '{count} symptom entries',
  'handoff.documentOne': '{count} document',
  'handoff.documentMany': '{count} documents',
  'handoff.photoOne': '{count} wound photo',
  'handoff.photoMany': '{count} wound photos',

  /*
   * Fixed prose the API emits with a key beside it — see serverText() in
   * i18n/serverLabels.js and the note in backend tierWorkflowService.js.
   *
   * These never appear as a t() call in this repo because the key arrives over
   * the wire, so they have to be declared. The English here must stay in step
   * with the English the server sends; it is the same sentence, and the server
   * copy is what a log or an API consumer sees.
   */
  'workflow.low.headline': 'Protocol care — complete plan issued',
  'workflow.low.note': 'Queued for the doctor’s daily review. The assistant may act on this plan now.',
  'workflow.medium.headline': 'Video consultation required before treatment',
  'workflow.medium.note': 'A doctor must see this patient before any treatment is given.',
  'workflow.medium.consultNote': 'The doctor’s review returns to this screen when the call ends.',
  'workflow.high.headline': 'Refer immediately — danger zone',
  'workflow.high.note': 'No doctor queue entry. A referral notice is recorded and the case is closed for offline review.',
  'workflow.medication.referred': 'No medication is issued — this patient is being referred to hospital.',
  'workflow.medication.doctorDecides': 'Medication is prescribed by the doctor after review. None is suggested here.',
  'workflow.routing.general': 'no candidates — general pool',

  // referralService.js — the national emergency lines and the two disclaimers.
  'emergency.108': 'Emergency ambulance (free, 24x7)',
  'emergency.102': 'Maternal & child health ambulance',
  'emergency.104': 'Health helpline / advice',
  'emergency.112': 'National emergency number',
  'referral.capacityInstruction': 'Bed and room availability is not published as a live feed. Call the hospital or 108 to confirm capacity before transporting the patient.',
  'referral.ratingDisclaimer': 'Public review scores are shown only where available and are not a measure of clinical quality.',

  /*
   * backend/src/services/reportPdfService.js — the generated PDF reports.
   *
   * The report renders from THIS catalogue: reportLocale.js reads
   * frontend/src/i18n/locales/<code>.json rather than keeping a second copy of
   * the same words on the server. Two copies of "Vitals recorded" would drift,
   * and on a clinical document that means the printout and the screen
   * disagreeing about what tier a patient is.
   *
   * So the keys live here, get translated by the same script as everything
   * else, and the server reads the result.
   */
  'pdf.aiSummary': 'AI-prepared summary',
  'pdf.alternatives': 'Alternatives: {list}',
  'pdf.availability': 'Available in India from about Rs {price} ({count} products)',
  'pdf.bedAvailability': 'Bed and room availability',
  'pdf.candidateLine': '{disease} — model confidence {pct}%',
  'pdf.candidateSource': 'Source: {source}. Top-5 accuracy {acc} on held-out data.',
  'pdf.candidates': 'Statistical candidates (AI assistance — not a diagnosis)',
  'pdf.chargeConsultation': 'Sub-centre consultation',
  'pdf.chargeNote': 'No charge is payable at the sub-centre. Hospital charges, if any, are billed separately by the receiving facility.',
  'pdf.chargeReferral': 'Referral issue',
  'pdf.chargeTotal': 'Total payable',
  'pdf.charges': 'Charges',
  'pdf.clinicalDeterioration': 'Clinical deterioration',
  'pdf.coordinates': 'Coordinates',
  'pdf.distance': 'Distance',
  'pdf.dose': 'Dose',
  'pdf.emergencyContacts': 'Emergency contacts',
  'pdf.estimatedTravel': 'Estimated travel',
  'pdf.firstAid': 'First aid — to be performed by the clinic assistant',
  'pdf.firstAidBefore': 'First aid given before transfer',
  'pdf.footer': 'AI prepares the case. The doctor makes the medical decision. This document is a demonstration system output and is not a substitute for examination by a registered medical practitioner.',
  'pdf.formularyEntry': 'Formulary entry: {id}',
  'pdf.generated': 'Generated {when}',
  'pdf.hospital': 'Hospital',
  'pdf.kmStraight': '{km} km (straight line)',
  'pdf.noFormularyMatch': 'No formulary entry matched this presentation.',
  'pdf.noMedication': 'No medication is issued for this case.',
  'pdf.notConfirmed': 'NOT CONFIRMED — call before transporting.',
  'pdf.precautionsTransfer': 'Precautions during transfer',
  'pdf.reasonForReferral': 'Reason for referral',
  'pdf.referTo': 'Refer to',
  'pdf.referralTitle': 'Emergency Referral',
  'pdf.route': 'Route',
  'pdf.signatureLine': 'Registered medical practitioner',
  'pdf.summaryTitle': 'Clinical Assessment Summary',
  'pdf.unsignedFormulary': 'WARNING: this formulary is UNSIGNED. These entries have not been reviewed by a registered medical practitioner for this deployment and must not be dispensed.',
  'pdf.urgentBanner': 'URGENT — REFER TO DISTRICT HOSPITAL NOW',
  'pdf.visitCode': 'Visit code',
  'pdf.vitalsRecorded': 'Vitals recorded',

  // AppShell.jsx — NAV_BY_ROLE entries carry the key as data, rendered by
  // t(label, fallback) inside NavLinks. The sidebar is the first thing a
  // signed-in user reads, so these matter more than most.
  'nav.patients': 'Patient Register',
  'nav.register': 'Register Patient',
  'nav.queue': 'Review Queue',
  'nav.admin': 'Administration',
  'nav.audit': 'Audit Trail',
  'auth.signin': 'Staff Sign In',

  // The language gate names itself, so these must exist before anything else.
  'lang.title': 'Choose your language',
  'lang.subtitle': 'You can change this at any time.',
  'lang.continue': 'Continue',
  'lang.search': 'Search languages',
  'lang.unreviewed': 'This translation has not yet been checked by a qualified speaker. Clinical wording may be imperfect.',
  'lang.switch': 'Language',
  'lang.unreviewedShort': 'unreviewed'
};

/** Every .js/.jsx file under src, minus the catalogues themselves. */
const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'locales') continue;
      walk(full, out);
    } else if (/\.(js|jsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
};

/**
 * Match `t('key', 'English')` and its aliases.
 *
 * The second argument must be a plain single-quoted string — a template
 * literal or a concatenation is a computed default, and this script has no
 * business guessing at one. Those show up as a warning rather than being
 * silently skipped.
 */
const KEY = "[a-z][A-Za-z0-9]*(?:\\.[A-Za-z0-9_]+)+";
const STR = "(?:[^'\\\\]|\\\\.)*";

/** 1. t('key', 'English') and its aliases. */
const CALL = new RegExp(`\\b(?:t|tr|translate|R)\\(\\s*'(${KEY})'\\s*,\\s*'(${STR})'`, 'g');

/**
 * 2. A key and its English sitting next to each other in a literal:
 *    ['decision.prescribe', 'Prescription issued']
 *    SCHEDULED: ['consult.status.scheduled', 'Scheduled']
 *    ['map.activeNow', 'Active now', 'bg-tier-low']
 *
 * ── The trap this pattern fell into ─────────────────────────────────────────
 *
 * A LIST of keys has exactly the same shape as a key/English pair:
 *
 *     outputKeys: [
 *       'landing.tier.low.out1', 'landing.tier.low.out2', …
 *     ]
 *
 * so the matcher happily recorded out1's English as the literal string
 * "landing.tier.low.out2". Extracted keys override DYNAMIC_KEYS, so that
 * clobbered the correct text, and the landing page rendered a raw dotted key
 * where a bullet should be — the precise failure the fallback design exists to
 * prevent. Eleven keys were wrong before this guard.
 *
 * The discriminator is the second capture. Real English is never shaped like a
 * dotted key, so `isKeyShaped` below rejects the match and the value falls
 * through to DYNAMIC_KEYS, where it is declared properly.
 */
const PAIR = new RegExp(`'(${KEY})'\\s*,\\s*'(${STR})'`, 'g');

/**
 * 3. A key and its English as named fields of one object:
 *    { key: 'notify.scheduled', label: 'Consultation booked' }
 *    { labelKey: 'choose.refer', label: 'Refer to hospital' }
 *    { hintKey: 'choose.refer.hint', hint: 'Escalate to a higher centre' }
 */
const FIELD = new RegExp(
  `(?:key|labelKey|hintKey|blurbKey|headlineKey|noteKey|titleKey|bodyKey)\\s*:\\s*'(${KEY})'`
  + `\\s*,\\s*(?:label|hint|blurb|headline|note|title|body|text|english)\\s*:\\s*'(${STR})'`,
  'g'
);

/** A non-literal default cannot be extracted; it is reported instead. */
const SUSPECT = new RegExp(`\\b(?:t|tr|translate|R)\\(\\s*'(${KEY})'\\s*,\\s*[\`"]`, 'g');

/**
 * Anything key-shaped at all. Used only by the backstop check at the end.
 *
 * Deliberately loose: it is meant to over-match and then be filtered against
 * the namespaces the catalogue actually uses, because a key this script has
 * never heard of is precisely the thing worth failing on.
 */
const ANY_KEY = new RegExp(`'(${KEY})'`, 'g');

const unescape = (s) => s.replace(/\\'/g, "'").replace(/\\\\/g, '\\').replace(/\\n/g, '\n');

/**
 * Does this "English" actually look like another catalogue key?
 *
 * If so it is not a translation, it is the next entry in a list of keys, and
 * accepting it would put a dotted key on a user's screen. See the note on
 * PAIR above.
 */
const isKeyShaped = (value) => new RegExp(`^${KEY}$`).test(value);

const main = () => {
  const check = process.argv.includes('--check');
  const soft = process.argv.includes('--soft');
  const found = {};
  const conflicts = [];
  const suspects = [];

  for (const file of walk(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(SRC, file);

    for (const pattern of [CALL, PAIR, FIELD]) {
      for (const m of text.matchAll(pattern)) {
        const [, key, raw] = m;
        const value = unescape(raw);
        // A list of keys is not a key/English pair — see PAIR above.
        if (isKeyShaped(value)) continue;
        if (found[key] && found[key].value !== value) {
          conflicts.push({ key, a: found[key], b: { value, file: rel } });
        }
        if (!found[key]) found[key] = { value, file: rel };
      }
    }

    for (const m of text.matchAll(SUSPECT)) {
      suspects.push(`${rel}: ${m[1]}`);
    }
  }

  const extracted = Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.value]));
  const merged = { ...DYNAMIC_KEYS, ...extracted };
  const sorted = Object.fromEntries(Object.keys(merged).sort().map((k) => [k, merged[k]]));

  /*
   * A key used with two different English strings is a bug either way: either
   * the same idea is being said two ways, or two different ideas are sharing a
   * key and one of them will be mistranslated. It is worth failing over.
   */
  if (conflicts.length) {
    console.error(`\n${conflicts.length} key(s) used with conflicting English:\n`);
    for (const c of conflicts) {
      console.error(`  ${c.key}`);
      console.error(`    ${c.a.file}: "${c.a.value}"`);
      console.error(`    ${c.b.file}: "${c.b.value}"`);
    }
    if (!soft) process.exit(1);
  }

  if (suspects.length) {
    console.warn(`\n${suspects.length} call(s) with a non-literal default — not extracted:`);
    for (const s of suspects.slice(0, 10)) console.warn(`  ${s}`);
  }

  /*
   * Backstop: every key-shaped literal in the source must be accounted for.
   *
   * Filtered to the namespaces the catalogue actually uses, so a module path
   * or a mime type is not mistaken for a key. Anything left is a string that
   * would render in English in every language with nothing to report it.
   */
  const namespaces = new Set(Object.keys(sorted).map((k) => k.split('.')[0]));
  const unaccounted = new Map();

  for (const file of walk(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(SRC, file);
    for (const m of text.matchAll(ANY_KEY)) {
      const key = m[1];
      if (key in sorted) continue;
      if (!namespaces.has(key.split('.')[0])) continue;
      if (key.includes('/') || /\.(js|jsx|json|pdf|png|jpg)$/.test(key)) continue;
      if (!unaccounted.has(key)) unaccounted.set(key, rel);
    }
  }

  if (unaccounted.size) {
    console.error(`\n${unaccounted.size} key-shaped literal(s) with no English in the catalogue:\n`);
    for (const [key, file] of unaccounted) console.error(`  ${key.padEnd(36)} ${file}`);
    console.error('\nEither write it as t(\'key\', \'English\') / a key+label pair,');
    console.error('or add it to DYNAMIC_KEYS at the top of this script.');
    // In soft mode these still render as their call-site English, so the build
    // continues and the log carries the list.
    if (!soft) process.exit(1);
  }

  /*
   * No catalogue value may itself be a catalogue key.
   *
   * That only happens when something has been mis-parsed, and the symptom is a
   * dotted key rendered to a user in place of a sentence. Cheap to check, and
   * it is exactly the bug that shipped once already.
   */
  const keyShapedValues = Object.entries(sorted).filter(([, v]) => isKeyShaped(v));
  if (keyShapedValues.length) {
    console.error(`\n${keyShapedValues.length} key(s) whose English is itself a key:\n`);
    for (const [k, v] of keyShapedValues) console.error(`  ${k.padEnd(38)} -> ${v}`);
    console.error('\nSomething was mis-parsed. These would render as dotted keys on screen.');
    if (!soft) process.exit(1);
  }

  const before = fs.existsSync(EN) ? JSON.parse(fs.readFileSync(EN, 'utf8')) : {};
  const orphaned = Object.keys(before).filter((k) => !(k in sorted));

  if (check) {
    const same = JSON.stringify(before) === JSON.stringify(sorted);
    if (same) {
      console.log(`en.json is up to date — ${Object.keys(sorted).length} keys.`);
      return 0;
    }
    const added = Object.keys(sorted).filter((k) => !(k in before));
    console.error('en.json is out of date. Run: npm run i18n:extract');
    if (added.length) console.error(`  ${added.length} new key(s): ${added.slice(0, 8).join(', ')}…`);
    if (orphaned.length) console.error(`  ${orphaned.length} orphaned: ${orphaned.slice(0, 8).join(', ')}…`);
    return 1;
  }

  const stale = JSON.stringify(before) !== JSON.stringify(sorted);
  if (soft && stale) {
    const added = Object.keys(sorted).filter((k) => !(k in before));
    console.warn(`\nen.json was out of date and has been regenerated for this build.`);
    if (added.length) console.warn(`  ${added.length} key(s) not in the committed file: ${added.slice(0, 8).join(', ')}`);
    console.warn('  Run `npm run i18n:extract` and commit, or those keys ship untranslated.\n');
  }

  fs.writeFileSync(EN, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
  console.log(`en.json: ${Object.keys(sorted).length} keys`
    + ` (${Object.keys(extracted).length} extracted, ${Object.keys(DYNAMIC_KEYS).length} declared dynamic)`);
  if (orphaned.length) {
    // Reported, never removed automatically — see the header.
    console.log(`  ${orphaned.length} key(s) no longer referenced: ${orphaned.join(', ')}`);
  }
  return 0;
};

process.exit(main());
