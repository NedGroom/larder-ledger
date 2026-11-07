// GENERATED from web/src/lib by scripts/sync-mcp-lib.mjs - edit the original, then re-run.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// In the browser (Vite) the client is built from the env file. Outside it — the
// larder-mcp edge function, Node tests — there is no import.meta.env, and the
// caller injects a client signed in as whoever it acts for (RLS still applies).
const env = (typeof import.meta !== 'undefined' && import.meta.env) || {}
const url  = env.VITE_SUPABASE_URL
const anon = env.VITE_SUPABASE_ANON_KEY

if (env.MODE && (!url || !anon)) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in web/.env')
}

// `let`, so modules importing it see the injected client (ES live binding).
export let supabase = url && anon ? createClient(url, anon) : null

export function useSupabaseClient(client) {
  supabase = client
}
