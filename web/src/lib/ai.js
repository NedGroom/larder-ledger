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
      "match_alts": ["alt name 1", "alt name 2"],
      "category": "Produce",
      "nutrition": { "kcal": 133, "protein": 9.0, "carbs": 5.0, "fat": 9.0, "fibre": 0.0 }
    }
  ],
  "fees": [
    { "description": "Delivery fee", "amount": 3.99 }
  ],
  "discounts": [
    { "description": "Loyalty card discount", "amount": 2.00 }
  ],
  "receipt_total": 45.67,
  "store_name": "shop name as printed on the receipt",
  "purchase_date": "2026-08-17"
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
- "category": which aisle/group this belongs to. If the known categories list below contains a suitable one, copy that name exactly; otherwise suggest a short sensible one ("Produce", "Dairy", "Tins & jars"). null if you really can't say.
- "nutrition": typical values PER 100g or 100ml for this kind of food, from your own knowledge — an estimate, not a reading. Only for items where "match_type" is "new"; use null for existing ones, whose figures the house already has. Use null for any single value you're unsure of, and null for the whole object for non-food items. These are explicitly marked as estimates in the app and are replaced the moment a real label is photographed, so a reasonable approximation is much more useful than nothing.
- "fees": surcharges, taxes, delivery, service charges etc. shown on the receipt. Empty array if none.
- "discounts": ONLY discounts that cannot be attributed to a specific item (e.g. blanket loyalty discounts, voucher codes, "10% off your shop"). Do NOT include item-level discounts here — those should already be reflected in the item's per-unit price. Empty array if none.
- "receipt_total": the final total shown on the receipt as a number, or null if not visible.
- "store_name": the retailer/shop name printed on the receipt. If it closely matches one of the known shops listed below, copy that name exactly. null if not visible.
- "purchase_date": the date of purchase as YYYY-MM-DD. Receipts are UK-format, so read ambiguous dates as DD/MM/YYYY. null if not visible.`

function buildSystemPrompt(knownIngredients, knownStores, knownCategories) {
  let prompt = BASE_SYSTEM_PROMPT
  if (knownIngredients?.length) {
    prompt += `\n\nKnown ingredients list:\n${knownIngredients.map(n => `- ${n}`).join('\n')}`
  }
  if (knownStores?.length) {
    prompt += `\n\nKnown shops:\n${knownStores.map(n => `- ${n}`).join('\n')}`
  }
  if (knownCategories?.length) {
    prompt += `\n\nKnown categories:\n${knownCategories.map(n => `- ${n}`).join('\n')}`
  }
  return prompt
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
async function extractOpenAI({ content, contentType, imageMime, apiKey, knownIngredients, knownStores, knownCategories }) {
  const userContent = contentType === 'image'
    ? [
        { type: 'image_url', image_url: { url: `data:${imageMime};base64,${content}` } },
        { type: 'text', text: 'Extract all products and prices from this receipt.' },
      ]
    : content

  const body = {
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: buildSystemPrompt(knownIngredients, knownStores, knownCategories) },
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
async function extractAnthropic({ content, contentType, imageMime, apiKey, knownIngredients, knownStores, knownCategories }) {
  const userContent = contentType === 'image'
    ? [
        { type: 'image', source: { type: 'base64', media_type: imageMime, data: content } },
        { type: 'text',  text: 'Extract all products and prices from this receipt.' },
      ]
    : [{ type: 'text', text: content }]

  const body = {
    model: ANTHROPIC_MODEL,
    max_tokens: 1500,
    system: buildSystemPrompt(knownIngredients, knownStores, knownCategories),
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
async function extractCopilot({ content, contentType, sessionToken, knownIngredients, knownStores, knownCategories }) {
  if (contentType === 'image') throw new Error('GitHub Copilot provider does not support image input — please use text mode.')

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const proxyUrl = `${supabaseUrl}/functions/v1/copilot-proxy`

  const body = {
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: buildSystemPrompt(knownIngredients, knownStores, knownCategories) },
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

// ── Which provider and key the user configured ───────────────────────────────
// Set on the Receipts screen and kept in localStorage. The key never goes to
// Supabase; it is sent straight from the browser to the provider.
export const LS_PROVIDER = 'll_ai_provider'
export const LS_KEY      = 'll_ai_key'

/** The provider/key the user last configured, for screens other than Receipts. */
export function storedAiConfig() {
  try {
    return {
      provider: localStorage.getItem(LS_PROVIDER) || '',
      apiKey:   localStorage.getItem(LS_KEY) || '',
    }
  } catch { return { provider: '', apiKey: '' } }
}

// ── Reading a nutrition panel off a photograph ───────────────────────────────

/**
 * The Anthropic model used for receipt extraction and for label reading.
 *
 * One constant for both, because the web-search server tool below only exists
 * from Claude 4.6 onward: pinning an older snapshot here doesn't error, it just
 * silently drops the verification step, which is the one thing this feature is
 * for. Sonnet 5 reads a nutrition panel as well as anything and costs a
 * fraction of the Opus tier for what is, in the end, OCR with a sanity check.
 */
const ANTHROPIC_MODEL = 'claude-sonnet-5'

/**
 * Web search is what turns a confident misreading into a caught one.
 *
 * The arithmetic check in `nutrition.js` catches a slipped decimal point,
 * because the macros stop adding up to the calories. What it cannot catch is a
 * reading that is internally consistent but taken off the wrong column — the
 * per-serving column instead of per-100g, or the panel of the item beside it on
 * the shelf. For that you have to know what the food is actually like, which
 * means looking it up.
 */
const NUTRITION_PROMPT = `You are reading the nutrition information panel from a photograph of food packaging.

