import { supabase } from './supabase.js'
import { defaultCanonicalRateUnit, calcCanonicalRate } from './units.js'

/**
 * larder.js — the shared vocabulary of the Larder.
 *
 * Both the Larder tab and the Shopping tab read the larder through here, so the
 * two views can't drift apart: same ingredients, same categories, same grouping,
 * same idea of what a price is.
 *
 * It also owns `recordPurchase`, the single way anything becomes "bought".
 * Marking an item off in the shop and importing a line from a receipt are the
 * same event, so they run the same code and leave the same rows behind.
 */

export const UNCATEGORISED = '__uncategorised__'

// ── Reading ──────────────────────────────────────────────────────────────────

/**
 * Load every ingredient in the house with its category ids attached, plus the
 * house's category list.
 * @returns {Promise<{ ingredients: Array, categories: Array }>}
 */
export async function loadLarder(houseId) {
  const [{ data: ings }, { data: cats }] = await Promise.all([
    supabase.from('ingredients').select('*').eq('house_id', houseId).order('name'),
    supabase.from('categories').select('*').eq('house_id', houseId).order('name'),
  ])
  const ingredients = ings ?? []
  const categories = cats ?? []

  let links = []
  if (ingredients.length) {
    const { data } = await supabase
      .from('ingredient_categories')
      .select('ingredient_id, category_id')
      .in('ingredient_id', ingredients.map(i => i.id))
    links = data ?? []
  }

  const byIngredient = {}
  for (const l of links) (byIngredient[l.ingredient_id] ??= []).push(l.category_id)

  return {
    ingredients: ingredients.map(i => ({ ...i, categoryIds: byIngredient[i.id] ?? [] })),
    categories,
  }
}

/**
 * Latest known price per (ingredient, store), for price previews.
 * Keyed `map[ingredientId][storeId ?? '_']`.
 */
export async function loadPrices(ingredientIds) {
  if (!ingredientIds?.length) return {}
  const { data } = await supabase
    .from('ingredient_prices')
    .select('ingredient_id, store_id, price, noted_at')
    .in('ingredient_id', ingredientIds)
    .order('noted_at', { ascending: false })

  const map = {}
  for (const row of (data ?? [])) {
    const k = row.store_id ?? '_'
    map[row.ingredient_id] ??= {}
    if (map[row.ingredient_id][k] == null) map[row.ingredient_id][k] = row.price // first = latest
  }
  return map
}

/**
 * Price for one ingredient at the chosen shop, or the cheapest known price
 * across all shops when no shop is chosen.
 */
export function priceFor(pricesByIng, ingredientId, storeId) {
  const byStore = pricesByIng?.[ingredientId]
  if (!byStore) return null
  if (storeId) return byStore[storeId] ?? null
  const vals = Object.values(byStore).filter(v => v != null)
  return vals.length ? Math.min(...vals) : null
}

/**
 * Group ingredients into the sections the browser scrolls through.
 *
 * An ingredient in several categories appears under each of them — duplicates
 * across sections are the point, not a bug. Anything uncategorised collects in
 * a final section so nothing can hide from the list.
 *
 * Within a section, what the house is out of floats to the top.
 */
export function groupByCategory(ingredients, categories) {
  const sections = categories
    .map(c => ({
      key: String(c.id),
      id: c.id,
      name: c.name,
      items: ingredients.filter(i => (i.categoryIds ?? []).includes(c.id)),
    }))
    .filter(s => s.items.length > 0)

  const loose = ingredients.filter(i => (i.categoryIds ?? []).length === 0)
  if (loose.length) {
    sections.push({ key: UNCATEGORISED, id: null, name: 'Uncategorised', items: loose })
  }

  const rank = i => (i.has_any ? 1 : 0)   // missing first
  for (const s of sections) {
    s.items = [...s.items].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  }
  return sections
}

// ── Writing ──────────────────────────────────────────────────────────────────

/**
 * Create an ingredient, or return the existing one if the house already has it
 * under that name. Typing a name anywhere in the app — the Larder, the shopping
 * list, a receipt — lands here, so nothing is ever remembered as a loose string.
 */
