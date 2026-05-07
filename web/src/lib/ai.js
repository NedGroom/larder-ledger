import logger from './logger.js'

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
 * apiKey:      user-supplied key, stored in localStorage (never sent to Supabase).
 *              Not required for the 'copilot' provider — it uses a shared server-side
 *              token via the copilot-proxy Supabase Edge Function.
 * sessionToken: Supabase JWT — required only for the 'copilot' provider.
 */

// ── Prompt shared across providers ───────────────────────────────────────────
const BASE_SYSTEM_PROMPT = `You are a receipt parser. Extract every product, any fees/charges, unitemised discounts, and the receipt total.
Return ONLY a single JSON object (no explanation) with this shape:
{
  "items": [
    {
      "description": "product name as written on receipt",
      "quantity": 1,
      "price": 1.99,
      "unit": "500g",
      "match_type": "existing" | "new",
      "match_name": "canonical ingredient name",
      "match_alts": ["alt name 1", "alt name 2"]
    }
  ],
  "fees": [
    { "description": "Delivery fee", "amount": 3.99 }
  ],
  "discounts": [
    { "description": "Loyalty card discount", "amount": 2.00 }
  ],
  "receipt_total": 45.67
}
Rules:
- "items": only actual products/groceries, not charges, discounts or totals.
- "quantity": number of units purchased (integer, default 1 if not shown).
- "price": the FINAL price per single unit after any item-level discount. If the receipt shows both an original and a discounted price for the same item, always use the discounted per-unit price. Never return the line total (quantity × price) — always per unit.
- "unit": pack size/unit descriptor (e.g. "2L", "500g", "6pk"); use "" if not stated.
- Prices and amounts must be numbers, no currency symbols.
- "match_type": "existing" if the item clearly matches the known ingredients list; otherwise "new".
- "match_name": if "existing", copy the name exactly from the known list. If "new", suggest a clean canonical name in the same style/specificity as the known list.
- "match_alts": always exactly two alternative name strings. If "existing", two other close names from the known list. If "new", two alternative phrasings for the new name.
- "fees": surcharges, taxes, delivery, service charges etc. shown on the receipt. Empty array if none.
- "discounts": ONLY discounts that cannot be attributed to a specific item (e.g. blanket loyalty discounts, voucher codes, "10% off your shop"). Do NOT include item-level discounts here — those should already be reflected in the item's per-unit price. Empty array if none.
- "receipt_total": the final total shown on the receipt as a number, or null if not visible.`

function buildSystemPrompt(knownIngredients) {
  if (!knownIngredients?.length) return BASE_SYSTEM_PROMPT
  return BASE_SYSTEM_PROMPT + `\n\nKnown ingredients list:\n${knownIngredients.map(n => `- ${n}`).join('\n')}`
}

/** Parse a structured error from any provider response */
function parseUpstreamError(providerName, status, rawText) {
  let detail = rawText
  try {
    const j = JSON.parse(rawText)
    // Our proxy format: { error: { code, message, detail } }
    if (j?.error?.message) detail = j.error.message
    // OpenAI/Anthropic format: { error: { message } }
    else if (typeof j?.error === 'string') detail = j.error
  } catch (_) { /* keep raw text */ }
  const msg = `${providerName} error ${status}: ${detail}`
  logger.error('upstream error', { provider: providerName, status, detail })
  return new Error(msg)
}

// ── OpenAI ────────────────────────────────────────────────────────────────────
async function extractOpenAI({ content, contentType, imageMime, apiKey, knownIngredients }) {
  const userContent = contentType === 'image'
    ? [
        { type: 'image_url', image_url: { url: `data:${imageMime};base64,${content}` } },
        { type: 'text', text: 'Extract all products and prices from this receipt.' },
      ]
    : content

  const body = {
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: buildSystemPrompt(knownIngredients) },
      { role: 'user',   content: userContent },
    ],
    max_tokens: 1500,
    temperature: 0,
  }

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })
  if (!resp.ok) throw parseUpstreamError('OpenAI', resp.status, await resp.text())
  const data = await resp.json()
  const raw = data.choices[0].message.content.trim()
  return parseJsonResponse(raw)
}

