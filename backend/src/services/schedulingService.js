import { supabaseAdmin } from '../config/supabase.js';

/**
 * Scheduling engine — spec §2.
 *
 * Every availability question is answered from `doctor_schedules` and the
 * consultations table, computed server-side, at the moment it is asked.
 * Nothing here is hardcoded and nothing is trusted from the client: §2.4
 * re-runs the whole check inside the booking transaction, because a slot list
 * rendered eight seconds ago is a guess, not a fact.
 */

export const SLOT_MINUTES = 5;
export const CONSULTATION_MINUTES = 15;
/** §3.2 — joinable window is [start − 5min, end + 5min]. */
export const TOLERANCE_MINUTES = 5;

/** IST is the clinic timezone; visit_date and working hours are both in it. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export const istNow = () => new Date(Date.now() + IST_OFFSET_MS);

/** YYYY-MM-DD for a Date, read in IST. */
export const istDateString = (d = new Date()) =>
  new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** 0 = Sunday .. 6 = Saturday, for a YYYY-MM-DD string. */
export const dayOfWeek = (dateStr) => new Date(`${dateStr}T00:00:00Z`).getUTCDay();

/**
 * Round a time UP to the next 5-minute boundary — spec §2.3.
 *
 * Seconds and milliseconds are dropped, so 2:31:40 becomes 2:35:00, not
 * 2:35:40. Verified cases: 2:31→2:35, 2:36→2:40, 2:37→2:40, 2:41→2:45,
 * 2:59→3:00. A time already on a boundary does not move.
 */
export const nextSlotBoundary = (now = new Date()) => {
  const d = new Date(now);
  d.setSeconds(0, 0);
  const remainder = d.getMinutes() % SLOT_MINUTES;
  if (remainder !== 0) d.setMinutes(d.getMinutes() + (SLOT_MINUTES - remainder));
  return d;
};

/** Combine a YYYY-MM-DD (IST) and a HH:MM:SS into a real UTC instant. */
const istDateTimeToUtc = (dateStr, timeStr) => {
  const [h, m] = String(timeStr).split(':').map(Number);
  const base = new Date(`${dateStr}T00:00:00Z`).getTime();
  return new Date(base + (h * 60 + (m || 0)) * 60000 - IST_OFFSET_MS);
};

