/**
 * Emergency referral routing.
 *
 * This runs when a patient is being sent to a hospital, so its failure modes
 * are unusually consequential: a wrong hospital, a distance that reads as a
 * drive when it is a straight line, or a screen that produces nothing at all
 * because a maps API was down.
 *
 * The governing rule, from MASTER_PLAN §0 item 3, is that a referral must be
 * computable with no API key and no network beyond this process. Every test
 * below runs with no key configured, which is also how production runs today.
 */
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import {
  haversineKm, nearestHospitals, hospitalForDistrict,
  buildReferral, withinIndia, directionsUrl, referralDataLoaded
} from '../src/services/referralService.js';

// Known points, so the distances below are checkable by hand.
const LUCKNOW = { lat: 26.8467, lon: 80.9462 };
const KANPUR = { lat: 26.4499, lon: 80.3319 };
const DELHI = { lat: 28.6139, lon: 77.2090 };

describe('the hospital data actually loaded', () => {
  it('has all 75 district hospitals', () => {
    // Everything else here is meaningless if the file did not parse.
    expect(referralDataLoaded()).toBe(75);
  });
});

describe('haversine', () => {
  it('is zero for a point against itself', () => {
    expect(haversineKm(LUCKNOW.lat, LUCKNOW.lon, LUCKNOW.lat, LUCKNOW.lon)).toBeCloseTo(0, 5);
  });

  it('matches the known Lucknow-Kanpur distance', () => {
    // 75.3 km great-circle between these two points. A band rather than
    // toBeCloseTo, whose second argument is decimal places and not a tolerance
    // in kilometres — the misreading that made this assertion wrong the first
    // time. Still tight enough to catch a formula error, which characteristically
    // lands at 2x, 0.5x, or in radians.
    const d = haversineKm(LUCKNOW.lat, LUCKNOW.lon, KANPUR.lat, KANPUR.lon);
    expect(d).toBeGreaterThan(73);
    expect(d).toBeLessThan(78);
  });

  it('matches the known Lucknow-Delhi distance', () => {
    // ~420 km great-circle.
    const d = haversineKm(LUCKNOW.lat, LUCKNOW.lon, DELHI.lat, DELHI.lon);
    expect(d).toBeGreaterThan(400);
    expect(d).toBeLessThan(440);
  });

  it('is symmetric', () => {
    const there = haversineKm(LUCKNOW.lat, LUCKNOW.lon, DELHI.lat, DELHI.lon);
    const back = haversineKm(DELHI.lat, DELHI.lon, LUCKNOW.lat, LUCKNOW.lon);
    expect(there).toBeCloseTo(back, 6);
  });
});

describe('nearest hospitals', () => {
  it('returns three, closest first', () => {
    const list = nearestHospitals(LUCKNOW.lat, LUCKNOW.lon, 3);
    expect(list).toHaveLength(3);
    expect(list[0].straight_line_km).toBeLessThanOrEqual(list[1].straight_line_km);
    expect(list[1].straight_line_km).toBeLessThanOrEqual(list[2].straight_line_km);
  });

  it('picks the hospital in the district you are standing in', () => {
    const [closest] = nearestHospitals(LUCKNOW.lat, LUCKNOW.lon, 1);
    expect(closest.district).toBe('Lucknow');
  });

  it('returns nothing for coordinates that are not numbers', () => {
    // Never a silent default: an unusable position must produce an empty list
    // rather than the first hospital in the file.
    expect(nearestHospitals(undefined, undefined)).toEqual([]);
    expect(nearestHospitals(NaN, NaN)).toEqual([]);
  });

  it('finds a district by name, case-insensitively', () => {
    expect(hospitalForDistrict('lucknow')?.district).toBe('Lucknow');
    expect(hospitalForDistrict('Nowhere')).toBeNull();
  });
});

describe('coordinate bounds', () => {
  it('accepts positions inside India', () => {
    expect(withinIndia(LUCKNOW.lat, LUCKNOW.lon)).toBe(true);
    expect(withinIndia(DELHI.lat, DELHI.lon)).toBe(true);
  });

  it('rejects a fix that landed somewhere else entirely', () => {
    // The realistic bad fix: a VPN exit or a stale cache. Routing from it
    // names an Indian hospital with total confidence and no visible clue.
    expect(withinIndia(51.5074, -0.1278)).toBe(false);   // London
    expect(withinIndia(40.7128, -74.0060)).toBe(false);  // New York
    expect(withinIndia(0, 0)).toBe(false);               // null island
  });

  it('rejects values that are not finite numbers', () => {
    expect(withinIndia(NaN, 80)).toBe(false);
    expect(withinIndia(null, null)).toBe(false);
    expect(withinIndia(undefined, undefined)).toBe(false);
  });
});

describe('directions link', () => {
  it('builds a maps URL with both endpoints', () => {
    const url = directionsUrl(LUCKNOW.lat, LUCKNOW.lon, KANPUR.lat, KANPUR.lon);
    expect(url).toContain('https://www.google.com/maps/dir/');
    expect(url).toContain('travelmode=driving');
    expect(decodeURIComponent(url)).toContain(`origin=${LUCKNOW.lat},${LUCKNOW.lon}`);
    expect(decodeURIComponent(url)).toContain(`destination=${KANPUR.lat},${KANPUR.lon}`);
  });

  it('omits the origin when the position is unknown', () => {
    // Maps then starts from the device's own location, which is better than
    // navigating from a coordinate we chose not to trust.
    const url = directionsUrl(null, null, KANPUR.lat, KANPUR.lon);
    expect(url).not.toContain('origin=');
    expect(decodeURIComponent(url)).toContain(`destination=${KANPUR.lat},${KANPUR.lon}`);
  });

  it('returns nothing without a destination', () => {
    expect(directionsUrl(LUCKNOW.lat, LUCKNOW.lon, null, null)).toBeNull();
  });
});

