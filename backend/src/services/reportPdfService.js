import PDFDocument from 'pdfkit';
import { ageFromDob } from './patientFields.js';

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

const fmtDate = (d = new Date()) =>
  new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

/* ------------------------------------------------------------------ chrome */

function header(doc, title, tier) {
  // Tricolour rule — the same government-service device the UI uses.
  const w = doc.page.width - 80;
  doc.rect(40, 34, w / 3, 3).fill('#F39211');
  doc.rect(40 + w / 3, 34, w / 3, 3).fill('#FFFFFF');
  doc.rect(40 + (2 * w) / 3, 34, w / 3, 3).fill('#15803D');

  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(15)
    .text('Rural Health Grid', 40, 48);
  doc.fillColor(MUTED).font('Helvetica').fontSize(8)
    .text('Village Tele-Clinic Network  ·  Uttar Pradesh', 40, 66);

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(12)
    .text(title, 40, 86);

  if (tier) {
    const colour = TIER_COLOUR[tier] || MUTED;
    const label = `${tier} RISK`;
    const tw = doc.widthOfString(label, { font: 'Helvetica-Bold', size: 8 }) + 14;
    doc.roundedRect(doc.page.width - 40 - tw, 84, tw, 16, 8).fill(colour);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8)
      .text(label, doc.page.width - 40 - tw, 89, { width: tw, align: 'center' });
  }

  doc.moveTo(40, 108).lineTo(doc.page.width - 40, 108).strokeColor(RULE).lineWidth(1).stroke();
  doc.y = 120;
}

function sectionTitle(doc, text) {
  if (doc.y > doc.page.height - 120) doc.addPage();
  doc.moveDown(0.4);
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9).text(text.toUpperCase());
  doc.moveTo(40, doc.y + 2).lineTo(doc.page.width - 40, doc.y + 2)
    .strokeColor(RULE).lineWidth(0.5).stroke();
  doc.moveDown(0.5);
}

function keyValues(doc, pairs) {
  doc.font('Helvetica').fontSize(9);
  const colWidth = (doc.page.width - 80) / 2;
  let col = 0;
  let rowY = doc.y;

  for (const [k, v] of pairs) {
    if (v === null || v === undefined || v === '') continue;
    const x = 40 + col * colWidth;
    doc.fillColor(MUTED).text(`${k}`, x, rowY, { width: colWidth - 10, continued: false });
    doc.fillColor(INK).font('Helvetica-Bold').text(String(v), x, doc.y, { width: colWidth - 10 });
    doc.font('Helvetica');
    if (col === 1) { rowY = doc.y + 4; col = 0; } else { doc.y = rowY; col = 1; }
  }
  doc.y = rowY + 8;
}

function bullets(doc, items, { colour = INK } = {}) {
  doc.font('Helvetica').fontSize(9).fillColor(colour);
  for (const item of items) {
    if (doc.y > doc.page.height - 90) doc.addPage();
    doc.text('•', 44, doc.y, { continued: false, width: 10 });
    doc.text(String(item), 56, doc.y - doc.currentLineHeight(), { width: doc.page.width - 100 });
    doc.moveDown(0.25);
  }
  doc.moveDown(0.4);
}

function footer(doc) {
  const y = doc.page.height - 56;
  doc.moveTo(40, y).lineTo(doc.page.width - 40, y).strokeColor(RULE).lineWidth(0.5).stroke();
  doc.fillColor(MUTED).font('Helvetica').fontSize(7)
    .text(
      'AI prepares the case. The doctor makes the medical decision. This document is a demonstration '
      + 'system output and is not a substitute for examination by a registered medical practitioner.',
      40, y + 6, { width: doc.page.width - 80, align: 'left' }
    );
  doc.text(`Generated ${fmtDate()}`, 40, y + 26, { width: doc.page.width - 80 });
}

function patientBlock(doc, patient, visit) {
  sectionTitle(doc, 'Patient');
  keyValues(doc, [
    ['Name', patient?.full_name],
    ['Aadhaar', mask(patient?.aadhaar_number)],
    ['Age', ageFromDob(patient?.date_of_birth) != null ? `${ageFromDob(patient.date_of_birth)} years` : null],
    ['Gender', patient?.gender],
    ['Village', patient?.village_line1],
    ['Phone', patient?.phone],
    ['Visit code', visit?.visit_code],
    ['Date', fmtDate(visit?.created_at)]
  ]);
}

/* --------------------------------------------------------------- templates */

