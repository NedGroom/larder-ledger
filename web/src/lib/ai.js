/**
 * ai.js — Abstraction layer for receipt price extraction.
 *
 * To add a new provider:
 *  1. Add an entry to PROVIDERS with a unique key and display name.
 *  2. Implement its extract() function — must accept { content, contentType, apiKey }
 *     and return an array of { description, price, unit }.
 *
 * content:     string — either plain text, or a base64-encoded image
 * contentType: 'text' | 'image'   (for image, pass MIME type in imageMime)
 * imageMime:   e.g. 'image/jpeg'
 * apiKey:      user-supplied key, stored in localStorage (never sent to Supabase)
 */

// ── Prompt shared across providers ───────────────────────────────────────────
const SYSTEM_PROMPT = `You are a receipt parser. Extract every product and its price from the provided receipt text or image.
Return ONLY a JSON array, no explanation. Each element must have:
  { "description": "product name", "price": 1.99, "unit": "500g" }
If unit/size is not on the receipt, use an empty string for unit.
Prices must be numbers (no currency symbols).`

// ── OpenAI ────────────────────────────────────────────────────────────────────
async function extractOpenAI({ content, contentType, imageMime, apiKey }) {
  const userContent = contentType === 'image'
    ? [
        { type: 'image_url', image_url: { url: `data:${imageMime};base64,${content}` } },
        { type: 'text', text: 'Extract all products and prices from this receipt.' },
      ]
    : content

  const body = {
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: userContent },
    ],
    max_tokens: 1000,
    temperature: 0,
  }

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })
  if (!resp.ok) throw new Error(`OpenAI error ${resp.status}: ${await resp.text()}`)
  const data = await resp.json()
  const raw = data.choices[0].message.content.trim()
  return parseJsonResponse(raw)
}

// ── Anthropic ─────────────────────────────────────────────────────────────────
async function extractAnthropic({ content, contentType, imageMime, apiKey }) {
  const userContent = contentType === 'image'
    ? [
        { type: 'image', source: { type: 'base64', media_type: imageMime, data: content } },
        { type: 'text',  text: 'Extract all products and prices from this receipt.' },
      ]
    : [{ type: 'text', text: content }]

  const body = {
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Anthropic requires a proxy or CORS-enabled endpoint for browser requests.
      // For local dev, use a lightweight proxy (see docs/ai-proxy-guide.md).
      'anthropic-dangerous-request-proxy': 'true',
    },
    body: JSON.stringify(body),
  })
  if (!resp.ok) throw new Error(`Anthropic error ${resp.status}: ${await resp.text()}`)
  const data = await resp.json()
  const raw = data.content[0].text.trim()
  return parseJsonResponse(raw)
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseJsonResponse(raw) {
  // Strip markdown code fences if present
  const clean = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  const parsed = JSON.parse(clean)
  if (!Array.isArray(parsed)) throw new Error('AI did not return an array')
  return parsed.map(r => ({
    description: String(r.description ?? ''),
    price: Number(r.price ?? 0),
    unit: String(r.unit ?? ''),
  }))
}

// ── Public API ─────────────────────────────────────────────────────────────────
export const PROVIDERS = {
  openai: {
    name: 'OpenAI (GPT-4o)',
    supportsImage: true,
    extract: extractOpenAI,
  },
  anthropic: {
    name: 'Anthropic (Claude 3.5 Sonnet)',
    supportsImage: true,
    extract: extractAnthropic,
  },
}

/**
 * Run price extraction via the chosen provider.
 * @param {object} opts
 * @param {string} opts.provider   - key in PROVIDERS
 * @param {string} opts.apiKey
 * @param {string} opts.content    - plain text OR base64 image
 * @param {'text'|'image'} opts.contentType
 * @param {string} [opts.imageMime] - e.g. 'image/jpeg', required when contentType=image
 * @returns {Promise<Array<{description:string, price:number, unit:string}>>}
 */
export async function extractPrices({ provider, apiKey, content, contentType, imageMime }) {
  const p = PROVIDERS[provider]
  if (!p) throw new Error(`Unknown AI provider: ${provider}`)
  if (contentType === 'image' && !p.supportsImage) throw new Error(`${p.name} does not support image input`)
  return p.extract({ content, contentType, imageMime, apiKey })
}

