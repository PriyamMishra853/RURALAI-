import PDFDocument from 'pdfkit';
import { ageFromDob } from './patientFields.js';
import { reportLocale } from './reportLocale.js';

/**
 * Server-side PDF generation — spec §3.6 ("button to get hardcopy instantly").
 *
 * Rendered with pdfkit rather than `window.print()` for three reasons that
 * matter in this setting:
 *   - identical output on every device, including the Android tablets a
 *     sub-centre actually uses, where print CSS support is unreliable
 *   - the file can be attached to the record, not just sent to a printer
 *   - no headless browser dependency, so it runs on a small Railway dyno
 *
 * Three templates:
 *   summary       clinical summary — every tier
 *   prescription  LOW only, and only for formulary-signed medication
 *   referral      HIGH only — the danger-zone referral and bill
 *
 * ── Language ────────────────────────────────────────────────────────────────
 *
 * Every template takes a locale object `L` — `L.t()` for the words, `L.fonts`
 * for a typeface that can actually draw them. It is threaded through every
 * helper explicitly rather than held in a module variable: module state would
 * work today, because this render path is synchronous, and would break the
 * first time somebody added an `await` inside it. The failure mode there is
 * one patient's referral sheet rendered in another patient's language, which
 * is not a bug worth leaving available.
 *
 * A PDF carries its own fonts and pdfkit's built-ins cover no Indic script, so
 * `reportLocale` falls back to English when the font for a script is not
 * installed — and the document says so rather than printing empty boxes. See
 * reportLocale.js.
 *
 * What is NOT translated, on any of these: drug names, doses, units, the
 * Aadhaar number, coordinates, the visit code, and the rupee amounts. Those are
 * identifiers and measurements.
 */

const NAVY = '#0B3C78';
const INK = '#0F2037';
const MUTED = '#52647C';
const RULE = '#DFE6EF';
const TIER_COLOUR = { LOW: '#15803D', MEDIUM: '#B45309', HIGH: '#BE123C' };

const mask = (aadhaar) => {
  const d = String(aadhaar || '').replace(/\D/g, '');
  return d.length === 12 ? `XXXX XXXX ${d.slice(-4)}` : '—';
};

/**
 * Dates in the reader's locale, still in Indian order and time zone.
 *
 * The tag falls back to en-IN for the many codes here that have no CLDR data —
 * a thrown formatter mid-render would abort a referral sheet.
 */
const fmtDate = (d = new Date(), L = null) => {
  const tag = L && L.code !== 'en' ? `${L.code}-IN` : 'en-IN';
  const opts = { dateStyle: 'medium', timeStyle: 'short' };
  try {
    return new Date(d).toLocaleString(tag, opts);
  } catch {
    return new Date(d).toLocaleString('en-IN', opts);
  }
};

/* ------------------------------------------------------------------ chrome */

function header(doc, L, title, tier) {
  // Tricolour rule — the same government-service device the UI uses.
  const w = doc.page.width - 80;
  doc.rect(40, 34, w / 3, 3).fill('#F39211');
  doc.rect(40 + w / 3, 34, w / 3, 3).fill('#FFFFFF');
  doc.rect(40 + (2 * w) / 3, 34, w / 3, 3).fill('#15803D');

  doc.fillColor(NAVY).font(L.fonts.bold).fontSize(15)
    .text(L.t('app.name', 'Rural Health Grid'), 40, 48);
  doc.fillColor(MUTED).font(L.fonts.regular).fontSize(8)
    .text(`${L.t('app.subtitle', 'Village Tele-Clinic Network')}  ·  Uttar Pradesh`, 40, 66);

  doc.fillColor(INK).font(L.fonts.bold).fontSize(12)
    .text(title, 40, 86);

  if (tier) {
    const colour = TIER_COLOUR[tier] || MUTED;
    // The tier NAME is translated; the tier itself stays the same colour and
    // the same enum everywhere else in the system.
    const label = L.t(`tier.${String(tier).toLowerCase()}`, `${tier} RISK`).toUpperCase();
    const tw = doc.widthOfString(label, { font: L.fonts.bold, size: 8 }) + 14;
    doc.roundedRect(doc.page.width - 40 - tw, 84, tw, 16, 8).fill(colour);
    doc.fillColor('#FFFFFF').font(L.fonts.bold).fontSize(8)
      .text(label, doc.page.width - 40 - tw, 89, { width: tw, align: 'center' });
  }

  doc.moveTo(40, 108).lineTo(doc.page.width - 40, 108).strokeColor(RULE).lineWidth(1).stroke();
  doc.y = 120;
}

