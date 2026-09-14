import { getToken } from './session.js';
import { currentLang } from '../i18n/index.jsx';
import { plainT } from '../i18n/plain.js';
/**
 * Fetch a report PDF and hand it to the user.
 *
 * The route streams a PDF and requires the bearer token, so it is fetched and
 * turned into a blob rather than linked directly — a plain `<a href>` would
 * arrive unauthenticated.
 *
 * Three things this gets right that the inline versions did not:
 *
 *   The server's message survives. A refusal here is usually specific and
 *   actionable — "this visit has no AI assessment yet, run the assessment
 *   first" — and one call site replaced that with a flat "PDF failed", which
 *   tells the assistant nothing about what to do next.
 *
 *   A network failure says so. `fetch` rejects with the bare string "Failed to
 *   fetch", which surfaced to the user unchanged and reads like a bug in the
 *   report rather than a connection that dropped.
 *
 *   It opens via a download anchor rather than window.open. A popup opened
 *   from an async callback is outside the user-gesture stack, so browsers
 *   block it — the request succeeds, and nothing appears.
 *
 * The request carries the selected language, so the PDF the patient is handed
 * is in the language the consultation happened in. That is the document that
 * leaves the clinic and gets read at home without anybody to explain it, which
 * makes it the single place a translation matters most.
 */

const API_BASE = import.meta.env.VITE_API_URL || '/api';

/** Ask the server what went wrong, falling back to the status line. */
const describeFailure = async (res, t) => {
  try {
    const body = await res.json();
    if (body?.error) return body.error;
  } catch {
    // Not JSON — a proxy error page, or an empty body.
  }
  if (res.status === 401 || res.status === 403) {
    return t('report.forbidden', 'You are not permitted to download this report.');
  }
  if (res.status === 404) return t('report.noVisit', 'That visit could not be found.');
  return t('report.httpFailed', 'The report could not be generated (HTTP {status}).', { status: res.status });
};

/**
 * @param {string} visitId
 * @param {'summary'|'prescription'|'referral'} type
 * @param {{ patientName?: string, t?: Function }} [opts]  `t` translates the
 *        failure messages; omitted, they render in English.
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export const downloadVisitReport = async (visitId, type = 'summary', opts = {}) => {
  const t = opts.t || plainT;
  if (!visitId) return { ok: false, error: t('report.noVisit0', 'No visit selected.') };

  // This tab's token — a PDF must be fetched as whoever is signed in HERE.
  const token = getToken();
  let res;

  try {
    res = await fetch(`${API_BASE}/reports/visits/${visitId}/${type}.pdf`, {
      headers: {
        Authorization: `Bearer ${token}`,
        // This is a plain fetch, so it does not pass through the axios
        // interceptor that adds the language to every other request.
        'X-Language': currentLang()
      }
    });
  } catch {
    // fetch only rejects for transport failures — offline, DNS, CORS, a
    // blocked mixed-content request. None of those are about the report.
    return {
      ok: false,
      error: t('report.unreachable', 'Could not reach the server. Check the connection and try again.')
    };
  }

  if (!res.ok) return { ok: false, error: await describeFailure(res, t) };

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);

  // An anchor click, not window.open: this runs after an await, so the popup
  // blocker would stop a new window but permits a download.
  const safeName = (opts.patientName || 'patient').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName}-${type}.pdf`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();

  // Give the browser a moment to start reading it before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 30000);

  return { ok: true };
};