Return ONLY a single JSON object (no explanation, no markdown fence) with this shape:
{
  "product_name": "what the packet says this is",
  "per_100": { "kcal": 133, "protein": 9.0, "carbs": 5.0, "fat": 9.0, "fibre": 0.0 },
  "pack_grams": 500,
  "confidence": "high" | "medium" | "low",
  "notes": "anything that made this hard to read"
}
Rules:
- Every figure in "per_100" is PER 100g or 100ml. Packaging often prints a per-serving column beside it — do not use that one. If only per-serving figures are shown, convert them to per-100g using the stated serving size and say so in "notes".
- "kcal", never kJ. If only kJ is printed, divide by 4.184.
- "fibre" is often absent from UK labels; use null rather than 0 when it genuinely isn't printed.
- "pack_grams": the net weight of the whole pack in grams, or null if not visible.
- Numbers only — no units, no "<" or "approx".
- If the photograph is too blurred or cropped to read a value, use null for that value and set "confidence": "low". A null is far more useful than a guess.`

const NUTRITION_VERIFY_PROMPT = `

Before answering, sanity-check what you have read:
- Energy should roughly equal 4x protein + 4x carbohydrate + 9x fat + 2x fibre, all per 100g. If it doesn't, you have probably misread a digit or a decimal point — look again.
- Use the web_search tool to look up typical published nutrition for this product or food type, and compare. Misreadings that survive the arithmetic check are usually the per-serving column, or a decimal point in the wrong place.
- If your reading is wildly different from what is typical for this food, re-read the image and correct it. Say what you found in "notes", and lower "confidence".
- Add a field "verified": { "searched": true, "typical_kcal": <number or null>, "agrees": true | false, "comment": "one short sentence" }.
- Never invent a figure from the web to replace one you cannot read — a null stays null.`

/** Shape whatever the model returned into the reading the app expects. */
function parseNutritionResponse(raw) {
  const clean = String(raw).replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  const p = JSON.parse(clean)
  const per = p.per_100 ?? p.per100 ?? {}
  const n = v => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v))
  return {
    productName: p.product_name ? String(p.product_name) : null,
    kcal:    n(per.kcal),
    protein: n(per.protein),
    carbs:   n(per.carbs),
    fat:     n(per.fat),
    fibre:   n(per.fibre),
    packGrams: n(p.pack_grams),
    confidence: ['high', 'medium', 'low'].includes(p.confidence) ? p.confidence : 'medium',
    notes: p.notes ? String(p.notes) : '',
    verified: p.verified
      ? {
          searched: !!p.verified.searched,
          typicalKcal: n(p.verified.typical_kcal),
          agrees: p.verified.agrees !== false,
          comment: p.verified.comment ? String(p.verified.comment) : '',
        }
      : null,
  }
}

async function nutritionAnthropic({ content, imageMime, apiKey, verifyOnline = true }) {
  const body = {
    model: ANTHROPIC_MODEL,
    max_tokens: 2000,
    system: NUTRITION_PROMPT + (verifyOnline ? NUTRITION_VERIFY_PROMPT : ''),
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: imageMime, data: content } },
        { type: 'text',  text: 'Read the nutrition panel from this packet.' },
      ],
    }],
    // Dynamic-filtering web search. Capped low: this is one lookup to sanity
    // check a number, not research.
    ...(verifyOnline ? { tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }] } : {}),
  }

  let data = await anthropicCall(body, apiKey)

  // A server tool that hasn't finished ends the turn with `pause_turn`; the
  // conversation is continued by handing the same content straight back.
  let guard = 0
  while (data.stop_reason === 'pause_turn' && guard++ < 3) {
    body.messages = [...body.messages, { role: 'assistant', content: data.content }]
    data = await anthropicCall(body, apiKey)
  }

  const text = (data.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('').trim()
  if (!text) throw new Error('The model returned no reading for this label.')
  return parseNutritionResponse(text)
}

async function anthropicCall(body, apiKey) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-request-proxy': 'true',
    },
    body: JSON.stringify(body),
  })
  if (!resp.ok) throw parseUpstreamError('Anthropic', resp.status, await resp.text())
  return resp.json()
}

async function nutritionOpenAI({ content, imageMime, apiKey }) {
  const body = {
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: NUTRITION_PROMPT },
      { role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:${imageMime};base64,${content}` } },
        { type: 'text', text: 'Read the nutrition panel from this packet.' },
      ] },
    ],
    max_tokens: 1000,
    temperature: 0,
  }
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })
  if (!resp.ok) throw parseUpstreamError('OpenAI', resp.status, await resp.text())
  const data = await resp.json()
  return parseNutritionResponse(data.choices[0].message.content.trim())
}

