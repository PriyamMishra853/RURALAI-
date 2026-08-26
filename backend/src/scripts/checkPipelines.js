/**
 * End-to-end pipeline check against the real providers.
 *
 * Run: npm run check:pipelines
 *
 * Separate from `npm run check`, which only proves each service is reachable.
 * This one pushes real input through each pipeline and inspects the output, so
 * it catches the failures that reachability cannot: a model that returns prose
 * where JSON was required, a rubric field that never gets populated, an OCR
 * path that throws on a real image.
 *
 * Like `check`, this is deliberately outside the Jest suite — it costs money
 * and is non-deterministic. Plan §H.3.
 *
 * NOTE ON THE VISION CHECK: a synthetic test image proves wiring only. Vision
 * models correctly refuse to score drawings. Real clinical behaviour cannot be
 * assessed until a genuine wound photograph is used — plan §D.3.
 */
import 'dotenv/config';
import { solidImage, textImage } from './lib/testImage.js';

const results = [];

const run = async (name, fn) => {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail, ms: Date.now() - t0 });
  } catch (err) {
    results.push({ name, ok: false, detail: err.message?.slice(0, 200) || String(err), ms: Date.now() - t0 });
  }
};



// ─────────────────────────── 1. Triage engine ───────────────────────────
await run('Triage — rule engine', async () => {
  const { calculateRiskLevel } = await import('../services/riskEngine.js');
  const empty = calculateRiskLevel({}, '', '');
  if (empty.riskLevel === 'LOW') throw new Error('INVARIANT BROKEN: empty case returned LOW');
  const critical = calculateRiskLevel({ spo2: 0 }, '', '', { age: 30 });
  if (!critical.immediateReferral) throw new Error('INVARIANT BROKEN: SpO2 of 0 did not escalate');
  return `empty→${empty.riskLevel}, SpO2 0→${critical.riskLevel} w/ referral`;
});

// ─────────────────────────── 2. Formulary ───────────────────────────────
await run('Formulary — rules engine', async () => {
  const { selectMedications } = await import('../services/formularyService.js');
  const high = selectMedications({ tier: 'HIGH', patient: { age: 30 }, symptoms: 'fever' });
  if (high.medications.length) throw new Error('INVARIANT BROKEN: HIGH tier emitted medication');
  const low = selectMedications({ tier: 'LOW', patient: { age: 30 }, symptoms: 'fever' });
  const sourced = low.medications.every((m) => m.rule_source_id);
  if (!sourced) throw new Error('INVARIANT BROKEN: medication without rule_source_id');
  return `HIGH→0 meds, LOW→${low.medications.length} med(s), all rule-sourced`;
});

// ─────────────────────────── 3. RAG retrieval ───────────────────────────
await run('RAG — protocol retrieval', async () => {
  const { retrieveClinicalProtocols } = await import('../services/ragEngine.js');
  const protocols = await retrieveClinicalProtocols('fever and cough for two days', 3);
  if (!Array.isArray(protocols)) throw new Error('did not return an array');
  if (protocols.length === 0) {
    throw new Error('returned 0 protocols — Qdrant is down and the Supabase fallback tables are empty');
  }
  return `${protocols.length} protocol(s): ${protocols.map((p) => p.title).join(', ').slice(0, 80)}`;
});

// ─────────────────────────── 4. Assessment (Groq) ───────────────────────
await run('Assessment — Groq LLM', async () => {
  const { runFullPatientAssessment } = await import('../services/aiOrchestrator.js');
  const out = await runFullPatientAssessment({
    patient: { name: 'Pipeline Test', age: 34, gender: 'female', village: 'Test Village' },
    visit: { chief_complaint: 'fever and headache for two days', symptom_duration: '2 days' },
    vitals: { temperature: 101.2, spo2: 97, blood_pressure_systolic: 118, blood_pressure_diastolic: 78, pulse: 88 },
    verifiedDocuments: [],
    imageObservations: []
  });
  if (!out.patient_summary) throw new Error('no patient_summary returned');
  if (!['LOW', 'MEDIUM', 'HIGH'].includes(out.risk_level)) throw new Error(`bad tier: ${out.risk_level}`);

  // The model must not have authored medication.
  const authored = (out.supportive_medication_guidance || []).filter(
    (line) => !out.medications?.some((m) => line.includes(m.drug))
  );
  if (authored.length) throw new Error(`model-authored medication survived: ${authored[0].slice(0, 60)}`);

  return `tier=${out.risk_level} via ${out.generated_by}, ${out.first_aid_steps?.length || 0} first-aid steps, ${out.medications?.length || 0} med(s)`;
});

