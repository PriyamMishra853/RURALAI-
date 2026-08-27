import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import api from '../services/api';
import { useAuth } from './AuthContext';

/**
 * One authenticated WebSocket for the whole app.
 *
 * Carries notifications and call signalling on the same connection, matching
 * the backend hub. A single socket rather than one per feature means a doctor
 * with the queue and a call open is not holding two sockets, and reconnect
 * logic lives in exactly one place.
 *
 * Unread counts come from the API on load, then move live — a doctor whose
 * laptop was asleep still sees what happened while they were away, because
 * every event was persisted before it was pushed.
 */

const RealtimeContext = createContext(null);

const RECONNECT_BASE_MS = 1000;
const MAX_RECONNECT_MS = 15000;

export function RealtimeProvider({ children }) {
  const { token, user } = useAuth();
  const [connected, setConnected] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);

  const wsRef = useRef(null);
  const attemptsRef = useRef(0);
  const timerRef = useRef(null);
  const closedByUsRef = useRef(false);
  /** Feature-specific listeners (the call screen registers one). */
  const listenersRef = useRef(new Set());

  const subscribe = useCallback((fn) => {
    listenersRef.current.add(fn);
    return () => listenersRef.current.delete(fn);
  }, []);

  const sendMessage = useCallback((payload) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get('/notifications', { params: { limit: 30 } });
      setNotifications(res.data.notifications || []);
      setUnread(res.data.unread || 0);
    } catch {
      // A failed inbox fetch must not break the page it is mounted on.
    }
  }, []);

  const markAllRead = useCallback(async () => {
    setUnread(0);
    setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
    try { await api.post('/notifications/read', {}); } catch { /* retried on next load */ }
  }, []);

  useEffect(() => {
    if (!token || !user) {
      // Signed out — drop the socket rather than leaving it authenticated as
      // the previous user.
      closedByUsRef.current = true;
      wsRef.current?.close();
      wsRef.current = null;
      setConnected(false);
      setNotifications([]);
      setUnread(0);
      return undefined;
    }

    closedByUsRef.current = false;
    refresh();

    const connect = () => {
      const base = import.meta.env.VITE_REALTIME_URL;
      const url = base
        ? `${base}?token=${encodeURIComponent(token)}`
        : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/realtime?token=${encodeURIComponent(token)}`;

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        attemptsRef.current = 0;
        setConnected(true);
      };

      ws.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }

        if (msg.type === 'notification') {
          setNotifications((prev) => [
            { id: msg.id, event_type: msg.event, consultation_id: msg.consultation_id, payload: msg.payload, created_at: msg.created_at, read_at: null },
            ...prev
          ].slice(0, 30));
          setUnread((n) => n + 1);
        }

        for (const fn of listenersRef.current) fn(msg);
      };

      ws.onclose = () => {
        setConnected(false);
        if (closedByUsRef.current) return;
        // Exponential backoff: a server restart must not turn into a
        // reconnect storm from every open tab.
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** attemptsRef.current, MAX_RECONNECT_MS);
        attemptsRef.current += 1;
        timerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      closedByUsRef.current = true;
      clearTimeout(timerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [token, user, refresh]);

  return (
    <RealtimeContext.Provider
      value={{ connected, notifications, unread, refresh, markAllRead, subscribe, sendMessage }}
    >
      {children}
    </RealtimeContext.Provider>
  );
}

export const useRealtime = () => {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error('useRealtime must be used inside RealtimeProvider');
  return ctx;
};