/** Clinical summary — produced for every tier. */
function renderSummary(doc, { patient, visit, assessment, workflow }) {
  header(doc, 'Clinical Assessment Summary', workflow?.tier);
  patientBlock(doc, patient, visit);

  sectionTitle(doc, 'Presenting complaint');
  doc.font('Helvetica').fontSize(9).fillColor(INK)
    .text(visit?.chief_complaint || 'Not recorded', { width: doc.page.width - 80 });
  if (visit?.symptom_duration) {
    doc.fillColor(MUTED).fontSize(8).text(`Duration: ${visit.symptom_duration}`);
  }
  doc.moveDown(0.5);

  const v = Array.isArray(visit?.visit_vitals) ? visit.visit_vitals[0] : visit?.visit_vitals;
  if (v) {
    sectionTitle(doc, 'Vitals recorded');
    keyValues(doc, [
      ['Temperature', v.temperature_f ? `${v.temperature_f} °F` : null],
      ['Blood pressure', v.blood_pressure_systolic ? `${v.blood_pressure_systolic}/${v.blood_pressure_diastolic} mmHg` : null],
      ['Pulse', v.pulse_bpm ? `${v.pulse_bpm} bpm` : null],
      ['SpO2', v.spo2_percent ? `${v.spo2_percent} %` : null],
      ['Respiratory rate', v.respiratory_rate ? `${v.respiratory_rate} /min` : null]
    ]);
  }

  if (assessment?.patient_summary) {
    sectionTitle(doc, 'AI-prepared summary');
    doc.font('Helvetica').fontSize(9).fillColor(INK)
      .text(assessment.patient_summary, { width: doc.page.width - 80 });
    doc.moveDown(0.5);
  }

  // Statistical evidence is shown as its own block, clearly labelled — the
  // same separation the UI keeps between AI assistance and clinical decision.
  const dc = assessment?.disease_candidates;
  if (dc?.candidates?.length) {
    sectionTitle(doc, 'Statistical candidates (AI assistance — not a diagnosis)');
    bullets(doc, dc.candidates.map((c) => `${c.disease} — model confidence ${(c.confidence * 100).toFixed(1)}%`));
    doc.fillColor(MUTED).fontSize(7)
      .text(`Source: ${dc.source}. Top-5 accuracy ${dc.top5_accuracy ?? '—'} on held-out data.`, { width: doc.page.width - 80 });
    doc.moveDown(0.4);
  }

  if (workflow?.first_aid?.length) {
    sectionTitle(doc, 'First aid — to be performed by the clinic assistant');
    bullets(doc, workflow.first_aid);
  }

  if (workflow?.precautions?.items?.length) {
    sectionTitle(doc, 'Precautions');
    bullets(doc, workflow.precautions.items);
  }

  if (workflow?.diet?.length) {
    sectionTitle(doc, 'Diet guidance');
    bullets(doc, workflow.diet);
  }

  footer(doc);
}

/** Prescription — LOW only, formulary-signed medication only. */
function renderPrescription(doc, { patient, visit, workflow }) {
  header(doc, 'Medication Advice', workflow?.tier);
  patientBlock(doc, patient, visit);

  sectionTitle(doc, 'Medication');

  const med = workflow?.medication;
  if (!med?.emitted || !med.items?.length) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(TIER_COLOUR.HIGH)
      .text('No medication is issued for this case.', { width: doc.page.width - 80 });
    doc.font('Helvetica').fontSize(9).fillColor(INK).moveDown(0.3)
      .text(med?.reason || 'No formulary entry matched this presentation.', { width: doc.page.width - 80 });
  } else {
    for (const item of med.items) {
      if (doc.y > doc.page.height - 140) doc.addPage();
      doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(item.drug || item.name);
      doc.font('Helvetica').fontSize(9).fillColor(MUTED);
      if (item.dose) doc.text(`Dose: ${item.dose}`);
      if (item.frequency) doc.text(`Frequency: ${item.frequency}`);
      if (item.duration) doc.text(`Duration: ${item.duration}`);
      if (item.route) doc.text(`Route: ${item.route}`);
      if (item.availability?.cheapest_inr != null) {
        doc.text(`Available in India from about Rs ${item.availability.cheapest_inr} (${item.availability.products} products)`);
      }
      if (item.rule_source_id) {
        doc.fontSize(7).text(`Formulary entry: ${item.rule_source_id}`);
      }
      doc.moveDown(0.5);
    }

    // The signature gate is the whole safety argument for this page, so it is
    // printed on it rather than assumed.
    if (med.signature_status && med.signature_status !== 'SIGNED') {
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').fontSize(8).fillColor(TIER_COLOUR.HIGH)
        .text(
          'WARNING: this formulary is UNSIGNED. These entries have not been reviewed by a '
          + 'registered medical practitioner for this deployment and must not be dispensed.',
          { width: doc.page.width - 80 }
        );
    }
  }

  doc.moveDown(1);
  doc.moveTo(doc.page.width - 220, doc.y).lineTo(doc.page.width - 40, doc.y)
    .strokeColor(RULE).stroke();
  doc.fillColor(MUTED).font('Helvetica').fontSize(8)
    .text('Registered medical practitioner', doc.page.width - 220, doc.y + 4, { width: 180, align: 'center' });

  footer(doc);
}