/**
 * Read a nutrition panel from a photograph.
 *
 * @returns {Promise<{productName, kcal, protein, carbs, fat, fibre, packGrams,
 *                    confidence, notes, verified}>}
 */
export async function extractNutrition({ provider, apiKey, content, imageMime }) {
  const p = PROVIDERS[provider]
  if (!p) throw new Error(`Unknown AI provider: ${provider}`)
  if (!p.extractNutrition) {
    throw new Error(`${p.name} can't read images. Choose Anthropic or OpenAI in the receipt settings.`)
  }
  logger.info('extractNutrition', { provider, verifies: !!p.verifiesOnline })
  try {
    const reading = await p.extractNutrition({ content, imageMime, apiKey, verifyOnline: p.verifiesOnline })
    logger.info('extractNutrition ok', { provider, confidence: reading.confidence, verified: !!reading.verified })
    return reading
  } catch (err) {
    logger.error('extractNutrition failed', { provider, err: err.message })
    throw err
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** A per-100g estimate, or null if the model gave nothing usable. */
function parseEstimate(n) {
  if (!n || typeof n !== 'object') return null
  const num = v => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v))
  const out = {
    kcal: num(n.kcal), protein: num(n.protein),
    carbs: num(n.carbs), fat: num(n.fat), fibre: num(n.fibre),
  }
  return Object.values(out).some(v => v != null) ? out : null
}

function parseJsonResponse(raw) {
  const clean = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  const parsed = JSON.parse(clean)

  const itemsRaw     = Array.isArray(parsed) ? parsed : (parsed.items ?? [])
  const feesRaw      = Array.isArray(parsed) ? [] : (parsed.fees ?? [])
  const discountsRaw = Array.isArray(parsed) ? [] : (parsed.discounts ?? [])
  const totalRaw     = Array.isArray(parsed) ? null : (parsed.receipt_total ?? null)
  const storeRaw     = Array.isArray(parsed) ? null : (parsed.store_name ?? null)
  const dateRaw      = Array.isArray(parsed) ? null : (parsed.purchase_date ?? null)

  const items = itemsRaw.map(r => ({
    description: String(r.description ?? ''),
    quantity:    Math.max(1, Math.round(Number(r.quantity ?? 1))),
    price:       Number(r.price ?? 0),   // per unit, discounted
    unit:        String(r.unit ?? ''),
    match_type:  r.match_type === 'existing' ? 'existing' : 'new',
    match_name:  String(r.match_name ?? ''),
    match_alts:  Array.isArray(r.match_alts) ? r.match_alts.map(String).slice(0, 2) : [],
    category:    r.category ? String(r.category).trim() || null : null,
    // Typical figures for this kind of food, not a reading of anything. Kept
    // separate from a photographed label all the way to the database, where a
    // nutrition_source of 'estimated' says so out loud.
    nutrition:   parseEstimate(r.nutrition),
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
  const store_name = storeRaw ? String(storeRaw).trim() || null : null
  // Only trust a clean ISO date; anything else is left for the user to fill in.
  const purchase_date = /^\d{4}-\d{2}-\d{2}$/.test(String(dateRaw ?? '')) ? String(dateRaw) : null

  return { items, fees, discounts, receipt_total, store_name, purchase_date }
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
    extractNutrition: nutritionOpenAI,
    verifiesOnline: false,
  },
  anthropic: {
    name: 'Anthropic (Claude Sonnet 5)',
    supportsImage: true,
    requiresApiKey: true,
    extract: extractAnthropic,
    // Only this provider exposes a server-side web search, so only here can a
    // reading be checked against the world before we believe it.
    extractNutrition: nutritionAnthropic,
    verifiesOnline: true,
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
 * @param {string[]} [opts.knownStores] - list of existing shop names, so the receipt's shop can be matched to one
 * @param {string[]} [opts.knownCategories] - existing category names, so a new ingredient is filed rather than landing in "Uncategorised"
 * @returns {Promise<{items: Array, fees: Array<{description,amount}>, receipt_total: number|null, store_name: string|null, purchase_date: string|null}>}
 */
export async function extractPrices({ provider, apiKey, sessionToken, content, contentType, imageMime, knownIngredients, knownStores, knownCategories }) {
  const p = PROVIDERS[provider]
  if (!p) throw new Error(`Unknown AI provider: ${provider}`)
  if (contentType === 'image' && !p.supportsImage) throw new Error(`${p.name} does not support image input`)
  logger.info('extractPrices', { provider, contentType, contentLength: content?.length, knownCount: knownIngredients?.length })
  try {
    const result = await p.extract({ content, contentType, imageMime, apiKey, sessionToken, knownIngredients, knownStores, knownCategories })
    logger.info('extractPrices ok', { provider, itemCount: result.items.length, feeCount: result.fees.length })
    return result
  } catch (err) {
    logger.error('extractPrices failed', { provider, err: err.message })
    throw err
  }
}

