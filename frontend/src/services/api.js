import axios from 'axios';

const DEPLOYED_API = 'https://ruralai-production-220.up.railway.app/api';

/**
 * Where the API lives.
 *
 * Configuration first, so a local backend needs no source edit — but validated,
 * because an unusable value here breaks every request in the application with
 * no clue as to why.
 *
 * That is not hypothetical. VITE_API_URL was once set to the realtime socket
 * address, `wss://…/realtime`, almost certainly while VITE_REALTIME_URL was
 * being fixed. axios cannot speak wss, so every call failed at the transport
 * layer and the login screen reported it as a wrong password. Only an http(s)
 * URL is accepted; anything else is refused loudly and the deployed API used
 * instead, so a misconfigured variable degrades to "the app still works" rather
 * than "nothing works and the reason is invisible".
 */
/**
 * Same-origin when the app is served from Vercel, absolute otherwise.
 *
 * vercel.json proxies /api/* through to the backend, so on the deployed site
 * the browser can talk to its own origin instead of a second domain. That
 * removes, from every single request: a DNS lookup, a TLS handshake, and — for
 * anything that is not a simple GET — a CORS preflight round trip.
 *
 * On a laptop those cost about a second and nobody notices. On a phone on a
 * weak rural link they are three more things that can fail before the request
 * carrying the password has even started, and a failure there is reported as
 * "could not reach the server" with nothing to distinguish it from the backend
 * being down. The page itself had already loaded over this exact connection,
 * which is the point: reuse the path that is demonstrably working.
 *
 * Only for *.vercel.app, because that is where the rewrite is deployed
 * alongside this bundle and the two therefore cannot drift apart. Anywhere
 * else — localhost, a custom domain, a preview — keeps the explicit URL.
 */
const sameOriginProxyAvailable = () =>
  typeof window !== 'undefined'
  && window.location.protocol === 'https:'
  && /\.vercel\.app$/i.test(window.location.hostname);

const resolveApiBase = () => {
  /*
   * The best base available when configuration cannot be used.
   *
   * Computed once and returned from every rejection branch below. Returning
   * the absolute backend URL here instead was a real bug: VITE_API_URL is set
   * on the deployed site — to the websocket address — so every request took a
   * rejection branch, and the same-origin path was never reached in the one
   * environment it was written for.
   */
  const fallback = sameOriginProxyAvailable() ? '/api' : DEPLOYED_API;

  const configured = String(import.meta.env.VITE_API_URL || '').trim();
  if (!configured) return fallback;

  // An explicitly relative base is same-origin and needs no validation — the
  // checks below exist to catch a websocket URL, which cannot be relative.
  if (configured.startsWith('/')) return configured.replace(/\/+$/, '') || '/api';

  if (!/^https?:\/\//i.test(configured)) {
    console.error(
      `[api] VITE_API_URL is "${configured}", which is not an http(s) address. `
      + `Ignoring it and using ${fallback}. `
      + `The websocket address belongs in VITE_REALTIME_URL, not here.`
    );
    return fallback;
  }

  // A base ending in /realtime is the socket endpoint, not the API root.
  if (/\/realtime\/?$/i.test(configured)) {
    console.error(`[api] VITE_API_URL points at the realtime endpoint. Using ${fallback} instead.`);
    return fallback;
  }

  return configured.replace(/\/+$/, '');
};

const API_BASE = resolveApiBase();

/*
 * A request that never finishes is worse than one that fails.
 *
 * There was no timeout at all, so on a weak mobile connection a request could
 * hang indefinitely: the spinner never stopped and the user was told nothing.
 * Twenty seconds is generous for this API — the slowest endpoint is an AI
 * assessment, and even that answers well inside it — while still failing fast
 * enough that a retry is worth attempting.
 */
const DEFAULT_TIMEOUT_MS = 20000;

