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
 *
 * Archived ingredients are left out unless asked for, and separated out rather
 * than dropped so the Larder can offer to bring them back. The filter is done
 * here rather than in the query so an older database without the column still
 * loads — every row simply reads as active.
 *
 * @returns {Promise<{ ingredients: Array, archived: Array, categories: Array }>}
 */
export async function loadLarder(houseId, { includeArchived = false } = {}) {
  const [{ data: ings }, { data: cats }] = await Promise.all([
    supabase.from('ingredients').select('*').eq('house_id', houseId).order('name'),
    supabase.from('categories').select('*').eq('house_id', houseId).order('name'),
  ])
  const all = ings ?? []
  const ingredients = includeArchived ? all : all.filter(i => !i.archived)
  const archivedRows = all.filter(i => i.archived)
  const categories = cats ?? []

  let links = []
  if (all.length) {
    const { data } = await supabase
      .from('ingredient_categories')
      .select('ingredient_id, category_id')
      .in('ingredient_id', all.map(i => i.id))
    links = data ?? []
  }

  const byIngredient = {}
  for (const l of links) (byIngredient[l.ingredient_id] ??= []).push(l.category_id)

  const withCats = i => ({ ...i, categoryIds: byIngredient[i.id] ?? [] })
  return {
    ingredients: ingredients.map(withCats),
    archived: archivedRows.map(withCats),
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
  if (existing) {
    // Typing a retired ingredient's name back in is a request for it back —
    // and the alternative is a unique-key error on a row you can't even see.
    if (existing.archived) {
      await supabase.from('ingredients').update({ archived: false }).eq('id', existing.id)
      return { ...existing, archived: false, categoryIds: [], _created: false, _revived: true }
    }
    return { ...existing, categoryIds: [], _created: false }
  }

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

// ── Editing and retiring an ingredient ───────────────────────────────────────

/**
 * Rename an ingredient, keeping the normalised form in step.
 *
 * The house can't hold two ingredients with the same normalised name, so
 * renaming onto an existing one is reported as a collision rather than failing
 * with a database error — the caller can then offer to merge instead, which is
 * almost always what was actually wanted.
 */
export async function renameIngredient(ingredient, name) {
  const clean = name.trim()
  if (!clean) throw new Error('Name required')
  const normalized = clean.toLowerCase()
  if (normalized === ingredient.name_normalized) {
    // Same word, different capitalisation — worth saving, no collision check.
    if (clean === ingredient.name) return ingredient
  } else {
    const { data: clash } = await supabase
      .from('ingredients').select('id, name')
      .eq('house_id', ingredient.house_id).eq('name_normalized', normalized)
      .maybeSingle()
    if (clash) {
      const err = new Error(`You already have an ingredient called "${clash.name}".`)
      err.collidesWith = clash
      throw err
    }
  }

  const { data, error } = await supabase
    .from('ingredients')
    .update({ name: clean, name_normalized: normalized })
    .eq('id', ingredient.id).select('*').single()
  if (error) throw new Error(error.message)
  return { ...ingredient, ...data }
}

/**
 * Everything that would be lost if this ingredient were deleted outright.
 * Shown before the fact, because the foreign keys cascade into recipes, past
 * shops and past cooks — history the user may well want to keep.
 */
export async function ingredientUsage(ingredientId) {
  const count = async (table, column = 'ingredient_id') => {
    const { count: n } = await supabase
      .from(table).select('*', { count: 'exact', head: true }).eq(column, ingredientId)
    return n ?? 0
  }
  const [prices, recipes, purchases, targets, cookLines] = await Promise.all([
    count('ingredient_prices'),
    count('meal_ingredients'),
    count('shopping_list_items'),
    count('ingredient_targets'),
    count('cook_component_ingredients'),
  ])
  return { prices, recipes, purchases, targets, cookLines,
           total: prices + recipes + purchases + targets + cookLines }
}

/** Retire an ingredient without touching anything that references it. */
export async function setIngredientArchived(ingredientId, archived) {
  const { error } = await supabase
    .from('ingredients').update({ archived }).eq('id', ingredientId)
  if (error) throw new Error(error.message)
}

/**
 * Delete an ingredient outright. The database cascades this into its prices,
 * recipe lines, past purchases, targets and cook lines — so the caller must
 * have shown `ingredientUsage` first and had it confirmed.
 */
export async function deleteIngredient(ingredientId) {
  const { error } = await supabase.from('ingredients').delete().eq('id', ingredientId)
  if (error) throw new Error(error.message)
}

/** Drop a single recorded price. */
export async function deletePrice(priceId) {
  const { error } = await supabase.from('ingredient_prices').delete().eq('id', priceId)
  if (error) throw new Error(error.message)
}

/**
 * Fold one ingredient into another, moving its history rather than losing it.
 *
 * This is the real answer to near-duplicates ("Tomatos" beside "Tomatoes"):
 * prices, recipe lines, purchases and cook lines all move to the target, and
 * the source is deleted once it holds nothing.
 *
 * Where a row would collide with one the target already has — the same category,
 * the same period's target, the same recipe — the source's row is dropped rather
 * than duplicated, since the target's is the one being kept.
 */
export async function mergeIngredients(sourceId, targetId) {
  if (sourceId === targetId) throw new Error('Cannot merge an ingredient into itself')

  // Straight moves: nothing constrains these to be unique.
  for (const table of ['ingredient_prices', 'shopping_list_items', 'cook_component_ingredients']) {
    const { error } = await supabase.from(table)
      .update({ ingredient_id: targetId }).eq('ingredient_id', sourceId)
    if (error) throw new Error(`${table}: ${error.message}`)
  }

  // A bare-ingredient cook component points at it directly too.
  await supabase.from('cook_components').update({ ingredient_id: targetId }).eq('ingredient_id', sourceId)

  // Categories: primary key is (ingredient, category), so skip any the target has.
  const [{ data: srcCats }, { data: tgtCats }] = await Promise.all([
    supabase.from('ingredient_categories').select('category_id').eq('ingredient_id', sourceId),
    supabase.from('ingredient_categories').select('category_id').eq('ingredient_id', targetId),
  ])
  const have = new Set((tgtCats ?? []).map(r => r.category_id))
  const toAdd = (srcCats ?? []).map(r => r.category_id).filter(id => !have.has(id))
  if (toAdd.length) {
    await supabase.from('ingredient_categories')
      .insert(toAdd.map(category_id => ({ ingredient_id: targetId, category_id })))
  }

  // Recipe lines. Nothing in the database stops one dish holding two lines for
  // the same ingredient, so there's no collision to dodge here — only a
  // quantity to avoid losing. Where the two lines are comparable (the same
  // unit, or both carrying a normalised figure) they're added together; where
  // they aren't, both survive for the cook to reconcile by eye, which is far
  // better than quietly halving the tomatoes.
  const [{ data: srcLines }, { data: tgtLines }] = await Promise.all([
    supabase.from('meal_ingredients')
      .select('id, meal_id, required_quantity, required_unit, qty_normalised').eq('ingredient_id', sourceId),
    supabase.from('meal_ingredients')
      .select('id, meal_id, required_quantity, required_unit, qty_normalised').eq('ingredient_id', targetId),
  ])
  const lineInMeal = new Map((tgtLines ?? []).map(r => [r.meal_id, r]))
  for (const line of (srcLines ?? [])) {
    const kept = lineInMeal.get(line.meal_id)
    if (!kept) {
      await supabase.from('meal_ingredients').update({ ingredient_id: targetId }).eq('id', line.id)
      lineInMeal.set(line.meal_id, { ...line, id: line.id })
      continue
    }

    const patch = {}
    const sameUnit = (line.required_unit ?? null) === (kept.required_unit ?? null)
      && line.required_quantity != null && kept.required_quantity != null
    if (sameUnit) patch.required_quantity = Number(kept.required_quantity) + Number(line.required_quantity)
    if (line.qty_normalised != null && kept.qty_normalised != null) {
      patch.qty_normalised = Number(kept.qty_normalised) + Number(line.qty_normalised)
    }

    if (Object.keys(patch).length) {
      await supabase.from('meal_ingredients').update(patch).eq('id', kept.id)
      Object.assign(kept, patch)          // a second source line adds onto the new total
      await supabase.from('meal_ingredients').delete().eq('id', line.id)
    } else {
      // Not comparable — keep both rather than pick a winner.
      await supabase.from('meal_ingredients').update({ ingredient_id: targetId }).eq('id', line.id)
    }
  }

  // Deck targets: unique per (period, ingredient). Keep the larger of the two —
  // merging two halves of one thing shouldn't quietly shrink the target.
  const [{ data: srcTargets }, { data: tgtTargets }] = await Promise.all([
    supabase.from('ingredient_targets').select('*').eq('ingredient_id', sourceId),
    supabase.from('ingredient_targets').select('*').eq('ingredient_id', targetId),
  ])
  const byPeriod = new Map((tgtTargets ?? []).map(t => [t.period_id, t]))
  for (const t of (srcTargets ?? [])) {
    const existing = byPeriod.get(t.period_id)
    if (existing) {
      if (Number(t.target_cards) > Number(existing.target_cards)) {
        await supabase.from('ingredient_targets')
          .update({ target_cards: t.target_cards }).eq('id', existing.id)
      }
      await supabase.from('ingredient_targets').delete().eq('id', t.id)
    } else {
      await supabase.from('ingredient_targets').update({ ingredient_id: targetId }).eq('id', t.id)
    }
  }

  // Anything the source knew that the target doesn't is worth keeping.
  const [{ data: src }, { data: tgt }] = await Promise.all([
    supabase.from('ingredients').select('*').eq('id', sourceId).single(),
    supabase.from('ingredients').select('*').eq('id', targetId).single(),
  ])
  if (src && tgt) {
    const fill = {}
    for (const f of ['card_weight', 'qualitative_note', 'canonical_rate_unit', 'canonical_unit',
                     'kcal_per_100', 'protein_per_100', 'fibre_per_100', 'carbs_per_100', 'fat_per_100']) {
      if (tgt[f] == null && src[f] != null) fill[f] = src[f]
    }
    if (src.has_any && !tgt.has_any) fill.has_any = true
    if (Object.keys(fill).length) {
      await supabase.from('ingredients').update(fill).eq('id', targetId)
    }
  }

  const { error } = await supabase.from('ingredients').delete().eq('id', sourceId)
  if (error) throw new Error(error.message)
}