function sectionTitle(doc, L, text) {
  if (doc.y > doc.page.height - 120) doc.addPage();
  doc.moveDown(0.4);
  doc.fillColor(NAVY).font(L.fonts.bold).fontSize(9).text(text.toUpperCase());
  doc.moveTo(40, doc.y + 2).lineTo(doc.page.width - 40, doc.y + 2)
    .strokeColor(RULE).lineWidth(0.5).stroke();
  doc.moveDown(0.5);
}

function keyValues(doc, L, pairs) {
  doc.font(L.fonts.regular).fontSize(9);
  const colWidth = (doc.page.width - 80) / 2;
  let col = 0;
  let rowY = doc.y;

  for (const [k, v] of pairs) {
    if (v === null || v === undefined || v === '') continue;
    const x = 40 + col * colWidth;
    doc.fillColor(MUTED).text(`${k}`, x, rowY, { width: colWidth - 10, continued: false });
    doc.fillColor(INK).font(L.fonts.bold).text(String(v), x, doc.y, { width: colWidth - 10 });
    doc.font(L.fonts.regular);
    if (col === 1) { rowY = doc.y + 4; col = 0; } else { doc.y = rowY; col = 1; }
  }
  doc.y = rowY + 8;
}

function bullets(doc, L, items, { colour = INK } = {}) {
  doc.font(L.fonts.regular).fontSize(9).fillColor(colour);
  for (const item of items) {
    if (doc.y > doc.page.height - 90) doc.addPage();
    doc.text('•', 44, doc.y, { continued: false, width: 10 });
    doc.text(String(item), 56, doc.y - doc.currentLineHeight(), { width: doc.page.width - 100 });
    doc.moveDown(0.25);
  }
  doc.moveDown(0.4);
}

function footer(doc, L) {
  const y = doc.page.height - 56;
  doc.moveTo(40, y).lineTo(doc.page.width - 40, y).strokeColor(RULE).lineWidth(0.5).stroke();
  doc.fillColor(MUTED).font(L.fonts.regular).fontSize(7)
    .text(
      L.t('pdf.footer', 'AI prepares the case. The doctor makes the medical decision. This document is a demonstration system output and is not a substitute for examination by a registered medical practitioner.'),
      40, y + 6, { width: doc.page.width - 80, align: 'left' }
    );
  doc.text(L.t('pdf.generated', 'Generated {when}', { when: fmtDate(new Date(), L) }),
    40, y + 26, { width: doc.page.width - 80 });

  /*
   * Said on the document, not only in a log.
   *
   * When the font for the requested script is not installed the whole sheet is
   * in English. The health worker handing it over has to know that, or they
   * will give a patient a page nobody in the household can read and assume it
   * was understood.
   */
  if (L.fallback) {
    doc.fillColor(TIER_COLOUR.MEDIUM).fontSize(7)
      .text(
        `This copy is in English: no font for the ${L.fallback.script} script is installed on the server.`,
        40, y + 38, { width: doc.page.width - 80 }
      );
  }
}

function patientBlock(doc, L, patient, visit) {
  const age = ageFromDob(patient?.date_of_birth);
  sectionTitle(doc, L, L.t('common.patient', 'Patient'));
  keyValues(doc, L, [
    [L.t('field.name', 'Name'), patient?.full_name],
    [L.t('field.aadhaar', 'Aadhaar number'), mask(patient?.aadhaar_number)],
    [L.t('field.age', 'Age'), age != null ? L.t('age.years', '{count} years', { count: age }) : null],
    [L.t('field.gender', 'Gender'),
      patient?.gender ? L.t(`gender.${String(patient.gender).toLowerCase()}`, patient.gender) : null],
    [L.t('field.village', 'Village'), patient?.village_line1],
    [L.t('field.phone', 'Phone'), patient?.phone],
    [L.t('pdf.visitCode', 'Visit code'), visit?.visit_code],
    [L.t('chart.col.date', 'Date'), fmtDate(visit?.created_at, L)]
  ]);
}

/* --------------------------------------------------------------- templates */

