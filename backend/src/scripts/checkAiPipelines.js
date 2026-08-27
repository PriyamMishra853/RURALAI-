/**
 * End-to-end check of the three AI reading paths against the live providers.
 *
 * `npm run check` proves the keys and models answer. This proves the pipelines
 * actually produce structured clinical data — the two failed independently
 * once already, when gemini-2.5-flash kept appearing in the /models listing
 * after generateContent had started refusing new keys.
 *
 * Fixtures are generated, so no clinical data is carried around. They are crude
 * bitmap text: expect "(unclear)" markers in the output. That is the correct
 * behaviour — the pipeline must flag an uncertain read, never invent a value.
 */
import 'dotenv/config';
import { textImage } from './lib/testImage.js';
import { processMedicalDocument } from '../services/ocrService.js';
import { analyzeInjuryImage } from '../services/visionService.js';

const line = (s) => console.log(`\n${'─'.repeat(64)}\n${s}\n${'─'.repeat(64)}`);
const fail = [];

line('1. PRESCRIPTION OCR');
const rxResult = await processMedicalDocument(
  [{ buffer: textImage(['CLINIC RECEIPT', 'DR A GUPTA', 'PARACETAMOL 500 MG', 'TWICE DAILY 5 DAYS']),
     mimetype: 'image/png', originalname: 'rx.png' }],
  'prescription'
);
console.log('engine       :', rxResult.ocr_engine);
console.log('medications  :', rxResult.extracted_data.medications.length, 'line(s)');
console.log('needs manual :', rxResult.needs_manual_entry);
if (rxResult.ocr_engine === 'none') fail.push('prescription OCR produced no engine');

line('2. MULTI-PAGE LAB REPORT OCR (2 pages as one document)');
const labResult = await processMedicalDocument([
  { buffer: textImage(['LAB REPORT PAGE ONE', 'HAEMOGLOBIN 9.1 G DL', 'REF 13 TO 17']), mimetype: 'image/png', originalname: 'p1.png' },
  { buffer: textImage(['LAB REPORT PAGE TWO', 'GLUCOSE 210 MG DL', 'REF 70 TO 110']), mimetype: 'image/png', originalname: 'p2.png' }
], 'lab_report');
console.log('engine       :', labResult.ocr_engine);
console.log('files read   :', labResult.files_read);
console.log('pages read   :', labResult.extracted_data.pages_read);
console.log('tests found  :', labResult.extracted_data.panels.reduce((n, p) => n + p.tests.length, 0));
if (labResult.files_read !== 2) fail.push('lab report did not read both pages');

line('3. WOUND PHOTO VISION');
const vision = await analyzeInjuryImage(textImage(['CLINICAL PHOTO']), 'image/png');
console.log('engine       :', vision.engine);
console.log('severity     :', vision.severity_impression);
console.log('refused non-clinical image:', vision.analysis_possible === false ? 'yes (correct)' : 'no');
console.log('summary      :', (vision.cautious_summary || '').slice(0, 150));
if (vision.engine === 'none') fail.push('vision engine unavailable — check GEMINI_API_KEY and the model id');

line(fail.length ? `${fail.length} PIPELINE FAILURE(S)` : 'ALL THREE PIPELINES REACHED A LIVE MODEL');
for (const f of fail) console.log(' -', f);
process.exit(fail.length ? 1 : 0);
