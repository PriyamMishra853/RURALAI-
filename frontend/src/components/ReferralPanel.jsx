import React, { useState, useCallback } from 'react';
import {
  Siren, MapPin, Navigation, Phone, Loader2, AlertTriangle, ChevronDown, ChevronUp
} from 'lucide-react';
import api from '../services/api';
import { Button, Card, cn } from './ui';

/**
 * Emergency referral — where to take this patient, and how to get there.
 *
 * Shown for EMERGENCY and HIGH cases only. Three rules shape everything here:
 *
 *   Location is requested on a tap, never on load. An unprompted permission
 *   dialog on a clinical screen is hostile, and browsers only reliably grant
 *   geolocation inside a user gesture anyway.
 *
 *   The screen always produces an answer. GPS, then the clinic's district,
 *   then a district the health worker picks — and it says which one it used,
 *   because "12 km away" from a district centroid is a different claim from
 *   12 km from where you are standing.
 *
 *   Nothing here implies a bed is free. There is no live bed feed for UP
 *   district hospitals; the phone number is at least as prominent as the route
 *   button, and the instruction to ring ahead is not collapsible. Sending a
 *   critical patient on a long drive to a hospital that cannot admit them is
 *   the worst thing this feature could cause.
 */

const COPY = {
  en: {
    title: 'Refer to hospital now',
    confirmFirst: 'Phone before you travel',
    confirmBody: 'Bed availability is not published live. Call and confirm the hospital can admit this patient before setting off.',
    call: 'Call 108 — ambulance',
    directions: 'Start directions',
    locating: 'Finding your location…',
    useLocation: 'Use my location for accurate distance',
    alternatives: 'Other hospitals',
    straightLine: 'straight-line distance',
    byRoad: 'by road',
    fromDistrict: 'Distance measured from your clinic district — location not available',
    fromGps: 'Distance from your current location',
    insecure: 'Location needs a secure (https) connection. Open the main site address rather than a preview link.',
    denied: 'Location permission is blocked for this site. Allow it in your browser settings, or continue with your clinic district.',
    noFix: 'No location fix yet — showing distance from your clinic district.',
    noGeo: 'This device cannot report a location — showing distance from your clinic district.',
    outOfBounds: 'That location reading looked wrong, so your clinic district was used instead.',
    loadFailed: 'Could not load hospital details. Call 108 for an ambulance.'
  },
  hi: {
    title: 'अभी अस्पताल भेजें',
    confirmFirst: 'जाने से पहले फ़ोन करें',
    confirmBody: 'बिस्तर की उपलब्धता लाइव नहीं मिलती। मरीज़ को ले जाने से पहले फ़ोन करके पुष्टि करें कि अस्पताल भर्ती कर सकता है।',
    call: '108 पर कॉल करें — एम्बुलेंस',
    directions: 'रास्ता देखें',
    locating: 'आपकी लोकेशन खोजी जा रही है…',
    useLocation: 'सही दूरी के लिए मेरी लोकेशन लें',
    alternatives: 'अन्य अस्पताल',
    straightLine: 'सीधी दूरी',
    byRoad: 'सड़क मार्ग से',
    fromDistrict: 'दूरी आपके ज़िले से मापी गई — लोकेशन उपलब्ध नहीं',
    fromGps: 'आपकी वर्तमान लोकेशन से दूरी',
    insecure: 'लोकेशन के लिए सुरक्षित (https) कनेक्शन चाहिए। प्रीव्यू लिंक नहीं, मुख्य साइट पता खोलें।',
    denied: 'इस साइट के लिए लोकेशन की अनुमति बंद है। ब्राउज़र सेटिंग में चालू करें, या ज़िले से दूरी देखें।',
    noFix: 'अभी लोकेशन नहीं मिली — आपके ज़िले से दूरी दिखाई जा रही है।',
    noGeo: 'यह डिवाइस लोकेशन नहीं बता सकता — ज़िले से दूरी दिखाई जा रही है।',
    outOfBounds: 'लोकेशन ठीक नहीं लगी, इसलिए आपके ज़िले से दूरी दिखाई गई है।',
    loadFailed: 'अस्पताल की जानकारी नहीं मिली। एम्बुलेंस के लिए 108 पर कॉल करें।'
  }
};

