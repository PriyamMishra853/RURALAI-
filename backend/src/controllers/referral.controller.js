import { supabaseAdmin } from '../config/supabase.js';
import { logAuditEvent } from '../middleware/audit.middleware.js';
import { buildReferral, withinIndia } from '../services/referralService.js';

/**
 * Emergency referral routing.
 *
 * Answers one question: given where the health worker is standing, which
 * district hospital should this patient be taken to, and how do they get
 * there.
 *
 * The computation stays on the server because the hospital list is a data file
 * the browser has no business downloading, and because the referral has to be
 * recorded whether or not the screen survives the next thirty seconds.
 *
 * Everything here works with no API key. A maps key only ever upgrades a
 * straight-line distance to a driving time — see referralService — and its
 * absence changes nothing about whether a referral can be produced.
 */

/**
 * POST /api/referral/nearest-hospital
 *   { latitude?, longitude?, accuracy_m?, visit_id?, district? }
 *
 * Coordinates are optional on purpose. A denied permission, a phone with no
 * fix, a basement with no signal — none of those may stop a referral, so the
 * clinic's own district is the fallback and the response says which was used.
 */
export const nearestHospital = async (req, res) => {
  const { latitude, longitude, accuracy_m, visit_id } = req.body || {};

  const lat = Number(latitude);
  const lon = Number(longitude);
  const supplied = Number.isFinite(lat) && Number.isFinite(lon);

  /*
   * A fix outside India is rejected rather than trusted.
   *
   * Browser geolocation can be confidently wrong — a stale cache, a VPN exit,
   * a desktop guessing from an IP block. Routing from a bad fix produces a
   * hospital in the wrong part of the country stated with the same certainty
   * as a good one, and nothing on the screen would reveal it. Falling back to
   * the district the clinic is actually in is always the safer answer.
   */
  const usable = supplied && withinIndia(lat, lon);
  const rejected = supplied && !usable;

  // The district name comes from the caller's own profile, never the request,
  // so a client cannot route a referral through someone else's district.
  let districtName = null;
  if (req.user.districtId) {
    const { data } = await supabaseAdmin
      .from('districts').select('name').eq('id', req.user.districtId).maybeSingle();
    districtName = data?.name || null;
  }

  const referral = await buildReferral({
    districtName,
    lat: usable ? lat : null,
    lon: usable ? lon : null
  });

  const originSource = usable ? 'gps' : 'district';

  /*
   * Record what was shown, at the moment it was shown.
   *
   * Sending a patient to a hospital is a clinical decision, and the enquiry
   * afterwards asks what the health worker was looking at — including whether
   * the distance came from a real fix or from a district centroid, because
   * those can name different hospitals.
   *
   * A failure here must not block the referral. The screen is the urgent
   * thing; the record is important but it is not what keeps the patient alive.
   */
  if (referral.primary) {
    const { error } = await supabaseAdmin.from('referrals').insert([{
      visit_id: visit_id || null,
      risk_level: null,
      origin_lat: usable ? lat : (referral.primary.lat ?? null),
      origin_lon: usable ? lon : (referral.primary.lon ?? null),
      origin_source: originSource,
      origin_accuracy_m: Number.isFinite(Number(accuracy_m)) ? Number(accuracy_m) : null,
      hospital_name: referral.primary.name,
      hospital_district: referral.primary.district,
      hospital_lat: referral.primary.lat,
      hospital_lon: referral.primary.lon,
      distance_km: referral.primary.road_distance_km ?? referral.primary.straight_line_km ?? null,
      distance_source: referral.distance_source,
      eta_text: referral.primary.driving_time_text || null,
      referred_by: req.user.id,
      district_id: req.user.districtId || null
    }]);
    if (error) console.error('referral record insert failed:', error.message);
  }

  await logAuditEvent({
    actorId: req.user.id, actorRole: req.user.role,
    action: 'REFERRAL_ROUTED', entityType: 'VISITS', entityId: visit_id || null,
    metadata: { hospital: referral.primary?.name, origin_source: originSource },
    ip: req.ip
  });

  return res.json({
    ...referral,
    origin: {
      source: originSource,
      // Said plainly so the screen can label it rather than implying a
      // precision the number does not have.
      label: usable
        ? 'Distance from your current location'
        : `Distance from ${districtName || 'your clinic district'} — location unavailable`,
      rejected_out_of_bounds: rejected
    }
  });
};
