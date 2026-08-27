import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: { 'Content-Type': 'application/json' }
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('vvc_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/**
 * Drop the session when the API says the credential is no longer good.
 *
 * 401 means the token is invalid or expired. 403 with this specific code means
 * the account was suspended or its role was removed while a session was open —
 * without this the app keeps rendering a dashboard whose every request fails.
 *
 * A plain 403 is left alone: that is an authorised user hitting something
 * outside their role, which should surface as an error, not a sign-out.
 */
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const message = error.response?.data?.error || '';
    const sessionDead =
      status === 401 ||
      (status === 403 && /no longer active|no staff profile|no usable role/i.test(message));

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