/** One hospital, with its distance labelled for how it was derived. */
function Hospital({ h, t, compact }) {
  const km = h.road_distance_km ?? h.straight_line_km;
  const label = h.road_distance_km != null ? t.byRoad : t.straightLine;
  return (
    <div className={compact ? 'py-2' : ''}>
      <p className={compact ? 'text-sm font-semibold text-ink' : 'text-lg font-bold text-ink'}>{h.name}</p>
      <p className="text-xs text-ink-muted flex items-center gap-1.5 mt-0.5">
        <MapPin className="w-3.5 h-3.5 shrink-0" />
        {h.district}
        {km != null && <> · {km} km {label}</>}
        {h.driving_time_text && <> · {h.driving_time_text}</>}
      </p>
    </div>
  );
}

export default function ReferralPanel({ visitId, riskLevel, language = 'Hindi', className }) {
  const tier = String(riskLevel || '').toUpperCase();
  const applies = tier === 'EMERGENCY' || tier === 'HIGH';

  const t = COPY[language === 'English' ? 'en' : 'hi'];
  const en = COPY.en;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState(null);
  const [showAlts, setShowAlts] = useState(false);

  const fetchReferral = useCallback(async (coords) => {
    setLoading(true);
    try {
      const res = await api.post('/referral/nearest-hospital', {
        visit_id: visitId,
        latitude: coords?.latitude ?? null,
        longitude: coords?.longitude ?? null,
        accuracy_m: coords?.accuracy ?? null
      });
      setData(res.data);
      if (res.data?.origin?.rejected_out_of_bounds) {
        setNote(t.outOfBounds);
      }
    } catch {
      // Never leave the screen empty during an emergency: the national
      // ambulance line is the one thing that is always correct.
      setNote(t.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [visitId, t]);

  /**
   * Ask for a position, then route — but never wait indefinitely, and never
   * fail silently.
   *
   * Three things stop a fix arriving and they need different answers, where
   * before they collapsed into one sentence that fitted none of them:
   *
   *   The page is not on a secure origin. Browsers refuse geolocation outright
   *   over plain http, and that refusal is indistinguishable from a denied
   *   permission. It is worth naming, because it is fixed by opening the real
   *   site address — tapping again will never work.
   *
   *   Permission was denied. Also not fixed by tapping again; the block has to
   *   be lifted in the browser's own site settings.
   *
   *   No fix yet. The common case, and it was treated as fatal after eight
   *   seconds. A cold GPS fix indoors — which is where a sub-centre consultation
   *   happens — routinely takes longer than that, so the timeout fired on
   *   almost every first attempt and the screen quietly fell back to a district
   *   centroid. It now waits longer, and on a timeout asks again without the
   *   satellite requirement: Wi-Fi and cell positioning answer in a second or
   *   two, and a few hundred metres of error still beats a centroid tens of
   *   kilometres away.
   */
  const locateAndFetch = useCallback(() => {
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      setNote(t.insecure);
      fetchReferral(null);
      return;
    }
    if (!navigator.geolocation) {
      setNote(t.noGeo);
      fetchReferral(null);
      return;
    }

    setLocating(true);
    const done = (pos) => { setLocating(false); setNote(null); fetchReferral(pos.coords); };
    const giveUp = (msg) => { setLocating(false); setNote(msg); fetchReferral(null); };

    navigator.geolocation.getCurrentPosition(
      done,
      (err) => {
        if (err.code === err.PERMISSION_DENIED) { giveUp(t.denied); return; }
        navigator.geolocation.getCurrentPosition(
          done,
          (e2) => giveUp(e2.code === e2.PERMISSION_DENIED ? t.denied : t.noFix),
          { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
        );
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 }
    );
  }, [fetchReferral, t]);

  if (!applies) return null;

  const primary = data?.primary;
  const busy = loading || locating;

  return (
    <Card className={cn('border-2 border-tier-emergency', className)}>
      <div className="bg-tier-emergency px-4 py-2.5">
        <p className="text-white font-bold text-sm flex items-center gap-2">
          <Siren className="w-4 h-4" /> {t.title}
          {t !== en && <span className="font-normal opacity-80">· {en.title}</span>}
        </p>
      </div>

      <div className="p-4 space-y-4">
        {/* Ring ahead. Above the route button, and never collapsible: this is
            the instruction that stops a patient being driven somewhere that
            cannot admit them. */}
        <div className="p-3 rounded-field bg-tier-emergencyBg border border-tier-emergency/30">
          <p className="text-xs font-bold text-tier-emergency flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {t.confirmFirst}
          </p>
          <p className="text-[11px] text-ink mt-1">{t.confirmBody}</p>
          {t !== en && <p className="text-[11px] text-ink-muted mt-1">{en.confirmBody}</p>}
        </div>

        <a
          href="tel:108"
          className="flex items-center justify-center gap-2 w-full py-3.5 rounded-field bg-tier-emergency text-white font-bold text-base hover:opacity-90 transition-opacity"
        >
          <Phone className="w-5 h-5" /> {t.call}
        </a>

        {!data && !busy && (
          <Button variant="secondary" className="w-full" onClick={locateAndFetch}>
            <Navigation className="w-4 h-4" /> {t.useLocation}
          </Button>
        )}

        {busy && (
          <p className="text-xs text-ink-muted flex items-center gap-2 justify-center py-2">
            <Loader2 className="w-4 h-4 animate-spin" /> {t.locating}
          </p>
        )}

        {note && <p className="text-[11px] text-tier-moderate">{note}</p>}

        {primary && (
          <div className="space-y-3">
            <Hospital h={primary} t={t} />

            {/* How the distance was derived, said plainly — a centroid figure
                and a real one are different claims. */}
            <p className="text-[11px] text-ink-subtle">
              {data.origin?.source === 'gps' ? t.fromGps : t.fromDistrict}
            </p>

            {primary.directions_url && (
              <a
                href={primary.directions_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-3 rounded-field border-2 border-gov-600 text-gov-700 dark:text-gov-500 font-semibold text-sm hover:bg-gov-50 dark:hover:bg-gov-100 transition-colors"
              >
                <Navigation className="w-4 h-4" /> {t.directions}
              </a>
            )}

            {data.alternatives?.length > 0 && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowAlts((v) => !v)}
                  className="text-[11px] text-ink-muted hover:text-ink flex items-center gap-1"
                >
                  {showAlts ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  {t.alternatives} ({data.alternatives.length})
                </button>
                {showAlts && (
                  <div className="mt-2 divide-y divide-line border-t border-line">
                    {data.alternatives.map((h) => (
                      <div key={h.name} className="flex items-center justify-between gap-3 py-2">
                        <Hospital h={h} t={t} compact />
                        {h.directions_url && (
                          <a
                            href={h.directions_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 text-[11px] text-gov-600 dark:text-gov-500 font-semibold hover:underline"
                          >
                            {t.directions}
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* The other national lines, secondary to 108 but always present. */}
        {data?.emergency_lines && (
          <div className="flex flex-wrap gap-2 pt-1">
            {data.emergency_lines.filter((l) => l.number !== '108').map((l) => (
              <a
                key={l.number}
                href={`tel:${l.number}`}
                title={l.label}
                className="px-2.5 py-1.5 rounded-field border border-line text-[11px] font-semibold text-ink-muted hover:bg-surface-sunken"
              >
                {l.number}
              </a>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