const hhmm = (date) => {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`;
};

/**
 * Active doctors in a district, with their schedule row for this weekday.
 * A doctor with no row for the day is "not working" — same as is_off (§2.2).
 */
export const doctorsForDay = async (districtId, dateStr) => {
  const dow = dayOfWeek(dateStr);

  const { data: doctors } = await supabaseAdmin
    .from('staff_profiles')
    .select('id, full_name, doctor_profiles ( specialization, qualification, is_available_for_consultation )')
    .eq('role', 'doctor')
    .eq('status', 'active')
    .eq('district_id', districtId)
    .order('full_name');

  if (!doctors?.length) return [];

  const ids = doctors.map((d) => d.id);
  const { data: schedules } = await supabaseAdmin
    .from('doctor_schedules')
    .select('doctor_id, start_time, end_time, is_off')
    .in('doctor_id', ids)
    .eq('day_of_week', dow);

  const byDoctor = new Map((schedules || []).map((s) => [s.doctor_id, s]));

  return doctors.map((d) => {
    const row = byDoctor.get(d.id);
    const working = Boolean(row) && !row.is_off;
    return {
      id: d.id,
      name: d.full_name,
      specialization: d.doctor_profiles?.specialization || 'General Medicine',
      qualification: d.doctor_profiles?.qualification || '',
      working,
      start_time: working ? row.start_time : null,
      end_time: working ? row.end_time : null,
      status_for_day: working ? 'Working' : 'Not available today'
    };
  });
};

/** SCHEDULED/ACTIVE consultations that could collide, for a set of doctors on a date. */
const busyBlocks = async (doctorIds, dateStr) => {
  if (!doctorIds.length) return new Map();

  const dayStart = new Date(`${dateStr}T00:00:00Z`).getTime() - IST_OFFSET_MS;
  const { data } = await supabaseAdmin
    .from('consultations')
    .select('doctor_id, scheduled_start_time, scheduled_end_time, status')
    .in('doctor_id', doctorIds)
    .in('status', ['SCHEDULED', 'ACTIVE'])
    .gte('scheduled_start_time', new Date(dayStart - 86400000).toISOString())
    .lte('scheduled_start_time', new Date(dayStart + 2 * 86400000).toISOString());

  const map = new Map();
  for (const c of data || []) {
    if (!map.has(c.doctor_id)) map.set(c.doctor_id, []);
    map.get(c.doctor_id).push([
      new Date(c.scheduled_start_time).getTime(),
      new Date(c.scheduled_end_time).getTime()
    ]);
  }
  return map;
};

const overlaps = (blocks, startMs, endMs) =>
  (blocks || []).some(([s, e]) => startMs < e && endMs > s);

/**
 * Slot grid for one date — spec §2.3.
 *
 * Returns every 5-minute slot in the union of all working windows, each
 * carrying the doctors free at that exact moment. Today's lower bound is the
 * next 5-minute boundary from *now*, so a past slot is never offered.
 */
export const buildSlots = async (districtId, dateStr) => {
  const doctors = await doctorsForDay(districtId, dateStr);
  const working = doctors.filter((d) => d.working);
  if (!working.length) return { doctors, slots: [] };

  const blocks = await busyBlocks(working.map((d) => d.id), dateStr);

  const isToday = dateStr === istDateString();
  const lowerBound = isToday ? nextSlotBoundary(new Date()).getTime() : 0;

  // One grid across the union of windows, so the UI shows a single time list.
  const slotMap = new Map();

  for (const doc of working) {
    const winStart = istDateTimeToUtc(dateStr, doc.start_time).getTime();
    const winEnd = istDateTimeToUtc(dateStr, doc.end_time).getTime();
    const from = Math.max(winStart, lowerBound);

    for (let t = from; t + CONSULTATION_MINUTES * 60000 <= winEnd; t += SLOT_MINUTES * 60000) {
      // Align to the 5-minute grid so every doctor's slots line up.
      const slotStart = Math.ceil(t / (SLOT_MINUTES * 60000)) * (SLOT_MINUTES * 60000);
      const slotEnd = slotStart + CONSULTATION_MINUTES * 60000;
      if (slotEnd > winEnd) break;

      if (overlaps(blocks.get(doc.id), slotStart, slotEnd)) continue;

      if (!slotMap.has(slotStart)) slotMap.set(slotStart, []);
      const list = slotMap.get(slotStart);
      if (!list.some((d) => d.id === doc.id)) {
        list.push({ id: doc.id, name: doc.name, specialization: doc.specialization });
      }
    }
  }

  const slots = [...slotMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ms, docs]) => ({
      start_time: new Date(ms).toISOString(),
      label: hhmm(new Date(ms)),
      available_doctors: docs
    }));

  return { doctors, slots };
};

/**
 * 7-day strip — spec §2.1.
 *
 * Counts come from the same slot builder the booking screen uses, so the
 * number under a date can never disagree with what opens when it is tapped.
 */
export const buildDateStrip = async (districtId, days = 7) => {
  const today = istDateString();
  const out = [];

  for (let i = 0; i < days; i += 1) {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    const dateStr = d.toISOString().slice(0, 10);

    const { doctors, slots } = await buildSlots(districtId, dateStr);
    const availableDoctors = new Set(slots.flatMap((s) => s.available_doctors.map((x) => x.id)));

    out.push({
      date: dateStr,
      is_today: i === 0,
      weekday: d.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' }),
      day: d.getUTCDate(),
      month: d.toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }),
      doctors_working: doctors.filter((x) => x.working).length,
      available_doctors: availableDoctors.size,
      available_slots: slots.length,
      // "No doctor works this day" and "every slot is taken" are different
      // things and the UI labels them differently.
      unavailable: doctors.every((x) => !x.working)
    });
  }
  return out;
};

/**
 * Doctors free at one exact instant — spec §2.5, and the candidate pool for
 * Instant Consultation (§2.6).
 */
export const doctorsFreeAt = async (districtId, whenIso, { requireWorkingNow = false } = {}) => {
  const when = new Date(whenIso);
  const dateStr = istDateString(when);
  const doctors = await doctorsForDay(districtId, dateStr);
  const working = doctors.filter((d) => d.working);
  if (!working.length) return [];

  const startMs = when.getTime();
  const endMs = startMs + CONSULTATION_MINUTES * 60000;
  const blocks = await busyBlocks(working.map((d) => d.id), dateStr);

  return working
    .filter((doc) => {
      const winStart = istDateTimeToUtc(dateStr, doc.start_time).getTime();
      const winEnd = istDateTimeToUtc(dateStr, doc.end_time).getTime();
      if (startMs < winStart || endMs > winEnd) return false;
      if (requireWorkingNow && (startMs < winStart || startMs > winEnd)) return false;
      return !overlaps(blocks.get(doc.id), startMs, endMs);
    })
    .map((d) => ({ ...d, available: true }));
};

/** §3.2 — is `now` inside [start − tolerance, end + tolerance]? */
export const insideJoinWindow = (consultation, now = new Date()) => {
  const start = new Date(consultation.scheduled_start_time).getTime() - TOLERANCE_MINUTES * 60000;
  const end = new Date(consultation.scheduled_end_time).getTime() + TOLERANCE_MINUTES * 60000;
  const t = now.getTime();
  return t >= start && t <= end;
};

/** Minutes until the join window opens; 0 once it is open. */
export const minutesUntilJoinable = (consultation, now = new Date()) => {
  const opens = new Date(consultation.scheduled_start_time).getTime() - TOLERANCE_MINUTES * 60000;
  return Math.max(0, Math.ceil((opens - now.getTime()) / 60000));
};