/*
 * Anything carrying a file gets a far longer deadline than an ordinary request.
 *
 * Twenty seconds was chosen when the slowest call was a JSON assessment. It is
 * nowhere near enough for the endpoints that carry a photograph. Measured
 * against production: /vision/analyze answers in 41-59s and a document upload
 * in 30-41s, because the file has to climb a rural uplink and then a vision
 * model has to read it. Every one of those was aborted at 20s and reported to
 * the health worker as an unreachable server, while the backend went on to
 * answer correctly into a socket nobody was listening to. That is what made the
 * failure intermittent: the request never had a chance, but a smaller photo
 * occasionally squeaked under the wire, so the feature looked flaky rather than
 * broken.
 *
 * The 20s ceiling was the client's alone. Vercel's proxy passes a 46s call
 * straight through, so nothing in front of the API imposes a shorter limit.
 */
const SLOW_PATHS = [/^\/?(vision|documents|ai|voice)\//];
const SLOW_TIMEOUT_MS = 120000;

export const timeoutFor = (url = '') =>
  SLOW_PATHS.some((re) => re.test(url)) ? SLOW_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;

const api = axios.create({
  baseURL: API_BASE,
  timeout: DEFAULT_TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' }
});

/**
 * Describe a transport failure in terms someone can act on.
 *
 * axios leaves `response` undefined when the request never reached the server,
 * and every such case previously surfaced as the same opaque sentence. On a
 * phone that is the common failure — a dropped packet on a train, a captive
 * portal, a carrier hiccup — and "could not reach the server" gives no way to
 * tell that from a genuinely misconfigured address. Naming the host and the
 * cause is what makes it reportable.
 */
export const describeTransportFailure = (error) => {
  const host = (() => {
    // A same-origin base has no host of its own; name the site instead, which
    // is what the person is actually looking at.
    if (API_BASE.startsWith('/')) {
      return typeof window !== 'undefined' ? window.location.host : 'this site';
    }
    try { return new URL(API_BASE).host; } catch { return API_BASE; }
  })();

  if (error?.code === 'ECONNABORTED' || /timeout/i.test(error?.message || '')) {
    const secs = Math.round((error?.config?.timeout || DEFAULT_TIMEOUT_MS) / 1000);
    return `The server at ${host} did not answer within ${secs} seconds. The connection may be weak — try again.`;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'This device is offline. Reconnect and try again.';
  }
  return `Could not reach ${host}. Check the connection, and make sure you are on the main site address rather than a preview link.`;
};

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('vvc_token');

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // Applied here rather than at each call site so a new upload screen cannot
  // reintroduce the bug by forgetting to ask for more time.
  if (config.timeout === DEFAULT_TIMEOUT_MS || config.timeout == null) {
    config.timeout = timeoutFor(config.url || '');
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    /*
     * Retry a transport failure once, for GETs only.
     *
     * A single dropped request is the normal texture of a mobile network, and
     * one retry turns most of them into a slightly slow page rather than an
     * error the user has to act on. Restricted to GET because a POST that
     * failed in transit may still have been received — retrying a handoff or a
     * doctor's review could duplicate a clinical record.
     */
    const cfg = error.config;
    const isTransport = !error.response;
    const isGet = String(cfg?.method || 'get').toLowerCase() === 'get';
    if (isTransport && isGet && cfg && !cfg.__retried) {
      cfg.__retried = true;
      await new Promise((r) => setTimeout(r, 800));
      return api.request(cfg);
    }

    const status = error.response?.status;
    const message = error.response?.data?.error || '';

    const sessionDead =
      status === 401 ||
      (status === 403 &&
        /no longer active|no staff profile|no usable role/i.test(message));

    if (sessionDead && localStorage.getItem('vvc_token')) {
      localStorage.removeItem('vvc_token');
      localStorage.removeItem('vvc_user');

      if (!window.location.pathname.startsWith('/login')) {
        window.location.assign('/login');
      }
    }

    return Promise.reject(error);
  }
);

export default api;