/** Clinical summary — produced for every tier. */
function renderSummary(doc, L, { patient, visit, assessment, workflow }) {
  header(doc, L, L.t('pdf.summaryTitle', 'Clinical Assessment Summary'), workflow?.tier);
  patientBlock(doc, L, patient, visit);

  sectionTitle(doc, L, L.t('case.chiefComplaint', 'Chief complaint'));
  doc.font(L.fonts.regular).fontSize(9).fillColor(INK)
    .text(visit?.chief_complaint || L.t('common.notRecorded', 'Not recorded'), { width: doc.page.width - 80 });
  if (visit?.symptom_duration) {
    doc.fillColor(MUTED).fontSize(8)
      .text(`${L.t('assess.duration', 'Symptom duration')}: ${visit.symptom_duration}`);
  }
  doc.moveDown(0.5);

  const v = Array.isArray(visit?.visit_vitals) ? visit.visit_vitals[0] : visit?.visit_vitals;
  if (v) {
    // Field names translate; the units do not. °F and mmHg are international
    // notation and a localised unit on a clinical record is a misreading.
    sectionTitle(doc, L, L.t('pdf.vitalsRecorded', 'Vitals recorded'));
    keyValues(doc, L, [
      [L.t('vital.temperature', 'Temperature'), v.temperature_f ? `${v.temperature_f} °F` : null],
      [L.t('print.bloodPressure', 'Blood pressure'), v.blood_pressure_systolic ? `${v.blood_pressure_systolic}/${v.blood_pressure_diastolic} mmHg` : null],
      [L.t('vital.pulse', 'Pulse'), v.pulse_bpm ? `${v.pulse_bpm} bpm` : null],
      [L.t('vital.spo2', 'SpO₂'), v.spo2_percent ? `${v.spo2_percent} %` : null],
      [L.t('vital.respiratory_rate', 'Respiratory rate'), v.respiratory_rate ? `${v.respiratory_rate} /min` : null]
    ]);
  }

  if (assessment?.patient_summary) {
    // The summary itself was generated in the requested language by the
    // orchestrator — see languageDirective there. Nothing to translate here.
    sectionTitle(doc, L, L.t('pdf.aiSummary', 'AI-prepared summary'));
    doc.font(L.fonts.regular).fontSize(9).fillColor(INK)
      .text(assessment.patient_summary, { width: doc.page.width - 80 });
    doc.moveDown(0.5);
  }

  // Statistical evidence is shown as its own block, clearly labelled — the
  // same separation the UI keeps between AI assistance and clinical decision.
  const dc = assessment?.disease_candidates;
  if (dc?.candidates?.length) {
    sectionTitle(doc, L, L.t('pdf.candidates', 'Statistical candidates (AI assistance — not a diagnosis)'));
    // Disease names stay as the model emitted them: they are clinical
    // vocabulary the receiving doctor has to recognise.
    bullets(doc, L, dc.candidates.map((c) =>
      L.t('pdf.candidateLine', '{disease} — model confidence {pct}%', {
        disease: c.disease, pct: (c.confidence * 100).toFixed(1)
      })));
    doc.fillColor(MUTED).fontSize(7)
      .text(L.t('pdf.candidateSource', 'Source: {source}. Top-5 accuracy {acc} on held-out data.', {
        source: dc.source, acc: dc.top5_accuracy ?? '—'
      }), { width: doc.page.width - 80 });
    doc.moveDown(0.4);
  }

  if (workflow?.first_aid?.length) {
    sectionTitle(doc, L, L.t('pdf.firstAid', 'First aid — to be performed by the clinic assistant'));
    bullets(doc, L, workflow.first_aid);
  }

  if (workflow?.precautions?.items?.length) {
    sectionTitle(doc, L, L.t('section.precautions', 'Precautions'));
    bullets(doc, L, workflow.precautions.items);
  }

  if (workflow?.diet?.length) {
    sectionTitle(doc, L, L.t('section.diet', 'Diet guidance'));
    bullets(doc, L, workflow.diet);
  }

  footer(doc, L);
}

