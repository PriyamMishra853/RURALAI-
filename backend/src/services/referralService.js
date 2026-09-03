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
 * Is this a plausible position in India?
 *
 * A browser geolocation fix can be wildly wrong — a stale cache, a VPN, a
 * desktop guessing from an IP block — and a referral computed from a bad fix
 * names a hospital in the wrong part of the country with total confidence.
 * Rejecting the fix and falling back to the clinic's own district is always
 * better than routing a critical patient off the map.
 *
 * Bounds are mainland India plus a margin, not UP: a health worker near a
 * state border legitimately sits outside UP while the nearest district
 * hospital is still the right answer.
 */
export const withinIndia = (lat, lon) =>
  Number.isFinite(lat) && Number.isFinite(lon)
  && lat >= 6.0 && lat <= 37.5
  && lon >= 68.0 && lon <= 97.5;

/**
 * A link that hands off to whatever maps app the device already has.
 *
 * Deliberately a URL and not an embedded map. On a phone this opens the native
 * Maps application with navigation already running, which is what someone
 * needs while standing next to a critical patient; an embedded widget would
 * need a key, a map SDK download over a rural link, and would still leave them
 * to start navigation themselves.
 */
export const directionsUrl = (fromLat, fromLon, toLat, toLon) => {
  if (!Number.isFinite(toLat) || !Number.isFinite(toLon)) return null;
  const destination = `${toLat},${toLon}`;
  const params = new URLSearchParams({ api: '1', destination, travelmode: 'driving' });
  // Origin is omitted when unknown, which makes Maps start from the device's
  // own position — better than sending it from a coordinate we do not trust.
  if (Number.isFinite(fromLat) && Number.isFinite(fromLon)) {
    params.set('origin', `${fromLat},${fromLon}`);
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
};

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

  const withRoute = (h) => (h ? { ...h, directions_url: directionsUrl(originLat, originLon, h.lat, h.lon) } : null);

  const options = nearestHospitals(originLat, originLon, 3).map(withRoute);
  const primary = options[0] || withRoute(home) || null;

  const referral = {
    primary,
    alternatives: options.slice(1),
    // Real, nationally published emergency numbers — not invented, and the
    // only contact details on this screen we can actually stand behind.
    // Direct hospital switchboard numbers are NOT listed: there is no
    // authoritative public register of them, and a wrong number on a referral
    // screen costs minutes at exactly the wrong moment.
    emergency_lines: [
      { number: '108', label: 'Emergency ambulance (free, 24x7)' },
      { number: '102', label: 'Maternal & child health ambulance' },
      { number: '104', label: 'Health helpline / advice' },
      { number: '112', label: 'National emergency number' }
    ],
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
        // primary already carries directions_url; spreading keeps it.
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
