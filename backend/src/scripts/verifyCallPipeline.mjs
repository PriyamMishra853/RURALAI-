/**
 * Drive the whole consultation pipeline against the deployed system.
 *
 *   npm run verify:call
 *
 * Books a real consultation, joins it, opens two authenticated websockets as a
 * doctor and an assistant, exchanges signalling, forces a disconnect and checks
 * the rejoin — then deletes the consultation it made.
 *
 * This exists because "the video call is broken" has three times turned out to
 * mean something else entirely: an empty doctor_schedules table, a stale
 * frontend bundle, a websocket URL with the wrong scheme. Each was hours of
 * bisecting call code that was never at fault. Every stage prints PASS or FAIL
 * separately, so the first FAIL names the layer to look at.
 *
 * Needs JWT_SECRET and DATABASE_URL — it mints tokens rather than signing in,
 * so it is an operator tool, the same class as the seed scripts.
 */

import 'dotenv/config';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { WebSocket } from 'ws';

const H = 'https://ruralai-production-220.up.railway.app';
const WS = 'wss://ruralai-production-220.up.railway.app/realtime';
const ORIGIN = 'https://ruralai-psi.vercel.app';

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (s, a = []) => (await c.query(s, a)).rows;

const asst = (await q("select id,auth_user_id,email,district_id from staff_profiles where email='rachna.kashyap.asst6@vvc-demo.example.com'"))[0];
const doc = (await q("select id,auth_user_id,email from staff_profiles where role='doctor' and status='active' and district_id=$1 limit 1", [asst.district_id]))[0];
const tok = (p, r) => jwt.sign({ sub: p.id, authUserId: p.auth_user_id, email: p.email, role: r }, process.env.JWT_SECRET, { expiresIn: '15m' });
const AT = tok(asst, 'CLINIC_ASSISTANT'); const DT = tok(doc, 'DOCTOR');

const call = async (path, token, opts = {}) => {
  const res = await fetch(`${H}/api${path}`, {
    method: opts.method || 'GET',
    headers: { Authorization: `Bearer ${token}`, Origin: ORIGIN, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, body };
};

const ok = (b) => (b ? 'PASS' : '*** FAIL ***');
console.log('--- SCHEDULING -------------------------------------------------');
const dates = await call('/consultations/availability/dates', AT);
const openDays = (dates.body?.dates || []).filter((d) => (d.available_slots || 0) > 0).length;
console.log(`availability/dates      ${dates.status}  open days=${openDays}/7  ${ok(openDays > 0)}`);
const today = dates.body?.today;
const slots = await call(`/consultations/availability/slots?date=${today}`, AT);
console.log(`availability/slots      ${slots.status}  doctors=${slots.body?.doctors?.length}  slots=${slots.body?.slots?.length}  ${ok((slots.body?.slots?.length || 0) > 0)}`);

console.log('');
console.log('--- BOOK A CONSULTATION ----------------------------------------');
const visit = (await q('select id from visits where district_id=$1 and deleted_at is null limit 1', [asst.district_id]))[0];
const free = slots.body?.slots?.find((s) => (s.available_doctors || []).length > 0);
const startAt = free ? free.start_time : null;
const chosenDoctor = free?.available_doctors?.[0]?.id || doc.id;
let consultationId = null;
if (startAt) {
  const created = await call('/consultations', AT, { method: 'POST', body: { visit_id: visit.id, doctor_id: chosenDoctor, scheduled_start_time: startAt } });
  consultationId = created.body?.id;
  console.log(`POST /consultations     ${created.status}  ${ok(created.status === 201 || created.status === 200)}  ${created.body?.error || ''}`);
  console.log(`  assistant_id set      ${created.body?.assistant_id ? 'yes' : 'no'}  ${ok(Boolean(created.body?.assistant_id))}`);
  console.log(`  meeting room issued   ${created.body?.meeting_room_id ? 'yes' : 'no'}  ${ok(Boolean(created.body?.meeting_room_id))}`);
} else {
  console.log('no free slot found — cannot book');
}

console.log('');
console.log('--- BOTH LISTS SEE IT ------------------------------------------');
const al = await call('/consultations?scope=upcoming', AT);
const dl = await call('/consultations?scope=upcoming', DT);
const inA = (al.body?.consultations || []).some((x) => x.id === consultationId);
const inD = (dl.body?.consultations || []).some((x) => x.id === consultationId);
console.log(`assistant list n=${al.body?.consultations?.length}  contains it: ${inA}  ${ok(inA)}`);
console.log(`doctor    list n=${dl.body?.consultations?.length}  contains it: ${inD}  ${ok(inD)}`);

console.log('');
console.log('--- JOIN + ICE -------------------------------------------------');
if (consultationId) {
  const joined = await call(`/consultations/${consultationId}/join`, AT, { method: 'POST' });
  console.log(`POST /join              ${joined.status}  ${ok(joined.status === 200)}  ${joined.body?.error || ''}`);
  const ice = joined.body?.credentials?.iceServers || [];
  const relay = ice.filter((s) => [].concat(s.urls || []).some((u) => String(u).startsWith('turn')));
  console.log(`  ICE servers           ${ice.length}  relay entries=${relay.length}  ${ok(relay.length > 0)}`);
  if (relay.length) console.log(`  relay urls            ${[].concat(relay[0].urls).join(', ')}`);
}

console.log('');
console.log('--- WEBSOCKET SIGNALLING (real socket, real token) -------------');
const openSock = (token, label) => new Promise((resolve) => {
  const ws = new WebSocket(`${WS}?token=${token}`, { headers: { Origin: ORIGIN } });
  ws.inbox = [];
  const t = setTimeout(() => { resolve({ ws, ok: false, why: 'timeout' }); }, 12000);
  ws.on('message', (m) => { try { ws.inbox.push(JSON.parse(m.toString())); } catch {} });
  ws.on('open', () => { clearTimeout(t); resolve({ ws, ok: true }); });
  ws.on('error', (e) => { clearTimeout(t); resolve({ ws, ok: false, why: e.message }); });
});
const waitFor = async (ws, type, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const hit = ws.inbox.find((m) => m.type === type);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 60));
  }
  return null;
};