/** Prescription — LOW only, formulary-signed medication only. */
function renderPrescription(doc, L, { patient, visit, workflow }) {
  header(doc, L, L.t('report.prescription', 'Medication advice'), workflow?.tier);
  patientBlock(doc, L, patient, visit);

  sectionTitle(doc, L, L.t('section.medication', 'Medication'));

  const med = workflow?.medication;
  if (!med?.emitted || !med.items?.length) {
    doc.font(L.fonts.bold).fontSize(9).fillColor(TIER_COLOUR.HIGH)
      .text(L.t('pdf.noMedication', 'No medication is issued for this case.'), { width: doc.page.width - 80 });
    // `reason_key` comes from tierWorkflowService; the English is the fallback.
    doc.font(L.fonts.regular).fontSize(9).fillColor(INK).moveDown(0.3)
      .text(
        med?.reason_key
          ? L.t(med.reason_key, med.reason)
          : med?.reason || L.t('pdf.noFormularyMatch', 'No formulary entry matched this presentation.'),
        { width: doc.page.width - 80 }
      );
  } else {
    for (const item of med.items) {
      if (doc.y > doc.page.height - 140) doc.addPage();
      // The drug name, the dose and the frequency are printed exactly as the
      // formulary holds them. A translated or transliterated drug name is one
      // a pharmacist may not recognise, and a translated dose is a dosing
      // error. Only the field labels move.
      doc.font(L.fonts.bold).fontSize(10).fillColor(INK).text(item.drug || item.name);
      doc.font(L.fonts.regular).fontSize(9).fillColor(MUTED);
      if (item.dose) doc.text(`${L.t('pdf.dose', 'Dose')}: ${item.dose}`);
      if (item.frequency) doc.text(`${L.t('field.frequency', 'Frequency')}: ${item.frequency}`);
      if (item.duration) doc.text(`${L.t('field.duration', 'Duration')}: ${item.duration}`);
      if (item.route) doc.text(`${L.t('pdf.route', 'Route')}: ${item.route}`);
      if (item.availability?.cheapest_inr != null) {
        doc.text(L.t('pdf.availability', 'Available in India from about Rs {price} ({count} products)', {
          price: item.availability.cheapest_inr, count: item.availability.products
        }));
      }
      if (item.rule_source_id) {
        doc.fontSize(7).text(L.t('pdf.formularyEntry', 'Formulary entry: {id}', { id: item.rule_source_id }));
      }
      doc.moveDown(0.5);
    }

    // The signature gate is the whole safety argument for this page, so it is
    // printed on it rather than assumed.
    if (med.signature_status && med.signature_status !== 'SIGNED') {
      doc.moveDown(0.3);
      doc.font(L.fonts.bold).fontSize(8).fillColor(TIER_COLOUR.HIGH)
        .text(
          L.t('pdf.unsignedFormulary', 'WARNING: this formulary is UNSIGNED. These entries have not been reviewed by a registered medical practitioner for this deployment and must not be dispensed.'),
          { width: doc.page.width - 80 }
        );
    }
  }

  doc.moveDown(1);
  doc.moveTo(doc.page.width - 220, doc.y).lineTo(doc.page.width - 40, doc.y)
    .strokeColor(RULE).stroke();
  doc.fillColor(MUTED).font(L.fonts.regular).fontSize(8)
    .text(L.t('pdf.signatureLine', 'Registered medical practitioner'),
      doc.page.width - 220, doc.y + 4, { width: 180, align: 'center' });

  footer(doc, L);
}

