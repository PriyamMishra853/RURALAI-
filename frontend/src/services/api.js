import axios from 'axios';

const api = axios.create({
  // Configuration first, with the deployed backend as the fallback.
  //
  // This was hardcoded, so pointing the app at a local backend meant editing
  // source — and the deployed frontend could never be aimed anywhere else
  // either. The fallback stays the production URL rather than '/api', because
  // the frontend is served from a different origin than the API: '/api' would
  // resolve against Vercel, which serves no API at all.
  baseURL: import.meta.env.VITE_API_URL || 'https://ruralai-production-220.up.railway.app/api',
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
