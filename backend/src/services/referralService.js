import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * HIGH-risk referral routing.
 *
 * Finds the nearest district hospital from real coordinates. No Google Maps key
 * is required, which matters for two reasons: a rural sub-centre may be on a
 * poor link when this screen is needed most, and a referral must not fail
 * because a billing quota was exceeded.
 *
 * If GOOGLE_MAPS_API_KEY is set, straight-line distance is upgraded to live
 * driving distance and time — but the straight-line answer is always computed
 * first and returned if that call fails, so the screen always has an answer.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.resolve(__dirname, '../../../AI/LLM/data/up_district_hospitals.json');

let HOSPITALS = [];
try {
  HOSPITALS = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')).hospitals || [];
} catch (err) {
  console.error(`Referral data could not be loaded from ${DATA_PATH}: ${err.message}`);
}

const EARTH_RADIUS_KM = 6371;
const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in km. */
export const haversineKm = (aLat, aLon, bLat, bLon) => {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
};

/** The district hospital for a named district, if we have one. */
export const hospitalForDistrict = (districtName) =>
  HOSPITALS.find((h) => h.district.toLowerCase() === String(districtName || '').toLowerCase()) || null;

/**
 * Nearest hospitals to a point, closest first.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {number} limit
 */
export const nearestHospitals = (lat, lon, limit = 3) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  return HOSPITALS
    .map((h) => ({ ...h, straight_line_km: Number(haversineKm(lat, lon, h.lat, h.lon).toFixed(1)) }))
    .sort((a, b) => a.straight_line_km - b.straight_line_km)
    .slice(0, limit);
};

/**
 * Build the referral payload the danger-zone screen renders.
 *
 * `capacity` is deliberately absent. There is no public real-time bed feed for
 * UP district hospitals, so the screen instructs the assistant to confirm by
 * phone rather than showing a number that would be invented. See the _meta
 * block in up_district_hospitals.json.
 */
export const buildReferral = async ({ districtName, lat, lon }) => {
  const home = hospitalForDistrict(districtName);
  const originLat = Number.isFinite(lat) ? lat : home?.lat;
  const originLon = Number.isFinite(lon) ? lon : home?.lon;

  const options = nearestHospitals(originLat, originLon, 3);
  const primary = options[0] || home || null;

  const referral = {
    primary,
    alternatives: options.slice(1),
    emergency_line: '108',
    // Stated explicitly so the UI cannot quietly imply we know bed status.
    capacity_status: 'UNKNOWN',
    capacity_instruction:
      'Bed and room availability is not published as a live feed. Call the hospital or 108 to confirm capacity before transporting the patient.',
    distance_source: 'straight-line'
  };

  if (process.env.GOOGLE_MAPS_API_KEY && primary && Number.isFinite(originLat)) {
    try {
      const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
      url.searchParams.set('origins', `${originLat},${originLon}`);
      url.searchParams.set('destinations', `${primary.lat},${primary.lon}`);
      url.searchParams.set('mode', 'driving');
      url.searchParams.set('key', process.env.GOOGLE_MAPS_API_KEY);

      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      const body = await res.json();
      const element = body?.rows?.[0]?.elements?.[0];
      if (element?.status === 'OK') {
        referral.primary = {
          ...primary,
          road_distance_km: Number((element.distance.value / 1000).toFixed(1)),
          driving_time_text: element.duration.text
        };
        referral.distance_source = 'google-driving';
      }
    } catch (err) {
      // Straight-line answer already stands; a routing outage must not blank
      // the referral screen during an emergency.
      console.warn('Driving-distance lookup failed, using straight-line:', err.message);
    }
  }

  return referral;
};

export const referralDataLoaded = () => HOSPITALS.length;
