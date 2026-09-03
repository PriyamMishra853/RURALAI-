/**
 * The seed must restore what it destroys.
 *
 * `doctor_schedules` references `staff_profiles` ON DELETE CASCADE, so seedV2's
 * staff rebuild wipes every schedule row. For a long time nothing put them
 * back, and the consequence was invisible in the worst way: a missing row means
 * "not working that day", so the scheduling engine correctly reported that all
 * 376 doctors were off, every date read Closed, no consultation could be
 * booked, and the video call therefore could not be reached at all.
 *
 * That presented three separate times as "the video call is broken" and cost
 * hours each time, because the call code was never at fault. These tests assert
 * the two properties whose absence produces that symptom.
 */
import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.resolve(here, '..', p), 'utf8');

const seedV2 = read('src/scripts/seedV2.js');
const seedDaily = read('src/scripts/seedDailyWorkload.js');
// doctor_schedules is declared with the consultation tables, not the core schema.
const schema = read('../database/v2/05_consultations.sql');

describe('seedV2 leaves the scheduling engine usable', () => {
  it('writes doctor_schedules', () => {
    // The precise mechanism of the three "video call is broken" incidents.
    expect(seedV2).toMatch(/bulkInsert\(\s*\n?\s*client,\s*'doctor_schedules'/);
  });

  it('gives every seeded doctor a row for all seven days', () => {
    // Six days would silently make one weekday unbookable, which is the same
    // failure in a form that is even harder to notice.
    expect(seedV2).toMatch(/day\s*<=\s*6|day\s*<\s*7/);
  });

  it('writes schedules after the staff rebuild that cascades them away', () => {
    const staffWrite = seedV2.indexOf("'staff_profiles'");
    const scheduleWrite = seedV2.indexOf("'doctor_schedules'");
    expect(staffWrite).toBeGreaterThan(-1);
    expect(scheduleWrite).toBeGreaterThan(staffWrite);
  });
});

describe('the cascade that makes this necessary still exists', () => {
  it('doctor_schedules cascades from staff_profiles', () => {
    // If this ever stops being true the seeding requirement changes, and this
    // test should be revisited rather than deleted.
    const table = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS doctor_schedules'));
    const body = table.slice(0, table.indexOf(');'));
    expect(body).toMatch(/staff_profiles\s*\(\s*id\s*\)\s*ON DELETE CASCADE/i);
  });
});

describe('the daily workload rebuild', () => {
  it('deletes only demo visits, so a real handed-over case survives a reseed', () => {
    expect(seedDaily).toMatch(/DELETE FROM visits WHERE is_demo/);
  });

  it('does not filter that delete by a large doctor id array', () => {
    // `assigned_doctor_id = ANY($2::uuid[])` with 375 ids made Postgres abandon
    // the visit_date index; the statement timed out server-side and the
    // workload could not be rebuilt at all.
    const deleteStatement = seedDaily.slice(
      seedDaily.indexOf('DELETE FROM visits'),
      seedDaily.indexOf('DELETE FROM visits') + 200
    );
    expect(deleteStatement).not.toMatch(/ANY\(\$\d+::uuid\[\]\)/);
  });
});
