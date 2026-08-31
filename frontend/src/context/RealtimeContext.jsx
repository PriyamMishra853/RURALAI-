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

/**
 * Outbound buffering.
 *
 * The socket authenticates by looking the caller up in staff_profiles, so it is
 * open for a few hundred milliseconds *after* the page starts working. A call
 * screen that navigates straight to /call/:id would send `call:join` into a
 * CONNECTING socket and have it silently dropped — the peer then waited forever
 * for someone the server never knew had arrived.
 *
 * Anything sent before the socket is ready is held and flushed on open. The TTL
 * is what keeps that safe across a genuine outage: the startup race resolves in
 * well under a second, so real messages survive it, while SDP and ICE queued
 * against a peer connection that has since been renegotiated are stale by the
 * time the socket returns and are dropped rather than replayed.
 */
const OUTBOX_LIMIT = 50;
const OUTBOX_TTL_MS = 10000;

/**
 * Where the realtime socket lives.
 *
 * The API and the socket are served by the same process, so the socket's host
 * is derivable from the API's and does not need to be configured twice. It was,
 * and the two drifted: a deployment moved the backend to a new host, VITE_API_URL
 * was updated and VITE_REALTIME_URL was not, so every API call succeeded while
 * the socket dialled a decommissioned service. Nothing surfaced that as an
 * error — consultations just never connected, because signalling had nowhere to
 * go.
 *
 * Order of preference:
 *   1. VITE_REALTIME_URL, if set — an explicit override still wins, for a
 *      deployment that genuinely splits the two.
 *   2. Derived from VITE_API_URL — the normal case, and impossible to desync.
 *   3. The page's own origin — correct when one service serves UI and API.
 */
const resolveRealtimeUrl = () => {
  // The page decides the scheme, never the configuration.
  //
  // A document served over HTTPS may not open a ws:// socket — the browser
  // blocks it as mixed content before the connection is attempted, and throws
  // from the WebSocket constructor. So a VITE_REALTIME_URL of
  // "ws://host/realtime" cannot work on a deployed site no matter what else is
  // right, and honouring it just reproduces the failure. Only the host and path
  // are taken from configuration; the scheme is derived from the page.
  const secure = window.location.protocol === 'https:';
  const scheme = secure ? 'wss' : 'ws';

  const explicit = import.meta.env.VITE_REALTIME_URL;
  if (explicit) {
    const hostAndPath = String(explicit).trim().replace(/^(wss?|https?):\/\//i, '');
    if (hostAndPath) return `${scheme}://${hostAndPath}`;
  }

  const apiUrl = import.meta.env.VITE_API_URL;
  if (apiUrl) {
    try {
      const { host } = new URL(apiUrl, window.location.origin);
      return `${scheme}://${host}/realtime`;
    } catch {
      // Malformed VITE_API_URL — fall through to the page's own origin.
    }
  }

  return `${scheme}://${window.location.host}/realtime`;
};

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
  /** Messages written while the socket was down: [{ payload, at }]. */
  const outboxRef = useRef([]);

  const subscribe = useCallback((fn) => {
    listenersRef.current.add(fn);
    return () => listenersRef.current.delete(fn);
  }, []);

  /**
   * Send now if the socket is open, otherwise hold it for the next open.
   *
   * Returns whether it went out immediately. Callers that care about delivery
   * should re-declare their intent when `connected` flips true rather than
   * reading this — that is what makes a reconnect self-healing.
   */
  const sendMessage = useCallback((payload) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(payload));
        return true;
      } catch {
        // Socket died between the readyState check and the send; fall through
        // and queue it for the reconnect.
      }
    }
    // Oldest first, so a long outage cannot grow this without bound.
    if (outboxRef.current.length >= OUTBOX_LIMIT) outboxRef.current.shift();
    outboxRef.current.push({ payload, at: Date.now() });
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
      // Never replay the previous user's queued messages onto the next
      // session's socket.
      outboxRef.current = [];
      setConnected(false);
      setNotifications([]);
      setUnread(0);
      return undefined;
    }

    closedByUsRef.current = false;
    refresh();

    const connect = () => {
      const base = resolveRealtimeUrl();
      const url = `${base}?token=${encodeURIComponent(token)}`;

      // Logged once per attempt, without the token. A socket that silently
      // dials the wrong host is otherwise invisible from the browser: the app
      // keeps working, and only calls quietly stop connecting.
      console.info('[realtime] connecting to', base);

      // The constructor itself can throw — a blocked mixed-content URL raises
      // SecurityError synchronously. Uncaught, that escapes the effect and
      // takes the reconnect loop with it, so the app never tries again.
      let ws;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        console.error('[realtime] could not open socket:', err.message);
        setConnected(false);
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** attemptsRef.current, MAX_RECONNECT_MS);
        attemptsRef.current += 1;
        timerRef.current = setTimeout(connect, delay);
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        attemptsRef.current = 0;

        // Flush what was written while we were down, dropping anything stale
        // enough that the peer connection it belonged to has moved on.
        const cutoff = Date.now() - OUTBOX_TTL_MS;
        const pending = outboxRef.current;
        outboxRef.current = [];
        for (const { payload, at } of pending) {
          if (at < cutoff) continue;
          try { ws.send(JSON.stringify(payload)); } catch { /* died again; next open retries nothing */ }
        }

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
