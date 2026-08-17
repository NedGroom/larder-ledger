import { parseUnitStr, toBase } from './units.js'

/**
 * planner.js — the arithmetic behind the fortnight planner.
 *
 * The one rule everything else follows: **cards are spent by allocation, not by
 * cooking**. A period's deck is its targets minus every allocation dated inside
 * its range, no matter which period owns the cook. That is what lets two
 * overlapping periods both count a shared day, and what lets a batch cooked
 * straight into the freezer cost nothing until a day is chosen for it.
 *
 * Everything here is a pure function over already-loaded rows — no database, no
 * client — so the sums can be unit-tested directly. Persistence lives in
 * planner-io.js.
 */

export const SLOTS = ['breakfast', 'lunch', 'dinner']
export const NUTRIENTS = [
  { key: 'kcal',    per100: 'kcal_per_100',    label: 'Calories', unit: 'kcal', target: 'target_kcal' },
  { key: 'protein', per100: 'protein_per_100', label: 'Protein',  unit: 'g',    target: 'target_protein_g' },
  { key: 'fibre',   per100: 'fibre_per_100',   label: 'Fibre',    unit: 'g',    target: 'target_fibre_g' },
  { key: 'carbs',   per100: 'carbs_per_100',   label: 'Carbs',    unit: 'g' },
  { key: 'fat',     per100: 'fat_per_100',     label: 'Fat',      unit: 'g' },
]

export const todayStr = () => new Date().toISOString().slice(0, 10)

export function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export const withinPeriod = (dateStr, period) =>
  !!period && dateStr >= period.starts_on && dateStr <= period.ends_on

/** Every period whose range covers this date — more than one when they overlap. */
export const periodsCovering = (periods, dateStr) => periods.filter(p => withinPeriod(dateStr, p))

// ── Quantities ───────────────────────────────────────────────────────────────

/**
 * Best guess at a recipe line's quantity in grams or millilitres.
 * Returns null for units we can't convert ("2 tins", "a handful") — the user
 * fills those in by hand, and a blank simply counts as zero downstream rather
 * than blocking anything.
 */
export function suggestNormalised(quantity, unit) {
  const qty = Number(quantity)
  if (!qty || isNaN(qty)) return null
  const parsed = parseUnitStr(`${qty}${unit ?? ''}`)
  if (!parsed) return null
  const { baseQty, baseUnit } = toBase(parsed.qty, parsed.unit)
  return baseUnit === 'unit' ? null : baseQty
}

/**
 * Scale a dish to the number of servings actually being cooked.
 * A dish stores quantities for its whole yield, so cooking 10 of a 6-serving
 * recipe multiplies every line by 10/6. The result is snapshotted onto the
 * component, so a later edit to the dish can't rewrite a cook that happened.
 */
export function scaleRecipe(mealIngredients, dishYield, plannedServings) {
  const yieldServings = Number(dishYield) > 0 ? Number(dishYield) : 1
  const factor = Number(plannedServings) / yieldServings
  return mealIngredients.map(mi => ({
    ingredient_id: mi.ingredient_id,
    qty_total: mi.qty_normalised != null ? Number(mi.qty_normalised) * factor : null,
    qty_text: [mi.required_quantity, mi.required_unit].filter(Boolean).join(' ') || null,
  }))
}

/** How much of one ingredient a single serving of a component contains, in g/ml. */
export function perServingQty(component, ingredientId) {
  const line = (component.cook_component_ingredients ?? []).find(l => l.ingredient_id === ingredientId)
  if (!line || line.qty_total == null) return 0
  const servings = Number(component.servings_planned) || 1
  return Number(line.qty_total) / servings
}

/** Servings of a component that haven't been placed on a day yet. */
export function unallocatedServings(component, allocations) {
  const placed = allocations
    .filter(a => a.component_id === component.id)
    .reduce((t, a) => t + Number(a.servings || 0), 0)
  return Math.max(0, Number(component.servings_planned || 0) - placed)
}

// ── The deck ─────────────────────────────────────────────────────────────────

/**
 * The state of every card stack for one period.
 *
 * `spent`   — allocations dated inside the period, whoever cooked them.
 * `pending` — servings cooked under this period but not yet placed. Shown, but
 *             not subtracted, so an undistributed cook never reads as free
 *             while also not pretending to be eaten.
 *
 * @returns {Object} ingredientId → { target, spent, pending, remaining }
 */