const a = await openSock(AT, 'assistant');
const d = await openSock(DT, 'doctor');
console.log(`assistant socket open   ${ok(a.ok)}  ${a.why || ''}`);
console.log(`doctor    socket open   ${ok(d.ok)}  ${d.why || ''}`);

if (a.ok && d.ok && consultationId) {
  a.ws.send(JSON.stringify({ type: 'call:join', consultationId }));
  const aj = await waitFor(a.ws, 'call:joined');
  console.log(`assistant call:joined   ${ok(Boolean(aj))}  peers=${aj?.peers?.length ?? '-'}`);

  d.ws.send(JSON.stringify({ type: 'call:join', consultationId }));
  const dj = await waitFor(d.ws, 'call:joined');
  console.log(`doctor    call:joined   ${ok(Boolean(dj))}  peers=${dj?.peers?.length ?? '-'}`);

  const peerSeen = await waitFor(a.ws, 'call:peer-joined');
  console.log(`assistant sees peer     ${ok(Boolean(peerSeen))}  ${peerSeen?.name || ''}`);

  d.ws.send(JSON.stringify({ type: 'call:offer', sdp: { type: 'offer', sdp: 'v=0-verify' } }));
  const relayed = await waitFor(a.ws, 'call:offer');
  console.log(`SDP offer relayed       ${ok(relayed?.sdp?.sdp === 'v=0-verify')}`);

  // Reconnect: drop the doctor, rejoin, and confirm membership is restored.
  d.ws.close();
  const left = await waitFor(a.ws, 'call:peer-left');
  console.log(`peer-left on drop       ${ok(Boolean(left))}`);
  const d2 = await openSock(DT, 'doctor-again');
  a.ws.inbox.length = 0;
  d2.ws.send(JSON.stringify({ type: 'call:join', consultationId }));
  const rejoined = await waitFor(d2.ws, 'call:joined');
  const seenAgain = await waitFor(a.ws, 'call:peer-joined');
  console.log(`rejoin after drop       ${ok(Boolean(rejoined) && Boolean(seenAgain))}  peers=${rejoined?.peers?.length ?? '-'}`);
  d2.ws.close();
}
a.ws?.close(); d.ws?.close();

// Clean up the consultation this created.
if (consultationId) {
  await c.query('delete from consultations where id=$1', [consultationId]);
  console.log('');
  console.log('(test consultation removed)');
}
await c.end();
process.exit(0);