/** Referral and bill — HIGH only. The danger-zone hardcopy. */
function renderReferral(doc, { patient, visit, assessment, workflow }) {
  header(doc, 'Emergency Referral', 'HIGH');

  // A red band, because this sheet travels with the patient and needs to be
  // identifiable at a glance in a hospital reception queue.
  doc.rect(40, doc.y, doc.page.width - 80, 26).fill(TIER_COLOUR.HIGH);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(11)
    .text('URGENT — REFER TO DISTRICT HOSPITAL NOW', 40, doc.y - 19, {
      width: doc.page.width - 80, align: 'center'
    });
  doc.y += 16;
  doc.fillColor(INK);

  patientBlock(doc, patient, visit);

  sectionTitle(doc, 'Reason for referral');
  doc.font('Helvetica').fontSize(9).fillColor(INK)
    .text(assessment?.patient_summary || visit?.chief_complaint || 'Clinical deterioration', {
      width: doc.page.width - 80
    });
  doc.moveDown(0.5);

  const ref = workflow?.referral;
  const primary = ref?.primary;
  if (primary) {
    sectionTitle(doc, 'Refer to');
    keyValues(doc, [
      ['Hospital', primary.name],
      ['District', primary.district],
      ['Distance', primary.road_distance_km
        ? `${primary.road_distance_km} km by road`
        : primary.straight_line_km != null ? `${primary.straight_line_km} km (straight line)` : null],
      ['Estimated travel', primary.driving_time_text],
      ['Coordinates', `${primary.lat}, ${primary.lon}`]
    ]);

    if (ref.alternatives?.length) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(8)
        .text(`Alternatives: ${ref.alternatives.map((a) => `${a.name} (${a.straight_line_km} km)`).join('  ·  ')}`,
          { width: doc.page.width - 80 });
      doc.moveDown(0.4);
    }
  }

  sectionTitle(doc, 'Emergency contacts');
  bullets(doc, (ref?.emergency_lines || [{ number: '108', label: 'Emergency ambulance' }])
    .map((l) => `${l.number} — ${l.label}`));

  // Stated plainly on the printed sheet. There is no public live bed feed for
  // UP district hospitals, and a fabricated capacity number on a referral is
  // the single most dangerous thing this system could print.
  sectionTitle(doc, 'Bed and room availability');
  doc.font('Helvetica-Bold').fontSize(9).fillColor(TIER_COLOUR.HIGH)
    .text('NOT CONFIRMED — call before transporting.', { width: doc.page.width - 80 });
  doc.font('Helvetica').fontSize(8.5).fillColor(INK).moveDown(0.2)
    .text(
      ref?.capacity_instruction
      || 'Bed and room availability is not published as a live feed. Call the hospital or 108 to confirm capacity before moving the patient.',
      { width: doc.page.width - 80 }
    );
  doc.moveDown(0.5);

  if (workflow?.first_aid?.length) {
    sectionTitle(doc, 'First aid given before transfer');
    bullets(doc, workflow.first_aid);
  }

  if (workflow?.precautions?.items?.length) {
    sectionTitle(doc, 'Precautions during transfer');
    bullets(doc, workflow.precautions.items);
  }

  // Charges. A village sub-centre referral under public health schemes carries
  // no consultation fee; printing the zero explicitly stops anyone charging.
  sectionTitle(doc, 'Charges');
  keyValues(doc, [
    ['Sub-centre consultation', 'Rs 0.00'],
    ['AI assessment', 'Rs 0.00'],
    ['Referral issue', 'Rs 0.00'],
    ['Total payable', 'Rs 0.00']
  ]);
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
    .text('No charge is payable at the sub-centre. Hospital charges, if any, are billed separately by the receiving facility.',
      { width: doc.page.width - 80 });

  doc.moveDown(1.2);
  doc.moveTo(40, doc.y).lineTo(220, doc.y).strokeColor(RULE).stroke();
  doc.fillColor(MUTED).fontSize(8).text('Clinic assistant', 40, doc.y + 4, { width: 180 });

  footer(doc);
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
 * @param {object} data  { patient, visit, assessment, workflow }
 * @returns {PDFDocument} a readable stream the route pipes to the response
 */
export const renderReport = (type, data) => {
  const render = TEMPLATES[type];
  if (!render) throw new Error(`Unknown report type: ${type}`);

  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
  render(doc, data);
  doc.end();
  return doc;
};

export const REPORT_TYPES = Object.keys(TEMPLATES);