export function deckState({ period, ingredients, targets, components, allocations }) {
  const byId = new Map(components.map(c => [c.id, c]))
  const state = {}

  const ensure = id => (state[id] ??= { target: 0, spent: 0, pending: 0, remaining: 0 })

  for (const t of targets) {
    if (period && t.period_id !== period.id) continue
    ensure(t.ingredient_id).target = Number(t.target_cards) || 0
  }

  const cardWeight = id => {
    const ing = ingredients.find(i => i.id === id)
    const w = Number(ing?.card_weight)
    return w > 0 ? w : null
  }

  // Spent: every allocation whose date falls in the period, ignoring ownership.
  for (const a of allocations) {
    if (period && !withinPeriod(a.on_date, period)) continue
    const comp = byId.get(a.component_id)
    if (!comp) continue
    for (const line of comp.cook_component_ingredients ?? []) {
      const w = cardWeight(line.ingredient_id)
      if (!w || line.qty_total == null) continue
      const share = Number(a.servings) / (Number(comp.servings_planned) || 1)
      ensure(line.ingredient_id).spent += (Number(line.qty_total) * share) / w
    }
  }

  // Pending: cooked under this period, not yet placed anywhere.
  for (const comp of components) {
    if (comp.gone) continue
    if (period && comp.cooks?.period_id !== period.id) continue
    const left = unallocatedServings(comp, allocations)
    if (left <= 0) continue
    for (const line of comp.cook_component_ingredients ?? []) {
      const w = cardWeight(line.ingredient_id)
      if (!w || line.qty_total == null) continue
      const share = left / (Number(comp.servings_planned) || 1)
      ensure(line.ingredient_id).pending += (Number(line.qty_total) * share) / w
    }
  }

  for (const s of Object.values(state)) s.remaining = s.target - s.spent
  return state
}

/** Round to halves for the rail; the raw grams stay available on inspection. */
export function toHalves(n) {
  return Math.round(Number(n || 0) * 2) / 2
}

export function formatCards(n) {
  const h = toHalves(n)
  const whole = Math.trunc(h)
  const half = Math.abs(h - whole) === 0.5
  if (h === 0) return '0'
  if (!half) return String(whole)
  return whole === 0 ? (h < 0 ? '−½' : '½') : `${whole}½`
}

// ── Nutrition ────────────────────────────────────────────────────────────────

/**
 * Nutrients contributed by one allocation.
 *
 * Unknown values stay unknown: an ingredient with no data recorded is counted
 * in `missing` rather than as zero, so the analyse view can say "as far as I
 * know" instead of confidently reporting a day as low in something.
 */
export function allocationNutrition(allocation, component, ingredients) {
  const totals = Object.fromEntries(NUTRIENTS.map(n => [n.key, 0]))
  const missing = new Set()
  if (!component) return { totals, missing }

  const share = Number(allocation.servings) / (Number(component.servings_planned) || 1)
  for (const line of component.cook_component_ingredients ?? []) {
    if (line.qty_total == null) continue
    const ing = ingredients.find(i => i.id === line.ingredient_id)
    if (!ing) continue
    const grams = Number(line.qty_total) * share
    for (const n of NUTRIENTS) {
      const per100 = ing[n.per100]
      if (per100 == null) { missing.add(ing.name); continue }
      totals[n.key] += (grams / 100) * Number(per100)
    }
  }
  return { totals, missing }
}

/** Sum nutrition across a set of allocations. */
export function sumNutrition(allocations, components, ingredients) {
  const byId = new Map(components.map(c => [c.id, c]))
  const totals = Object.fromEntries(NUTRIENTS.map(n => [n.key, 0]))
  const missing = new Set()
  for (const a of allocations) {
    const { totals: t, missing: m } = allocationNutrition(a, byId.get(a.component_id), ingredients)
    for (const n of NUTRIENTS) totals[n.key] += t[n.key]
    m.forEach(x => missing.add(x))
  }
  return { totals, missing: [...missing] }
}

// ── Dealing ──────────────────────────────────────────────────────────────────

/**
 * Deal a handful of stacks that still have cards left. Random rather than
 * scored — the scoring engine was explicitly cut as more fun to write than to
 * use — and re-runnable so another press offers a different hand.
 */
export function dealFromDeck(deck, ingredients, count = 6) {
  const undealt = ingredients.filter(i => (deck[i.id]?.remaining ?? 0) >= 1)
  for (let i = undealt.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[undealt[i], undealt[j]] = [undealt[j], undealt[i]]
  }
  return undealt.slice(0, count)
}

// ── Periods ─────────────────────────────────────────────────────────────────

/**
 * Which period the planner should open on: the first one that hasn't finished,
 * else the most recent.
 */
export function defaultPeriod(periods, today = todayStr()) {
  if (!periods.length) return null
  const unfinished = [...periods].filter(p => p.ends_on >= today).sort((a, b) => a.starts_on.localeCompare(b.starts_on))
  return unfinished[0] ?? periods[0]
}

/** A fortnight starting today — the default shape for a brand new period. */
export function newPeriodDates(from = todayStr()) {
  return { starts_on: from, ends_on: addDays(from, 13) }
}

/**
 * Editing a period's dates must not strand allocations that belong to it.
 * Returns the ones that would fall outside, so the UI can block and say which.
 */
export function allocationsStranded(period, nextDates, allocations) {
  return allocations.filter(a =>
    a.period_id === period.id &&
    (a.on_date < nextDates.starts_on || a.on_date > nextDates.ends_on))
}

/** What a period's planned cooks require in total, per ingredient (g/ml). */
export function requirementsForPeriod(period, components) {
  const need = {}
  for (const c of components) {
    if (period && c.cooks?.period_id !== period.id) continue
    for (const line of c.cook_component_ingredients ?? []) {
      if (line.qty_total == null) continue
      need[line.ingredient_id] = (need[line.ingredient_id] ?? 0) + Number(line.qty_total)
    }
  }
  return need
}
