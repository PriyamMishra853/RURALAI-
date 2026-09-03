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
const resolveApiBase = () => {
  const configured = String(import.meta.env.VITE_API_URL || '').trim();
  if (!configured) return DEPLOYED_API;

  if (!/^https?:\/\//i.test(configured)) {
    console.error(
      `[api] VITE_API_URL is "${configured}", which is not an http(s) address. `
      + `Ignoring it and using ${DEPLOYED_API}. `
      + `The websocket address belongs in VITE_REALTIME_URL, not here.`
    );
    return DEPLOYED_API;
  }

  // A base ending in /realtime is the socket endpoint, not the API root.
  if (/\/realtime\/?$/i.test(configured)) {
    console.error(
      `[api] VITE_API_URL points at the realtime endpoint. Using ${DEPLOYED_API} instead.`
    );
    return DEPLOYED_API;
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
const api = axios.create({
  baseURL: API_BASE,
  timeout: 20000,
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
    try { return new URL(API_BASE).host; } catch { return API_BASE; }
  })();

  if (error?.code === 'ECONNABORTED' || /timeout/i.test(error?.message || '')) {
    return `The server at ${host} did not answer within 20 seconds. The connection may be weak — try again.`;
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
