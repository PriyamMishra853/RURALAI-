/**
 * Run the CHATBOX extraction over the intake test set and score it.
 *
 *   npm run eval:intake                 all cases
 *   npm run eval:intake -- --case hi-roman-fever
 *   npm run eval:intake -- --out report.json
 *
 * Calls the real extraction handler — the same prompt, model and rules the
 * live CHATBOX uses — so this spends Groq requests (one per case). It writes
 * nothing to any database. Exits 1 when the Phase 2 exit criterion is not met,
 * so it can gate a change to the prompt or the rules.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractIntake } from '../controllers/intake.controller.js';
import { scoreCase, summarise } from '../eval/intakeScoring.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES = path.resolve(__dirname, '../../eval/intake-cases.json');

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
};

const extract = (transcript) => new Promise((resolve) => {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { resolve({ statusCode: this.statusCode, body }); return this; }
  };
  extractIntake({ body: { transcript, typed: {} } }, res);
});

const main = async () => {
  const { cases } = JSON.parse(fs.readFileSync(CASES, 'utf8'));
  const only = arg('--case');
  const selected = only ? cases.filter((c) => c.id === only) : cases;
  if (!selected.length) {
    console.error(`No case named ${only}.`);
    process.exit(2);
  }

  const scores = [];
  for (const testCase of selected) {
    const { statusCode, body } = await extract(testCase.transcript);
    if (statusCode !== 200 || body?.ok === false) {
      console.log(`✗ ${testCase.id}  extraction failed: ${body?.reason || body?.error || statusCode}`);
      scores.push({ ...scoreCase(testCase, {}), pass: false, error: body?.reason || body?.error || String(statusCode) });
      continue;
    }
    const score = scoreCase(testCase, body);
    scores.push(score);
    const failed = score.checks.filter((c) => !c.ok);
    console.log(`${score.pass ? '✓' : '✗'} ${testCase.id}`);
    for (const c of failed) {
      console.log(`    ${c.kind} ${c.field}: expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(c.got)}`);
    }
  }

  const summary = summarise(scores);
  console.log('\n' + JSON.stringify(summary, null, 2));

  const out = arg('--out');
  if (out) fs.writeFileSync(out, JSON.stringify({ generated_at: new Date().toISOString(), summary, scores }, null, 2));

  process.exit(summary.exit_criterion_met ? 0 : 1);
};

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