export async function findOrCreateIngredient({ houseId, name, keep = true, unitSizeUnit = null }) {
  const clean = name.trim()
  if (!clean) throw new Error('Name required')
  const normalized = clean.toLowerCase()

  const { data: existing } = await supabase
    .from('ingredients')
    .select('*')
    .eq('house_id', houseId)
    .eq('name_normalized', normalized)
    .maybeSingle()
  if (existing) return { ...existing, categoryIds: [], _created: false }

  const { data, error } = await supabase
    .from('ingredients')
    .insert({
      house_id: houseId,
      name: clean,
      name_normalized: normalized,
      has_any: false,
      keep,
      canonical_rate_unit: unitSizeUnit ? defaultCanonicalRateUnit(unitSizeUnit) : null,
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return { ...data, categoryIds: [], _created: true }
}

/** Same idea for categories: type a name, get a row back. */
export async function findOrCreateCategory({ houseId, name }) {
  const clean = name.trim()
  if (!clean) throw new Error('Name required')
  const normalized = clean.toLowerCase()

  const { data: existing } = await supabase
    .from('categories')
    .select('*')
    .eq('house_id', houseId)
    .eq('name_normalized', normalized)
    .maybeSingle()
  if (existing) return existing

  const { data, error } = await supabase
    .from('categories')
    .insert({ house_id: houseId, name: clean, name_normalized: normalized })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data
}

/** Replace an ingredient's categories with exactly this set. */
export async function setIngredientCategories(ingredientId, categoryIds) {
  await supabase.from('ingredient_categories').delete().eq('ingredient_id', ingredientId)
  if (categoryIds.length) {
    const { error } = await supabase
      .from('ingredient_categories')
      .insert(categoryIds.map(category_id => ({ ingredient_id: ingredientId, category_id })))
    if (error) throw new Error(error.message)
  }
}

/**
 * Record that an ingredient was bought.
 *
 * This is the one path into "bought" state, whether the buy came from ticking
 * an item off in the shop or from a line on a scanned receipt. It:
 *   - fills in the matching unbought line on the list, or adds a new line if
 *     the buy wasn't planned (you picked it up anyway, or the receipt knew
 *     about something the list didn't),
 *   - logs the price against the shop, with a canonical rate where the pack
 *     size makes one calculable, and the product label if one is known,
 *   - puts the ingredient back in stock,
 *   - remembers which price row it wrote, so undoing the buy can retract it.
 *
 * @returns {Promise<object>} the shopping_list_items row
 */
export async function recordPurchase({
  houseId, listId, ingredientId, itemId = null, quantity = 1, price = null,
  unitSizeUnit = null, label = null, forUserId = null, storeId = null, source = 'manual',
}) {
  const qty = Math.max(1, Number(quantity) || 1)
  const unitPrice = price === '' || price == null || isNaN(Number(price)) ? null : Number(price)

  // Log the price first so the item row can point at it.
  let priceId = null
  if (unitPrice != null) {
    const { data: ing } = await supabase
      .from('ingredients').select('canonical_rate_unit').eq('id', ingredientId).single()

    const rateUnit = ing?.canonical_rate_unit || (unitSizeUnit ? defaultCanonicalRateUnit(unitSizeUnit) : null)
    const rate = unitSizeUnit && rateUnit ? calcCanonicalRate(unitPrice, unitSizeUnit, rateUnit) : null

    const { data: priceRow, error: priceErr } = await supabase
      .from('ingredient_prices')
      .insert({
        ingredient_id: ingredientId,
        store_id: storeId ? Number(storeId) : null,
        price: unitPrice,
        // Which product this actually was — "large, free range", "5% fat".
        // Without it, two very different things under one ingredient are
        // indistinguishable in the price comparison.
        label: (label ?? '').trim() || null,
        unit_size_unit: unitSizeUnit || null,
        canonical_rate: rate,
        canonical_rate_unit: rate != null ? rateUnit : null,
        currency: 'GBP',
        source,
      })
      .select('id')
      .single()
    if (priceErr) throw new Error(priceErr.message)
    priceId = priceRow.id
  }

  const patch = {
    quantity: qty,
    bought: true,
    bought_at: new Date().toISOString(),
    price_paid: unitPrice,
    unit_size_unit: unitSizeUnit || null,
    for_user_id: forUserId ? Number(forUserId) : null,
    price_id: priceId,
    source,
  }

  // Ticking a specific row off names it outright. A receipt doesn't know about
  // rows, so it fills the oldest unbought line for the ingredient instead —
  // which is how a scan ticks off what you'd already planned to buy.
  let planned = itemId ? { id: itemId } : null
  if (!planned) {
    const { data } = await supabase
      .from('shopping_list_items')
      .select('id')
      .eq('list_id', listId)
      .eq('ingredient_id', ingredientId)
      .eq('bought', false)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    planned = data
  }

  let row
  if (planned) {
    const { data, error } = await supabase
      .from('shopping_list_items')
      .update(patch).eq('id', planned.id)
      .select('*, ingredients(name), meals(name)').single()
    if (error) throw new Error(error.message)
    row = data
  } else {
    const { data, error } = await supabase
      .from('shopping_list_items')
      .insert({ house_id: houseId, list_id: listId, ingredient_id: ingredientId, auto_generated: false, ...patch })
      .select('*, ingredients(name), meals(name)').single()
    if (error) throw new Error(error.message)
    row = data
  }

  await supabase.from('ingredients').update({ has_any: true }).eq('id', ingredientId)
  return row
}

/**
 * Undo a purchase: put the line back to unbought and retract the price it
 * logged, so a mis-tap doesn't leave a wrong price in the shop comparison.
 *
 * The ingredient stays in stock — we don't know whether the house had some
 * already, and quietly marking it missing would be the more destructive guess.
 */
export async function undoPurchase(item) {
  if (item.price_id) {
    await supabase.from('ingredient_prices').delete().eq('id', item.price_id)
  }
  const patch = { bought: false, bought_at: null, price_paid: null, price_id: null }
  const { data, error } = await supabase
    .from('shopping_list_items')
    .update(patch).eq('id', item.id)
    .select('*, ingredients(name), meals(name)').single()
  if (error) throw new Error(error.message)
  return data
}
