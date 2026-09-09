import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { rankFacilities, estimateTravelMinutes, CAPABILITIES } from './facilityRanking.js';

/**
 * EMERGENCY and HIGH referral routing.
 *
 * Ranks credible nearby facilities — government and private — by what they can
 * treat, what they will cost the family, how good they are and how far away
 * they are, in that order. facilityRanking.js holds the decision itself; this
 * file finds the candidates, measures them and assembles the payload.
 *
 * No Google Maps key is required, which matters for two reasons: a rural
 * sub-centre may be on a poor link when this screen is needed most, and a
 * referral must not fail because a billing quota was exceeded.
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
 * What this case actually needs a facility to be able to do.
 *
 * Derived here, on the server, from the assessment — never accepted from the
 * client. A request that could name its own required capabilities could also
 * name none, and quietly turn the capability gate off.
 *
 * Conservative by construction: a keyword that might mean obstetric
 * haemorrhage adds both obstetric care and a blood bank, because the cost of
 * over-specifying is a slightly longer drive and the cost of under-specifying
 * is arriving somewhere that cannot help.
 */
export const capabilitiesForCase = ({ tier, text = '', ageYears = null } = {}) => {
  const t = String(text || '').toLowerCase();
  const needs = new Set();

  const any = (...words) => words.some((w) => t.includes(w));

  if (any('injur', 'fracture', 'accident', 'trauma', 'burn', 'road traffic', 'fall from'))
    needs.add('trauma');

  if (any('pregnan', 'post-partum', 'postpartum', 'delivery', 'labour', 'labor',
          'eclampsia', 'obstetric', 'p/v bleed', 'per vaginal'))
    { needs.add('obstetric'); needs.add('blood_bank'); }

  if (any('bleed', 'haemorrhage', 'hemorrhage', 'anaemia', 'anemia', 'transfusion'))
    needs.add('blood_bank');

  if (any('chest pain', 'cardiac', 'heart attack', 'myocardial', 'angina', 'palpitation'))
    needs.add('cardiac');

  if (Number.isFinite(ageYears) && ageYears < 12) needs.add('paediatric');

  // An unstable patient needs somewhere that can hold them, whatever the cause.
  if (String(tier).toUpperCase() === 'EMERGENCY') needs.add('icu');

  return [...needs].filter((c) => CAPABILITIES.includes(c));
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
export const buildReferral = async ({ districtName, lat, lon, tier = 'HIGH', required = [] }) => {
  const home = hospitalForDistrict(districtName);
  const originLat = Number.isFinite(lat) ? lat : home?.lat;
  const originLon = Number.isFinite(lon) ? lon : home?.lon;

  /*
   * Only what the screen needs, over a link that may be barely working.
   *
   * `sources` is per-field provenance for the dataset — it belongs in the file
   * and in review, not in a response a phone downloads during an emergency;
   * with three facilities it was the largest thing in the payload.
   *
   * `bed_count` is surfaced as `licensed_beds`. It is static licensed capacity
   * and NOT a live free-bed count, and naming it so is the difference between
   * a quality signal and a dangerous implication. Nothing on this screen knows
   * whether a bed is free — see capacity_status.
   */
  const withRoute = (h) => {
    if (!h) return null;
    const { sources, bed_count: bedCount, ...rest } = h;
    return {
      ...rest,
      licensed_beds: bedCount ?? null,
      directions_url: directionsUrl(originLat, originLon, h.lat, h.lon)
    };
  };

  /*
   * Rank a wider candidate pool than we return.
   *
   * Taking the three nearest and then ranking those would let distance make
   * the decision before capability ever got a vote — the exact failure this
   * feature exists to fix. Twelve is deep enough that a capable or empanelled
   * facility a little further out can win, and shallow enough to stay
   * instant with no network call.
   */
  const pool = nearestHospitals(originLat, originLon, 12).map((h) => ({
    ...h,
    travel_minutes: estimateTravelMinutes(h.straight_line_km),
    travel_time_source: 'estimated'
  }));

  const options = rankFacilities({ facilities: pool, tier, required, limit: 3 }).map(withRoute);
  const primary = options[0] || withRoute(home) || null;

  const referral = {
    primary,
    alternatives: options.slice(1),
    // Real, nationally published emergency numbers — not invented, and the
    // only contact details on this screen we can actually stand behind.
    // Direct hospital switchboard numbers are NOT listed: there is no
    // authoritative public register of them, and a wrong number on a referral
    // screen costs minutes at exactly the wrong moment.
    // The numbers are national and never change; only the description of each
    // is prose, so each carries a catalogue key the browser renders.
    emergency_lines: [
      { number: '108', label_key: 'emergency.108', label: 'Emergency ambulance (free, 24x7)' },
      { number: '102', label_key: 'emergency.102', label: 'Maternal & child health ambulance' },
      { number: '104', label_key: 'emergency.104', label: 'Health helpline / advice' },
      { number: '112', label_key: 'emergency.112', label: 'National emergency number' }
    ],
    emergency_line: '108',
    // Returned so the screen, and anyone reading the audit row later, can see
    // what the ranking was actually asked to optimise for.
    tier,
    required_capabilities: required,
    ranking: 'capability > affordability (PM-JAY) > quality (NABH, type, beds) > travel time',
    rating_disclaimer_key: 'referral.ratingDisclaimer',
    rating_disclaimer: 'Public review scores are shown only where available and are not a measure of clinical quality.',
    // Stated explicitly so the UI cannot quietly imply we know bed status.
    capacity_status: 'UNKNOWN',
    // The single most important sentence on the emergency screen: it is what
    // stops a critical patient being driven to a hospital that cannot admit
    // them. It has to be readable by whoever is making that decision.
    capacity_instruction_key: 'referral.capacityInstruction',
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
