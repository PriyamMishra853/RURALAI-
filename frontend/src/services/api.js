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

const api = axios.create({
  baseURL: resolveApiBase(),
  headers: { 'Content-Type': 'application/json' }
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('vvc_token');

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
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
