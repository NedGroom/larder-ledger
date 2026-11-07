/**
 * Point supabase-js at the in-memory fake (web/test/fake-supabase.mjs) instead of a real project:
 * the password grant is stubbed and REST calls are answered from `db`. Used by index.test.ts and
 * by dev.ts (the local demo server Anki Life's sessions talk to). Never imported by index.ts.
 */
import { restHandler } from '../../../web/test/fake-supabase.mjs'

export const FAKE_URL = 'http://fake.local'

export function installFakeSupabase(db: Record<string, unknown[]>) {
  Deno.env.set('SUPABASE_URL', FAKE_URL)
  Deno.env.set('SUPABASE_ANON_KEY', 'anon')
  Deno.env.set('ASSISTANT_EMAIL', Deno.env.get('ASSISTANT_EMAIL') ?? 'assistant@example.com')
  Deno.env.set('ASSISTANT_PASSWORD', Deno.env.get('ASSISTANT_PASSWORD') ?? 'pw')
  const rest = restHandler(db)
  const realFetch = globalThis.fetch
  globalThis.fetch = async (input: Request | URL | string, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!url.startsWith(FAKE_URL)) return realFetch(input, init)
    if (url.includes('/auth/v1/token')) {
      const now = Math.floor(Date.now() / 1000)
      return new Response(JSON.stringify({
        access_token: 'jwt', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r',
        user: { id: 'uid-bot', aud: 'authenticated', role: 'authenticated', email: 'assistant@example.com' },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const headers = init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : (init.headers ?? {})
    const res = await rest({ method: (init.method ?? 'GET').toUpperCase(), url, headers,
      json: () => (init.body ? JSON.parse(String(init.body)) : null) })
    return new Response(res.body === '' ? null : res.body,
      { status: res.status, headers: { 'content-type': 'application/json', ...(res.headers ?? {}) } })
  }
}