// ── Anthropic ─────────────────────────────────────────────────────────────────
async function extractAnthropic({ content, contentType, imageMime, apiKey, knownIngredients }) {
  const userContent = contentType === 'image'
    ? [
        { type: 'image', source: { type: 'base64', media_type: imageMime, data: content } },
        { type: 'text',  text: 'Extract all products and prices from this receipt.' },
      ]
    : [{ type: 'text', text: content }]

  const body = {
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 1500,
    system: buildSystemPrompt(knownIngredients),
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
  if (!resp.ok) throw parseUpstreamError('Anthropic', resp.status, await resp.text())
  const data = await resp.json()
  const raw = data.content[0].text.trim()
  return parseJsonResponse(raw)
}

// ── GitHub Copilot ────────────────────────────────────────────────────────────
// Calls our own Supabase Edge Function (copilot-proxy) which holds the token
// server-side. No user-supplied API key needed — just a valid Supabase session.
async function extractCopilot({ content, contentType, sessionToken, knownIngredients }) {
  if (contentType === 'image') throw new Error('GitHub Copilot provider does not support image input — please use text mode.')

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const proxyUrl = `${supabaseUrl}/functions/v1/copilot-proxy`

  const body = {
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: buildSystemPrompt(knownIngredients) },
      { role: 'user',   content },
    ],
    max_tokens: 1500,
    temperature: 0,
  }

  const resp = await fetch(proxyUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!resp.ok) throw parseUpstreamError('Copilot proxy', resp.status, await resp.text())
  const data = await resp.json()
  const raw = data.choices[0].message.content.trim()
  return parseJsonResponse(raw)
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseJsonResponse(raw) {
  const clean = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  const parsed = JSON.parse(clean)

  const itemsRaw     = Array.isArray(parsed) ? parsed : (parsed.items ?? [])
  const feesRaw      = Array.isArray(parsed) ? [] : (parsed.fees ?? [])
  const discountsRaw = Array.isArray(parsed) ? [] : (parsed.discounts ?? [])
  const totalRaw     = Array.isArray(parsed) ? null : (parsed.receipt_total ?? null)

  const items = itemsRaw.map(r => ({
    description: String(r.description ?? ''),
    quantity:    Math.max(1, Math.round(Number(r.quantity ?? 1))),
    price:       Number(r.price ?? 0),   // per unit, discounted
    unit:        String(r.unit ?? ''),
    match_type:  r.match_type === 'existing' ? 'existing' : 'new',
    match_name:  String(r.match_name ?? ''),
    match_alts:  Array.isArray(r.match_alts) ? r.match_alts.map(String).slice(0, 2) : [],
  }))

  const fees = feesRaw.map(f => ({
    description: String(f.description ?? 'Fee'),
    amount:      Number(f.amount ?? 0),
  }))

  const discounts = discountsRaw.map(d => ({
    description: String(d.description ?? 'Discount'),
    amount:      Number(d.amount ?? 0),   // positive = saves money
  }))

  const receipt_total = totalRaw !== null ? Number(totalRaw) : null

  return { items, fees, discounts, receipt_total }
}

// ── Public API ─────────────────────────────────────────────────────────────────
export const PROVIDERS = {
  copilot: {
    name: 'GitHub Copilot',
    supportsImage: false,
    requiresApiKey: false,   // uses shared server-side token via proxy
    extract: extractCopilot,
  },
  openai: {
    name: 'OpenAI (GPT-4o)',
    supportsImage: true,
    requiresApiKey: true,
    extract: extractOpenAI,
  },
  anthropic: {
    name: 'Anthropic (Claude 3.5 Sonnet)',
    supportsImage: true,
    requiresApiKey: true,
    extract: extractAnthropic,
  },
}

/**
 * Run price extraction via the chosen provider.
 * @param {object} opts
 * @param {string} opts.provider   - key in PROVIDERS
 * @param {string} [opts.apiKey]   - user-supplied key (not needed for 'copilot')
 * @param {string} [opts.sessionToken] - Supabase JWT (required for 'copilot')
 * @param {string} opts.content    - plain text OR base64 image
 * @param {'text'|'image'} opts.contentType
 * @param {string} [opts.imageMime] - e.g. 'image/jpeg', required when contentType=image
 * @param {string[]} [opts.knownIngredients] - list of existing ingredient names for AI matching
 * @returns {Promise<{items: Array, fees: Array<{description,amount}>, receipt_total: number|null}>}
 */
export async function extractPrices({ provider, apiKey, sessionToken, content, contentType, imageMime, knownIngredients }) {
  const p = PROVIDERS[provider]
  if (!p) throw new Error(`Unknown AI provider: ${provider}`)
  if (contentType === 'image' && !p.supportsImage) throw new Error(`${p.name} does not support image input`)
  logger.info('extractPrices', { provider, contentType, contentLength: content?.length, knownCount: knownIngredients?.length })
  try {
    const result = await p.extract({ content, contentType, imageMime, apiKey, sessionToken, knownIngredients })
    logger.info('extractPrices ok', { provider, itemCount: result.items.length, feeCount: result.fees.length })
    return result
  } catch (err) {
    logger.error('extractPrices failed', { provider, err: err.message })
    throw err
  }
}