// ─────────────────────────── 5. OCR (Tesseract) ─────────────────────────
await run('OCR — Tesseract document read', async () => {
  const { processMedicalDocument } = await import('../services/ocrService.js');
  const img = textImage(['PARACETAMOL', '500 MG']);
  const out = await processMedicalDocument(img, 'test-prescription.png', 'image/png');
  if (!out) throw new Error('returned nothing');
  const text = JSON.stringify(out).toLowerCase();
  // The fixture is a crude 5x7 bitmap font, so exact character accuracy is not
  // a fair bar — Tesseract reads it as approximately "PARACETAMOL 500 MG".
  // What this proves is that the pipeline runs: Tesseract loads, produces text,
  // and the structuring step returns the expected shape. Real accuracy needs
  // real document images — plan §D.4 and §J.3 #8.
  if (!out.raw_text || !out.raw_text.trim()) throw new Error('OCR produced no text at all');
  if (!out.extracted_data) throw new Error('OCR produced no structured output');
  const flat = out.raw_text.trim().split(/\s+/).join(' ');
  return `raw="${flat.slice(0, 32)}" (synthetic font — plumbing only)`;
});

// ─────────────────────────── 6. Vision (Gemini) ─────────────────────────
await run('Vision — Gemini wound analysis', async () => {
  const { analyzeInjuryImage } = await import('../services/visionService.js');
  // A plain skin-toned rectangle. Proves wiring; proves nothing clinical.
  const img = solidImage(512, 512, [210, 170, 140]);
  const out = await analyzeInjuryImage(img, 'image/png');
  if (!out) throw new Error('returned nothing');
  if (out.severity_impression && !['LOW', 'MEDIUM', 'HIGH'].includes(out.severity_impression)) {
    throw new Error(`severity_impression outside the rubric: ${out.severity_impression}`);
  }
  return `severity=${out.severity_impression}, analysis_possible=${out.analysis_possible}, engine=${out.engine} — SYNTHETIC IMAGE`;
});

// ─────────────────────────── 7. Speech (Whisper) ────────────────────────
await run('Speech — Groq Whisper', async () => {
  const { transcribeAndExtractSymptoms } = await import('../services/speechService.js');
  // 1 second of silence as a valid WAV. Whisper should accept it and return
  // empty or near-empty text rather than throwing.
  const sampleRate = 16000;
  const samples = sampleRate;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + samples * 2, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(samples * 2, 40);
  const wav = Buffer.concat([header, Buffer.alloc(samples * 2)]);

  const out = await transcribeAndExtractSymptoms(wav, 'AUTO');
  if (!out) throw new Error('returned nothing');

  // Silence must produce NO transcript and NO symptoms. Whisper emits
  // training-data artifacts on silence ("www.pengali.com" in one run), and an
  // earlier version substituted a fixed fever/cough/body-pain description.
  if (out.transcript) throw new Error(`silence produced a transcript: "${out.transcript}"`);
  if (out.extracted_symptoms?.length) {
    throw new Error(`silence produced ${out.extracted_symptoms.length} fabricated symptom(s)`);
  }
  if (out.ok !== false) throw new Error('silence was not reported as a failure');
  return `silence correctly rejected: "${out.reason}"`;
});

// ─────────────────────────── Report ─────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n);
console.log(`\nRuralAI pipeline check\n${'─'.repeat(88)}`);
for (const r of results) {
  console.log(`${r.ok ? '✓' : '✗'} ${pad(r.name, 32)} ${pad(r.ms + 'ms', 8)} ${r.detail}`);
}
console.log('─'.repeat(88));
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length} pipeline(s) failing.\n` : '\nAll pipelines passing.\n');
process.exit(failed.length ? 1 : 0);
