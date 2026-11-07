/**
 * larder-mcp under Deno (the edge runtime's engine), talking JSON-RPC like an MCP
 * client would. Supabase is the test fake: auth's password grant is stubbed and
 * REST goes to web/test/fake-supabase.mjs, so this proves the deployed copies of
 * the shared modules load and work in Deno, and that the protocol is right.
 *
 *   deno test --allow-env --allow-net --allow-read supabase/functions/larder-mcp/index.test.ts
 */
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { makeDb } from '../../../web/test/fake-supabase.mjs'
import { installFakeSupabase } from './fake.ts'

Deno.env.set('ASSISTANT_DEFAULT_PERSON', 'Ned')
Deno.env.set('LARDER_MCP_TOKEN', 'test-token')

const db = makeDb({
  users: [{ id: 1, name: 'Ned' }, { id: 2, name: 'Assistant', is_assistant: true }],
  house_users: [{ house_id: 1, user_id: 1 }, { house_id: 1, user_id: 2 }],
  ingredients: [{ id: 10, house_id: 1, name: 'Tomatoes', name_normalized: 'tomatoes', has_any: true, keep: true }],
})
installFakeSupabase(db)

const { handle } = await import('./index.ts')
const call = (body: unknown, token = 'test-token') => handle(new Request('http://edge/larder-mcp', {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}))

Deno.test('rejects a wrong token; accepts ?key= for URL-only clients', async () => {
  assertEquals((await call({ jsonrpc: '2.0', id: 1, method: 'ping' }, 'nope')).status, 401)
  const viaUrl = await handle(new Request('http://edge/larder-mcp?key=test-token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'ping' }),
  }))
  assertEquals(viaUrl.status, 200)
  const wrongUrl = await handle(new Request('http://edge/larder-mcp?key=test-tokeX', {
    method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'ping' }),
  }))
  assertEquals(wrongUrl.status, 401)
})

Deno.test('initialize negotiates the protocol version', async () => {
  const r = await (await call({ jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })).json()
  assertEquals(r.result.protocolVersion, '2025-06-18')
  assert(r.result.capabilities.tools)
  assertEquals((await call({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202)
})

Deno.test('tools/list describes every tool with a schema', async () => {
  const r = await (await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()
  const names = r.result.tools.map((t: { name: string }) => t.name)
  for (const n of ['larder_stock', 'deck', 'what_can_i_make', 'record_purchase', 'log_food', 'undo']) assert(names.includes(n), n)
  assert(r.result.tools.every((t: { inputSchema: { type: string } }) => t.inputSchema.type === 'object'))
})

// supabase-js keeps a token auto-refresh timer for the warm instance's lifetime: expected, not a leak.
Deno.test({ name: 'tools/call signs in as the assistant and answers from the larder', sanitizeOps: false,
  sanitizeResources: false }, async () => {
  const r = await (await call({ jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'larder_stock', arguments: { query: 'tomato' } } })).json()
  assert(!r.result.isError, JSON.stringify(r))
  assertEquals(r.result.structuredContent.items[0].name, 'Tomatoes')
  assertEquals(JSON.parse(r.result.content[0].text).count, 1)
})

Deno.test('unknown tools and methods are JSON-RPC errors', async () => {
  const a = await (await call({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'drop_tables' } })).json()
  assertEquals(a.error.code, -32602)
  const b = await (await call({ jsonrpc: '2.0', id: 5, method: 'resources/list' })).json()
  assertEquals(b.error.code, -32601)
})
