/**
 * larder-mcp — the Larder as an MCP server (Model Context Protocol, Streamable HTTP).
 *
 * Lets a language model read and act on the larder with the app's own rules:
 * Anki Life's Siri/chat assistant calls it, and it can be added as a custom
 * connector in the Claude apps. The tools themselves live in
 * web/src/lib/assistant.js (copied into _shared/larder by scripts/sync-mcp-lib.mjs).
 *
 * POST /functions/v1/larder-mcp      JSON-RPC 2.0: initialize, tools/list, tools/call, ping
 * Auth: Authorization: Bearer <LARDER_MCP_TOKEN>, or ?key=<LARDER_MCP_TOKEN> for URL-only clients.
 *       Deploy with --no-verify-jwt, because callers present this token, not a Supabase JWT.
 *
 * Secrets (supabase secrets set ...):
 *   LARDER_MCP_TOKEN          shared secret the callers send
 *   ASSISTANT_EMAIL/PASSWORD  the assistant's own Supabase user, a member of the house:
 *                             it acts through RLS like any member, never as service role
 *   ASSISTANT_DEFAULT_PERSON  whose day "my calories" means (a user name, e.g. "Ned")
 *   ASSISTANT_READ_ONLY       "1" hides the write tools
 * SUPABASE_URL and SUPABASE_ANON_KEY are provided by the platform.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { useSupabaseClient } from '../_shared/larder/supabase.js'
import { TOOLS, makeContext, runTool } from '../_shared/larder/assistant.js'
import { log } from '../_shared/log.ts'

const logger = log('larder-mcp')
const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const readOnly = Deno.env.get('ASSISTANT_READ_ONLY') === '1'
const tools = TOOLS.filter(t => !readOnly || !t.write)

let signedIn: Promise<unknown> | null = null

function signIn() {
  // One client per warm instance; supabase-js refreshes the session itself.
  signedIn ??= (async () => {
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: true },
    })
    const { error } = await client.auth.signInWithPassword({
      email: Deno.env.get('ASSISTANT_EMAIL')!, password: Deno.env.get('ASSISTANT_PASSWORD')!,
    })
    if (error) { signedIn = null; throw new Error(`assistant sign-in failed: ${error.message}`) }
    useSupabaseClient(client)
    return client
  })()
  return signedIn
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const reply = (id: unknown, result: unknown) => json({ jsonrpc: '2.0', id, result })
const fail = (id: unknown, code: number, message: string) => json({ jsonrpc: '2.0', id, error: { code, message } })

function authorised(req: Request) {
  const want = Deno.env.get('LARDER_MCP_TOKEN')
  // Header for API callers (Anki Life); ?key= for clients that can only take a URL (the Claude
  // apps' custom connector screen). HTTPS either way; the URL form is kept out of the logs.
  const got = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '') ||
    (new URL(req.url).searchParams.get('key') ?? '')
  if (!want || got.length !== want.length) return false
  let diff = 0
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i)
  return diff === 0
}

export async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('MCP endpoint: POST JSON-RPC', { status: 405 })
  if (!authorised(req)) return json({ error: 'unauthorised' }, 401)

  let msg: { id?: unknown; method?: string; params?: Record<string, unknown> }
  try { msg = await req.json() } catch { return fail(null, -32700, 'parse error') }
  const { id = null, method, params = {} } = msg

  if (method?.startsWith('notifications/')) return new Response(null, { status: 202 })
  if (method === 'ping') return reply(id, {})
  if (method === 'initialize') {
    const asked = String(params.protocolVersion ?? '')
    return reply(id, {
      protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
      capabilities: { tools: {} },
      serverInfo: { name: 'larder-ledger', version: '1.0.0' },
      instructions: "Tools for Ned's household larder: stock, meal plan, ingredient quota (deck), what can be " +
        'cooked, nutrition by day, shopping list; and writes for purchases, stock, the list and a food log. ' +
        'Writes return an undo token.',
    })
  }
  if (method === 'tools/list') {
    return reply(id, {
      tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.input_schema,
        annotations: { readOnlyHint: !t.write } })),
    })
  }
  if (method === 'tools/call') {
    const name = String(params.name ?? '')
    if (!tools.some(t => t.name === name)) return fail(id, -32602, `unknown tool ${name}`)
    const started = Date.now()
    try {
      await signIn()
      const ctx = await makeContext({ defaultPerson: Deno.env.get('ASSISTANT_DEFAULT_PERSON') ?? null })
      const result = await runTool(ctx, name, params.arguments ?? {})
      logger.info('tool', { name, ms: Date.now() - started })
      return reply(id, { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result })
    } catch (err) {
      logger.error('tool failed', { name, error: String(err) })
      return reply(id, { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true })
    }
  }
  return fail(id, -32601, `method not found: ${method}`)
}

if (import.meta.main) Deno.serve(handle)