/** Referral and bill — HIGH only. The danger-zone hardcopy. */
function renderReferral(doc, L, { patient, visit, assessment, workflow }) {
  header(doc, L, L.t('pdf.referralTitle', 'Emergency Referral'), 'HIGH');

  // A red band, because this sheet travels with the patient and needs to be
  // identifiable at a glance in a hospital reception queue.
  doc.rect(40, doc.y, doc.page.width - 80, 26).fill(TIER_COLOUR.HIGH);
  doc.fillColor('#FFFFFF').font(L.fonts.bold).fontSize(11)
    .text(L.t('pdf.urgentBanner', 'URGENT — REFER TO DISTRICT HOSPITAL NOW'), 40, doc.y - 19, {
      width: doc.page.width - 80, align: 'center'
    });
  doc.y += 16;
  doc.fillColor(INK);

  patientBlock(doc, L, patient, visit);

  sectionTitle(doc, L, L.t('pdf.reasonForReferral', 'Reason for referral'));
  doc.font(L.fonts.regular).fontSize(9).fillColor(INK)
    .text(
      assessment?.patient_summary
      || visit?.chief_complaint
      || L.t('pdf.clinicalDeterioration', 'Clinical deterioration'),
      { width: doc.page.width - 80 }
    );
  doc.moveDown(0.5);

  const ref = workflow?.referral;
  const primary = ref?.primary;
  if (primary) {
    sectionTitle(doc, L, L.t('pdf.referTo', 'Refer to'));
    keyValues(doc, L, [
      [L.t('pdf.hospital', 'Hospital'), primary.name],
      [L.t('field.district', 'District'), primary.district],
      [L.t('pdf.distance', 'Distance'), primary.road_distance_km
        ? L.t('referral.kmByRoad', '{km} km by road', { km: primary.road_distance_km })
        : primary.straight_line_km != null
          ? L.t('pdf.kmStraight', '{km} km (straight line)', { km: primary.straight_line_km })
          : null],
      [L.t('pdf.estimatedTravel', 'Estimated travel'), primary.driving_time_text],
      // Coordinates are machine-readable and are never localised.
      [L.t('pdf.coordinates', 'Coordinates'), `${primary.lat}, ${primary.lon}`]
    ]);

    if (ref.alternatives?.length) {
      doc.fillColor(MUTED).font(L.fonts.regular).fontSize(8)
        .text(L.t('pdf.alternatives', 'Alternatives: {list}', {
          list: ref.alternatives.map((a) => `${a.name} (${a.straight_line_km} km)`).join('  ·  ')
        }), { width: doc.page.width - 80 });
      doc.moveDown(0.4);
    }
  }

  sectionTitle(doc, L, L.t('pdf.emergencyContacts', 'Emergency contacts'));
  bullets(doc, L, (ref?.emergency_lines || [{ number: '108', label_key: 'emergency.108', label: 'Emergency ambulance' }])
    .map((l) => `${l.number} — ${l.label_key ? L.t(l.label_key, l.label) : l.label}`));

  // Stated plainly on the printed sheet. There is no public live bed feed for
  // UP district hospitals, and a fabricated capacity number on a referral is
  // the single most dangerous thing this system could print.
  sectionTitle(doc, L, L.t('pdf.bedAvailability', 'Bed and room availability'));
  doc.font(L.fonts.bold).fontSize(9).fillColor(TIER_COLOUR.HIGH)
    .text(L.t('pdf.notConfirmed', 'NOT CONFIRMED — call before transporting.'), { width: doc.page.width - 80 });
  doc.font(L.fonts.regular).fontSize(8.5).fillColor(INK).moveDown(0.2)
    .text(
      L.t(
        ref?.capacity_instruction_key || 'referral.capacityInstruction',
        ref?.capacity_instruction
        || 'Bed and room availability is not published as a live feed. Call the hospital or 108 to confirm capacity before moving the patient.'
      ),
      { width: doc.page.width - 80 }
    );
  doc.moveDown(0.5);

  if (workflow?.first_aid?.length) {
    sectionTitle(doc, L, L.t('pdf.firstAidBefore', 'First aid given before transfer'));
    bullets(doc, L, workflow.first_aid);
  }

  if (workflow?.precautions?.items?.length) {
    sectionTitle(doc, L, L.t('pdf.precautionsTransfer', 'Precautions during transfer'));
    bullets(doc, L, workflow.precautions.items);
  }

  // Charges. A village sub-centre referral under public health schemes carries
  // no consultation fee; printing the zero explicitly stops anyone charging.
  sectionTitle(doc, L, L.t('pdf.charges', 'Charges'));
  keyValues(doc, L, [
    [L.t('pdf.chargeConsultation', 'Sub-centre consultation'), 'Rs 0.00'],
    [L.t('notify.aiAssessment', 'AI assessment'), 'Rs 0.00'],
    [L.t('pdf.chargeReferral', 'Referral issue'), 'Rs 0.00'],
    [L.t('pdf.chargeTotal', 'Total payable'), 'Rs 0.00']
  ]);
  doc.fillColor(MUTED).font(L.fonts.regular).fontSize(7.5)
    .text(L.t('pdf.chargeNote', 'No charge is payable at the sub-centre. Hospital charges, if any, are billed separately by the receiving facility.'),
      { width: doc.page.width - 80 });

  doc.moveDown(1.2);
  doc.moveTo(40, doc.y).lineTo(220, doc.y).strokeColor(RULE).stroke();
  doc.fillColor(MUTED).fontSize(8)
    .text(L.t('role.assistant', 'Clinic Assistant'), 40, doc.y + 4, { width: 180 });

  footer(doc, L);
}

/* ------------------------------------------------------------------ public */

const TEMPLATES = {
  summary: renderSummary,
  prescription: renderPrescription,
  referral: renderReferral
};

/**
 * Render a report to a PDF stream.
 *
 * @param {'summary'|'prescription'|'referral'} type
 * @param {object} data      { patient, visit, assessment, workflow }
 * @param {string} [language] the language code to render in; unknown or
 *                            unsupported falls back to English and the
 *                            document says so.
 * @returns {PDFDocument} a readable stream the route pipes to the response
 */
export const renderReport = (type, data, language = 'en') => {
  const render = TEMPLATES[type];
  if (!render) throw new Error(`Unknown report type: ${type}`);

  const L = reportLocale(language);
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });

  // Fonts must be registered on the document before anything draws with them.
  L.register(doc);

  render(doc, L, data);
  doc.end();
  return doc;
};

export const REPORT_TYPES = Object.keys(TEMPLATES);
