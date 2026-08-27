js
import axios from 'axios';

const api = axios.create({
  baseURL: 'https://ruralai-production-220.up.railway.app',
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
