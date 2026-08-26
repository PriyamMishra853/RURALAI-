import { createClient } from '@supabase/supabase-js';

// No hardcoded fallbacks. These previously defaulted to a decommissioned
// hackathon project and a literal "dummy" anon key, so the built app opened
// realtime sockets to a dead host on every page load and realtime never worked
// — while looking configured.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not set. Copy frontend/.env.example to frontend/.env. Realtime updates are disabled.'
  );
}

/**
 * A no-op stand-in used when the project is not configured.
 *
 * Dashboards call `supabase.channel(...).on(...).subscribe()` directly, so
 * exporting null would white-screen them on a missing .env. Losing live updates
 * is a degradation; losing the whole page is an outage.
 */
const disabledClient = {
  channel: () => {
    const chain = { on: () => chain, subscribe: () => chain, unsubscribe: () => {} };
    return chain;
  },
  removeChannel: () => {}
};

export const isRealtimeEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase = isRealtimeEnabled
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      realtime: { params: { eventsPerSecond: 10 } }
    })
  : disabledClient;