describe('building a referral with no maps key', () => {
  const originalKey = process.env.GOOGLE_MAPS_API_KEY;
  beforeEach(() => { delete process.env.GOOGLE_MAPS_API_KEY; });
  afterEach(() => { if (originalKey) process.env.GOOGLE_MAPS_API_KEY = originalKey; });

  it('still produces a hospital, alternatives and a route', async () => {
    const r = await buildReferral({ districtName: 'Lucknow', lat: LUCKNOW.lat, lon: LUCKNOW.lon });
    expect(r.primary.name).toBeTruthy();
    expect(r.primary.directions_url).toContain('maps/dir');
    expect(r.alternatives).toHaveLength(2);
  });

  it('labels the distance as straight-line rather than implying a drive', async () => {
    const r = await buildReferral({ districtName: 'Lucknow', lat: LUCKNOW.lat, lon: LUCKNOW.lon });
    expect(r.distance_source).toBe('straight-line');
    expect(r.primary.driving_time_text).toBeUndefined();
  });

  it('falls back to the clinic district when there is no fix', async () => {
    // A denied permission must not cost the referral.
    const r = await buildReferral({ districtName: 'Kanpur Nagar', lat: null, lon: null });
    expect(r.primary).toBeTruthy();
    expect(r.primary.directions_url).toContain('maps/dir');
  });

  it('never claims to know bed availability', async () => {
    // MASTER_PLAN §0 item 2: an invented bed count is the single most
    // dangerous thing this screen could show.
    const r = await buildReferral({ districtName: 'Lucknow', lat: LUCKNOW.lat, lon: LUCKNOW.lon });
    expect(r.capacity_status).toBe('UNKNOWN');
    expect(r.capacity_instruction).toMatch(/confirm capacity/i);
    expect(JSON.stringify(r)).not.toMatch(/beds_available|free_beds|bed_count/i);
  });

  it('offers the national emergency lines, 108 first', async () => {
    const r = await buildReferral({ districtName: 'Lucknow', lat: LUCKNOW.lat, lon: LUCKNOW.lon });
    expect(r.emergency_line).toBe('108');
    expect(r.emergency_lines.map((l) => l.number)).toEqual(expect.arrayContaining(['108', '102', '112']));
  });
});

describe('when the maps API misbehaves', () => {
  const originalKey = process.env.GOOGLE_MAPS_API_KEY;
  const originalFetch = global.fetch;
  beforeEach(() => { process.env.GOOGLE_MAPS_API_KEY = 'test-key'; });
  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey) process.env.GOOGLE_MAPS_API_KEY = originalKey;
    else delete process.env.GOOGLE_MAPS_API_KEY;
  });

  it('still returns a referral when the call throws', async () => {
    global.fetch = async () => { throw new Error('network down'); };
    const r = await buildReferral({ districtName: 'Lucknow', lat: LUCKNOW.lat, lon: LUCKNOW.lon });
    expect(r.primary.name).toBeTruthy();
    expect(r.distance_source).toBe('straight-line');
  });

  it('still returns a referral when the call times out', async () => {
    global.fetch = async () => {
      const e = new Error('The operation was aborted');
      e.name = 'TimeoutError';
      throw e;
    };
    const r = await buildReferral({ districtName: 'Lucknow', lat: LUCKNOW.lat, lon: LUCKNOW.lon });
    expect(r.primary.straight_line_km).toBeGreaterThanOrEqual(0);
    expect(r.distance_source).toBe('straight-line');
  });

  it('ignores a response the API marks as not OK', async () => {
    // A rejected key answers 200 with status: REQUEST_DENIED inside the body,
    // which is exactly what an unrestricted or wrong key looks like.
    global.fetch = async () => ({
      json: async () => ({ rows: [{ elements: [{ status: 'REQUEST_DENIED' }] }] })
    });
    const r = await buildReferral({ districtName: 'Lucknow', lat: LUCKNOW.lat, lon: LUCKNOW.lon });
    expect(r.distance_source).toBe('straight-line');
    expect(r.primary.road_distance_km).toBeUndefined();
  });

  it('upgrades to road distance when the API answers properly', async () => {
    global.fetch = async () => ({
      json: async () => ({
        rows: [{ elements: [{ status: 'OK', distance: { value: 84500 }, duration: { text: '1 hour 52 mins' } }] }]
      })
    });
    const r = await buildReferral({ districtName: 'Lucknow', lat: LUCKNOW.lat, lon: LUCKNOW.lon });
    expect(r.distance_source).toBe('google-driving');
    expect(r.primary.road_distance_km).toBe(84.5);
    expect(r.primary.driving_time_text).toBe('1 hour 52 mins');
    // The route link must survive the enrichment that replaces `primary`.
    expect(r.primary.directions_url).toContain('maps/dir');
  });
});
