#!/usr/bin/env node
// Quick end-to-end test of the copilot-proxy edge function.
// Run: node scripts/test-copilot.js
//
// Requires env vars (or reads from .env.local):
//   SUPABASE_URL, SUPABASE_ANON_KEY, TEST_EMAIL, TEST_PASSWORD

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))

// Load .env.local
try {
  const env = readFileSync(resolve(__dir, '../.env.local'), 'utf8')
  for (const line of env.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] ??= m[2].trim()
  }
} catch (_) {}

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://uqadardaukfbrewbuhgk.supabase.co'
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const EMAIL = process.env.TEST_EMAIL
const PASSWORD = process.env.TEST_PASSWORD

async function run() {
  console.log('\n🧪 Copilot proxy end-to-end test')
  console.log('   Supabase:', SUPABASE_URL)

  // ── Direct Copilot API test (no proxy) ──────────────────────────────────
  console.log('\n1. Direct Copilot API (bypasses proxy)...')
  const { execSync } = await import('child_process')
  const token = execSync('gh auth token', { encoding: 'utf8' }).trim()

  const modelsResp = await fetch('https://api.githubcopilot.com/models', {
    headers: {
      Authorization: `Bearer ${token}`,
      'Editor-Version': 'vscode/1.99.0',
      'Editor-Plugin-Version': 'copilot-chat/0.26.0',
      'Copilot-Integration-Id': 'vscode-chat',
      'User-Agent': 'GitHubCopilotChat/0.26.0',
    },
  })
  const modelsData = await modelsResp.json()
  const available = (modelsData.data ?? [])
    .filter(m => m.policy?.state !== 'disabled' && (m.supported_endpoints ?? []).includes('/chat/completions'))
    .map(m => m.id)
  const preferred = ['gpt-5-mini', 'gpt-5.2', 'gpt-5.4', 'claude-sonnet-4', 'claude-sonnet-4.5']
  const model = preferred.find(p => available.includes(p)) ?? available[0]
  console.log('   Model selected:', model)
  console.log('   All available:', available.join(', '))

  const chatResp = await fetch('https://api.githubcopilot.com/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Editor-Version': 'vscode/1.99.0',
      'Editor-Plugin-Version': 'copilot-chat/0.26.0',
      'Copilot-Integration-Id': 'vscode-chat',
      'User-Agent': 'GitHubCopilotChat/0.26.0',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are a receipt parser. Return ONLY a JSON array, each element: {"description":"name","price":1.99,"unit":"500g"}. No explanation.' },
        { role: 'user', content: 'Milk 2L £1.25\nFree range eggs 6pk £2.49\nWholemeal bread £1.10' },
      ],
      max_tokens: 300,
      temperature: 0,
    }),
  })

  const chatText = await chatResp.text()
  if (!chatResp.ok) {
    console.log('   ❌ FAILED', chatResp.status, chatText.slice(0, 200))
  } else {
    const chatData = JSON.parse(chatText)
    const content = chatData.choices?.[0]?.message?.content
    console.log('   ✅ Response:', content?.slice(0, 200))
  }

  // ── Proxy test (requires sign-in) ───────────────────────────────────────
  if (!EMAIL || !PASSWORD) {
    console.log('\n2. Proxy test — skipped (set TEST_EMAIL and TEST_PASSWORD in .env.local)')
    console.log('   Add to .env.local:')
    console.log('     TEST_EMAIL=your@email.com')
    console.log('     TEST_PASSWORD=yourpassword')
    return
  }

  console.log('\n2. Proxy test (via Supabase edge function)...')
  const authResp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  const authData = await authResp.json()
  if (!authData.access_token) {
    console.log('   ❌ Sign-in failed:', authData.error_description || authData.msg || JSON.stringify(authData).slice(0, 100))
    return
  }
  console.log('   ✅ Signed in as', authData.user?.email)

  const proxyResp = await fetch(`${SUPABASE_URL}/functions/v1/copilot-proxy`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authData.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: 'You are a receipt parser. Return ONLY a JSON array, each element: {"description":"name","price":1.99,"unit":"500g"}.' },
        { role: 'user', content: 'Milk 2L £1.25\nFree range eggs 6pk £2.49\nWholemeal bread £1.10' },
      ],
      max_tokens: 300,
      temperature: 0,
    }),
  })

  const proxyText = await proxyResp.text()
  if (!proxyResp.ok) {
    console.log('   ❌ Proxy FAILED', proxyResp.status)
    try { console.log('  ', JSON.stringify(JSON.parse(proxyText), null, 2)) }
    catch (_) { console.log('   raw:', proxyText.slice(0, 300)) }
  } else {
    const proxyData = JSON.parse(proxyText)
    const content = proxyData.choices?.[0]?.message?.content
    console.log('   ✅ Proxy response:', content?.slice(0, 200))
  }
}

run().catch(err => { console.error('\n❌ Unhandled error:', err.message); process.exit(1) })

