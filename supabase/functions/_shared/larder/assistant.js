// GENERATED from web/src/lib by scripts/sync-mcp-lib.mjs - edit the original, then re-run.
/**
 * assistant.js — the Larder as a set of tools a language model can call.
 *
 * This is the "larder API" behind the voice/chat assistant (Siri via Anki Life,
 * the Claude app via MCP). It deliberately reuses the app's own modules rather
 * than re-implementing them: a purchase goes through `recordPurchase` exactly
 * like ticking an item off in the shop, the deck is `deckState`, a food reading
 * passes `checkNutrition`. One rulebook, two front ends.
 *
 * Every tool is `{ name, description, input_schema, write, run(ctx, input) }`.
 * `ctx` is `{ houseId, people, defaultPersonId, today }` (see `makeContext`).
 * Writes return an `undo` token; `undo` takes it back. The token only ever names
 * rows in the caller's own house, and RLS checks every statement anyway.
 *
 * Results are plain JSON written for a model to read out loud: names, not ids
 * alone; "unknown" stated as such, never as zero.
 */

import { supabase } from './supabase.js'
import {
  loadLarder, loadLastBought, findOrCreateIngredient, recordPurchase, undoPurchase, setIngredientStock,
} from './larder.js'
import { deckState, sumNutrition, withinPeriod, NUTRIENTS } from './planner.js'
import { checkNutrition } from './nutrition.js'

const STALE_DAYS = 90
const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack']

// ── Context ──────────────────────────────────────────────────────────────────

/** Today's date where Ned lives, not in UTC (a late dinner is still today). */
export function londonToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(now)
}

/**
 * Resolve the house and people the assistant acts for. The assistant signs in as
 * its own member of the house, so `house_users` gives the house; `house_people`
 * (a SECURITY DEFINER RPC) gives the other members' names and daily targets,
 * which RLS on `users` would otherwise hide.
 */
export async function makeContext({ houseId = null, defaultPerson = null, today = londonToday() } = {}) {
  let hid = houseId
  if (!hid) {
    const { data } = await supabase.from('house_users').select('house_id')
    hid = data?.[0]?.house_id
    if (!hid) throw new Error('The assistant user is not a member of any house')
  }
  let people = []
  const { data: rpc, error } = await supabase.rpc('house_people', { p_house_id: hid })
  if (!error && rpc) people = rpc
  const wanted = (defaultPerson ?? '').toLowerCase()
  const person = people.find(p => p.name?.toLowerCase() === wanted) ?? people.find(p => !p.is_assistant) ?? null
  return { houseId: hid, people, defaultPersonId: person?.id ?? null, today }
}

function personFor(ctx, name) {
  if (!name) return ctx.people.find(p => p.id === ctx.defaultPersonId) ?? null
  const n = name.toLowerCase()
  return ctx.people.find(p => p.name?.toLowerCase() === n)
    ?? ctx.people.find(p => p.name?.toLowerCase().startsWith(n))
    ?? null
}

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000)
const round1 = n => (n == null ? null : Math.round(Number(n) * 10) / 10)
const norm = s => String(s ?? '').trim().toLowerCase()

/** Loose name match: whole name, word prefix, or simple plural folding. */
export function nameScore(query, name) {
  const q = norm(query).replace(/s$/, ''), n = norm(name).replace(/s$/, '')
  if (!q) return 0
  if (q === n) return 3
  if (n.split(/\s+/).some(w => w.startsWith(q)) || q.split(/\s+/).every(w => n.includes(w))) return 2
  if (n.includes(q) || q.includes(n)) return 1
  return 0
}

async function larderWithCategories(ctx) {
  const { ingredients, categories } = await loadLarder(ctx.houseId)
  const catName = new Map(categories.map(c => [c.id, c.name]))
  for (const i of ingredients) i.categories = i.categoryIds.map(id => catName.get(id)).filter(Boolean)
  return { ingredients, categories }
}

function matchesCategory(ing, category) {
  if (!category) return true
  const c = norm(category).replace(/(gies|ies|s)$/, '')
  return ing.categories.some(name => {
    const n = norm(name)
    return n.startsWith(c) || c.startsWith(n.replace(/(gies|ies|s)$/, '')) || n.includes(c)
  })
}

async function loadPlanRows(ctx) {
  const [{ data: periods }, { data: components }, { data: allocations }, { data: targets }] = await Promise.all([
    supabase.from('periods').select('*').eq('house_id', ctx.houseId),
    supabase.from('cook_components').select('*, cooks(period_id, cook_date), cook_component_ingredients(*)')
      .eq('house_id', ctx.houseId),
    supabase.from('allocations').select('*').eq('house_id', ctx.houseId),
    supabase.from('ingredient_targets').select('*'),
  ])
  return { periods: periods ?? [], components: components ?? [], allocations: allocations ?? [], targets: targets ?? [] }
}

async function activeList(ctx, { create = null } = {}) {
  const { data } = await supabase.from('shopping_lists').select('*').eq('house_id', ctx.houseId)
  const open = (data ?? []).filter(l => l.status === 'shopping' || l.status === 'building')
    .sort((a, b) => (a.status === 'shopping' ? -1 : 1) - (b.status === 'shopping' ? -1 : 1) || b.id - a.id)
  if (open[0] || !create) return open[0] ?? null
  const { data: made, error } = await supabase.from('shopping_lists').insert(create).select('*').single()
  if (error) throw new Error(error.message)
  return made
}

async function resolveIngredient(ctx, item, { create }) {
  if (item.ingredient_id) {
    const { data } = await supabase.from('ingredients').select('*').eq('id', item.ingredient_id).single()
    if (!data || data.house_id !== ctx.houseId) throw new Error(`No ingredient ${item.ingredient_id} in this house`)
    return { ingredient: data, created: false }
  }
  const { ingredients } = await loadLarder(ctx.houseId, { includeArchived: true })
  const exact = ingredients.find(i => norm(i.name) === norm(item.name))
  if (exact) return { ingredient: exact, created: false }
  const close = ingredients.map(i => [nameScore(item.name, i.name), i]).filter(([s]) => s >= 2).sort((a, b) => b[0] - a[0])
  if (close.length === 1) return { ingredient: close[0][1], created: false, matchedFrom: item.name }
  if (close.length > 1) {
    return { ambiguous: close.slice(0, 5).map(([, i]) => ({ id: i.id, name: i.name })) }
  }
  if (!create) return { missing: true }
  const made = await findOrCreateIngredient({ houseId: ctx.houseId, name: item.name, keep: true })
  return { ingredient: made, created: true }
}

// ── Tools ────────────────────────────────────────────────────────────────────

export const TOOLS = [
  {
    name: 'larder_stock',
    description: 'What is in the house. Lists ingredients with whether they are in stock, the recorded quantity ' +
      '(null = never counted, not zero), categories, when last bought, and a stale flag (in stock but not bought ' +
      `for ${STALE_DAYS}+ days, so possibly gone or old). Filter by a search term, a category, or stock status.`,
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name search, e.g. "tomato"' },
        category: { type: 'string', description: 'Category name, e.g. "veg", "dairy"' },
        status: { type: 'string', enum: ['all', 'in_stock', 'missing', 'stale'], default: 'all' },
      },
    },
    write: false,
    async run(ctx, { query, category, status = 'all' } = {}) {
      const { ingredients, categories } = await larderWithCategories(ctx)
      const last = await loadLastBought(ingredients.map(i => i.id))
      let rows = ingredients
        .filter(i => !query || nameScore(query, i.name) > 0)
        .filter(i => matchesCategory(i, category))
        .map(i => {
          const lastBought = last[i.id]?.slice(0, 10) ?? null
          const age = lastBought ? daysBetween(lastBought, ctx.today) : null
          return {
            id: i.id, name: i.name, in_stock: !!i.has_any,
            quantity: i.stock_qty == null ? null : Number(i.stock_qty), unit: i.stock_unit ?? null,
            categories: i.categories, last_bought: lastBought,
            stale: !!i.has_any && age != null && age >= STALE_DAYS, keep: i.keep !== false,
          }
        })
      if (status === 'in_stock') rows = rows.filter(r => r.in_stock)
      if (status === 'missing') rows = rows.filter(r => !r.in_stock && r.keep)
      if (status === 'stale') rows = rows.filter(r => r.stale)
      return {
        count: rows.length, items: rows.slice(0, 200),
        categories: category && !rows.length ? categories.map(c => c.name) : undefined,
      }
    },
  },

  {
    name: 'find_ingredients',
    description: 'Find larder ingredients by (spoken, possibly misheard) name. Use before writing so a purchase or ' +
      'stock change lands on the existing ingredient instead of creating a duplicate.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    write: false,
    async run(ctx, { query }) {
      const { ingredients } = await larderWithCategories(ctx)
      const hits = ingredients.map(i => [nameScore(query, i.name), i]).filter(([s]) => s > 0)
        .sort((a, b) => b[0] - a[0]).slice(0, 8)
        .map(([score, i]) => ({ id: i.id, name: i.name, in_stock: !!i.has_any, score }))
      return { query, matches: hits }
    },
  },

  {
    name: 'meal_plan',
    description: 'The meal plan: servings allocated to days and slots (breakfast/lunch/dinner), who each is for, ' +
      'and cooked food not yet placed on a day (leftovers in the fridge or freezer, worth using up).',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'YYYY-MM-DD, default today' },
        to: { type: 'string', description: 'YYYY-MM-DD, default from + 6 days' },
      },
    },
    write: false,
    async run(ctx, { from, to } = {}) {
      const start = from || ctx.today
      const end = to || new Date(Date.parse(start) + 6 * 86400000).toISOString().slice(0, 10)
      const { components, allocations } = await loadPlanRows(ctx)
      const byId = new Map(components.map(c => [c.id, c]))
      const who = id => ctx.people.find(p => p.id === id)?.name ?? (id ? `person ${id}` : 'anyone')
      const days = {}
      for (const a of allocations.filter(a => a.on_date >= start && a.on_date <= end)
        .sort((x, y) => x.on_date.localeCompare(y.on_date) || SLOTS.indexOf(x.slot) - SLOTS.indexOf(y.slot))) {
        const c = byId.get(a.component_id)
        ;(days[a.on_date] ??= []).push({
          slot: a.slot, dish: c?.name ?? 'unknown', servings: Number(a.servings), for: who(a.for_user_id),
          frozen: !!c?.frozen,
        })
      }
      const placed = id => allocations.filter(a => a.component_id === id).reduce((t, a) => t + Number(a.servings), 0)
      const leftovers = components.filter(c => !c.gone && !c.eaten)
        .map(c => ({ dish: c.name, servings_left: round1(Number(c.servings_planned) - placed(c.id)), frozen: !!c.frozen,
          cooked: c.cooked_date ?? c.cooks?.cook_date ?? null }))
        .filter(c => c.servings_left > 0)
      return { from: start, to: end, days, unplaced_cooked_food: leftovers }
    },
  },

  {
    name: 'deck',
    description: 'The ingredient quota ("deck") for the current planning period: per ingredient, the target number ' +
      'of cards, cards spent by planned meals, cards cooked but not yet placed (pending), and remaining. Negative ' +
      'remaining means over target (targets, not limits). "uncountable" means the app cannot weigh it (no card ' +
      'weight or an unconverted recipe line), so say so rather than reporting zero. Filter by category, e.g. "veg".',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string' },
        date: { type: 'string', description: 'A date inside the period, default today' },
      },
    },
    write: false,
    async run(ctx, { category, date } = {}) {
      const day = date || ctx.today
      const { periods, components, allocations, targets } = await loadPlanRows(ctx)
      const covering = periods.filter(p => withinPeriod(day, p)).sort((a, b) => b.starts_on.localeCompare(a.starts_on))
      const period = covering[0]
      if (!period) return { period: null, note: `No planning period covers ${day}. Periods: ` +
        (periods.map(p => `${p.name ?? ''} ${p.starts_on}..${p.ends_on}`).join('; ') || 'none') }
      const { ingredients, categories } = await larderWithCategories(ctx)
      const state = deckState({ period, ingredients, targets, components, allocations })
      const rows = ingredients.filter(i => state[i.id] && state[i.id].target > 0 && matchesCategory(i, category))
        .map(i => ({
          name: i.name, categories: i.categories, target: round1(state[i.id].target),
          spent: round1(state[i.id].spent), pending: round1(state[i.id].pending),
          remaining: round1(state[i.id].remaining), uncountable: !!state[i.id].uncountable,
        }))
        .sort((a, b) => b.remaining - a.remaining)
      return {
        period: { name: period.name, starts_on: period.starts_on, ends_on: period.ends_on,
          days_left: daysBetween(day, period.ends_on) + 1 },
        cards: rows,
        categories: category && !rows.length ? categories.map(c => c.name) : undefined,
      }
    },
  },

  {
    name: 'what_can_i_make',
    description: 'Saved dishes ranked by how much of each is in stock, with what is missing. Also flags which ' +
      'in-stock ingredients each dish would use up that are stale, and which have quota cards left. Use it to ' +
      'recommend meals; you may also suggest unsaved dishes from larder_stock.',
    input_schema: {
      type: 'object',
      properties: { max_missing: { type: 'integer', default: 2, description: 'Hide dishes missing more than this' } },
    },
    write: false,
    async run(ctx, { max_missing = 2 } = {}) {
      const [{ data: meals }, { data: lines }, larder, plan] = await Promise.all([
        supabase.from('meals').select('*').eq('house_id', ctx.houseId),
        supabase.from('meal_ingredients').select('*, ingredients(*)'),
        larderWithCategories(ctx),
        loadPlanRows(ctx),
      ])
      const byId = new Map(larder.ingredients.map(i => [i.id, i]))
      const last = await loadLastBought(larder.ingredients.map(i => i.id))
      const period = plan.periods.filter(p => withinPeriod(ctx.today, p))[0]
      const deck = period ? deckState({ period, ingredients: larder.ingredients, ...plan }) : {}
      const out = []
      for (const m of meals ?? []) {
        const mine = (lines ?? []).filter(l => l.meal_id === m.id && byId.has(l.ingredient_id))
        if (!mine.length) continue
        const have = mine.filter(l => byId.get(l.ingredient_id).has_any)
        const missing = mine.filter(l => !byId.get(l.ingredient_id).has_any).map(l => byId.get(l.ingredient_id).name)
        if (missing.length > max_missing) continue
        const stale = have.map(l => byId.get(l.ingredient_id))
          .filter(i => last[i.id] && daysBetween(last[i.id].slice(0, 10), ctx.today) >= STALE_DAYS).map(i => i.name)
        const quota = have.map(l => byId.get(l.ingredient_id))
          .filter(i => (deck[i.id]?.remaining ?? 0) >= 1).map(i => i.name)
        out.push({
          dish: m.name, id: m.id, variant_of: m.parent_id ?? null, servings: m.servings ?? null,
          in_stock_fraction: round1(have.length / mine.length), missing, uses_stale: stale, uses_quota: quota,
        })
      }
      out.sort((a, b) => a.missing.length - b.missing.length || b.uses_stale.length - a.uses_stale.length ||
        b.uses_quota.length - a.uses_quota.length)
      return { dishes: out.slice(0, 25), saved_dishes: (meals ?? []).length }
    },
  },

  {
    name: 'nutrition_day',
    description: 'Calories, protein, fibre, carbs and fat for one person on one day: planned meals allocated to them ' +
      'plus extra food they logged, against their daily targets. Lists ingredients with unknown nutrition (so the ' +
      'total is a lower bound) instead of counting them as zero.',
    input_schema: {
      type: 'object',
      properties: { date: { type: 'string' }, person: { type: 'string', description: 'Default: the main user' } },
    },
    write: false,
    async run(ctx, { date, person } = {}) {
      const day = date || ctx.today
      const who = personFor(ctx, person)
      const plan = await loadPlanRows(ctx)
      const mine = plan.allocations.filter(a => a.on_date === day && (!who || a.for_user_id === who.id))
      const { ingredients } = await loadLarder(ctx.houseId)
      const planned = sumNutrition(mine, plan.components, ingredients)
      const { data: logged } = await supabase.from('food_log').select('*').eq('house_id', ctx.houseId)
      const extra = (logged ?? []).filter(f => f.eaten_on === day && (!who || f.user_id === who.id))
      const totals = { ...planned.totals }
      const add = (key, v) => { if (v != null) totals[key] = (totals[key] ?? 0) + Number(v) }
      for (const f of extra) {
        add('kcal', f.kcal); add('protein', f.protein_g); add('fibre', f.fibre_g); add('carbs', f.carbs_g); add('fat', f.fat_g)
      }
      const rounded = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Math.round(v)]))
      return {
        date: day, person: who?.name ?? null, totals: rounded,
        targets: who ? { kcal: who.target_kcal, protein: who.target_protein_g, fibre: who.target_fibre_g } : null,
        planned_meals: mine.map(a => ({ slot: a.slot, dish: plan.components.find(c => c.id === a.component_id)?.name })),
        logged_food: extra.map(f => ({ id: f.id, slot: f.slot, description: f.description, kcal: f.kcal })),
        unknown_nutrition: planned.missing, nutrients: NUTRIENTS.map(n => n.key),
      }
    },
  },

  {
    name: 'shopping_list',
    description: 'The shopping list in progress (if any): what is on it, how many, and what is already bought.',
    input_schema: { type: 'object', properties: {} },
    write: false,
    async run(ctx) {
      const list = await activeList(ctx)
      if (!list) return { list: null, note: 'No shopping list in progress.' }
      const { data: items } = await supabase.from('shopping_list_items').select('*, ingredients(name)')
        .eq('list_id', list.id)
      return {
        list: { id: list.id, status: list.status },
        items: (items ?? []).map(i => ({ id: i.id, name: i.ingredients?.name, quantity: Number(i.quantity ?? 1),
          bought: !!i.bought })),
      }
    },
  },

  // ── Writes ────────────────────────────────────────────────────────────────

  {
    name: 'record_purchase',
    description: 'Record things that were bought: each goes back in stock (quantity added where the pack size is ' +
      'a weight/volume), its price is logged if given, and it lands in shopping history - the same path as ticking ' +
      'items off in the shop or scanning a receipt. Fills lines on the shopping list in progress, else records a ' +
      'shop of its own for today. Names are matched to existing ingredients; an ambiguous name is not written and ' +
      'the candidates are returned so you can ask. Unknown names are created as new ingredients.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              ingredient_id: { type: 'integer' },
              quantity: { type: 'number', description: 'Number of packs, default 1' },
              pack: { type: 'string', description: 'Pack size, e.g. "400g", "2l", "6pk"' },
              price: { type: 'number', description: 'Price per pack in GBP' },
              label: { type: 'string', description: 'Which product, e.g. "5% fat", "large free range"' },
            },
          },
        },
        shop: { type: 'string', description: 'Shop name if said, e.g. "Tesco"' },
      },
      required: ['items'],
    },
    write: true,
    async run(ctx, { items, shop }) {
      let storeId = null
      if (shop) {
        const { data: stores } = await supabase.from('stores').select('*')
        storeId = (stores ?? []).find(s => nameScore(shop, s.name) >= 2)?.id ?? null
      }
      const recorded = [], skipped = [], undo = []
      let list = null
      for (const item of items) {
        const r = await resolveIngredient(ctx, item, { create: true })
        if (r.ambiguous) { skipped.push({ name: item.name, reason: 'ambiguous', candidates: r.ambiguous }); continue }
        list ??= await activeList(ctx, {
          create: { house_id: ctx.houseId, store_id: storeId, status: 'done', source: 'assistant',
            purchased_on: ctx.today, completed_at: new Date().toISOString(), total_paid: 0 },
        })
        const row = await recordPurchase({
          houseId: ctx.houseId, listId: list.id, ingredientId: r.ingredient.id, quantity: item.quantity ?? 1,
          price: item.price ?? null, unitSizeUnit: item.pack ?? null, label: item.label ?? null, storeId,
          source: 'assistant',
        })
        recorded.push({ name: r.ingredient.name, quantity: item.quantity ?? 1, pack: item.pack ?? null,
          price: item.price ?? null, new_ingredient: r.created, matched_from: r.matchedFrom })
        undo.push({ kind: 'purchase', item_id: row.id })
      }
      return { recorded, skipped, list_status: list?.status ?? null, undo: undo.length ? { steps: undo } : null }
    },
  },

  {
    name: 'set_stock',
    description: 'Correct what is on the shelf for one ingredient. quantity 0 means "we have none" (out of stock); ' +
      'a positive quantity means in stock. Use when Ned says he has run out, used something up, or counts it.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' }, ingredient_id: { type: 'integer' },
        quantity: { type: 'number' }, unit: { type: 'string', description: 'g, ml, unit, tin...' },
      },
      required: ['quantity'],
    },
    write: true,
    async run(ctx, { name, ingredient_id, quantity, unit }) {
      const r = await resolveIngredient(ctx, { name, ingredient_id }, { create: false })
      if (r.ambiguous) return { written: false, reason: 'ambiguous', candidates: r.ambiguous }
      if (r.missing) return { written: false, reason: `No ingredient called "${name}" in the larder` }
      const before = { stock_qty: r.ingredient.stock_qty ?? null, stock_unit: r.ingredient.stock_unit ?? null,
        has_any: r.ingredient.has_any }
      const patch = await setIngredientStock(r.ingredient.id, quantity, unit ?? r.ingredient.stock_unit ?? '')
      return { written: true, name: r.ingredient.name, now: patch,
        undo: { steps: [{ kind: 'stock', ingredient_id: r.ingredient.id, before }] } }
    },
  },

  {
    name: 'add_to_shopping_list',
    description: 'Put items on the shopping list (the one in progress, or a new one). Names are matched to the larder.',
    input_schema: {
      type: 'object',
      properties: {
        items: { type: 'array', items: { type: 'object', properties: {
          name: { type: 'string' }, ingredient_id: { type: 'integer' }, quantity: { type: 'number' } } } },
      },
      required: ['items'],
    },
    write: true,
    async run(ctx, { items }) {
      const list = await activeList(ctx, { create: { house_id: ctx.houseId, status: 'building', source: 'assistant' } })
      const added = [], skipped = [], undo = []
      for (const item of items) {
        const r = await resolveIngredient(ctx, item, { create: true })
        if (r.ambiguous) { skipped.push({ name: item.name, candidates: r.ambiguous }); continue }
        const { data: row, error } = await supabase.from('shopping_list_items').insert({
          house_id: ctx.houseId, list_id: list.id, ingredient_id: r.ingredient.id,
          quantity: item.quantity ?? 1, bought: false, auto_generated: false, source: 'assistant',
        }).select('*').single()
        if (error) throw new Error(error.message)
        added.push({ name: r.ingredient.name, quantity: item.quantity ?? 1, new_ingredient: r.created })
        undo.push({ kind: 'list_item', item_id: row.id })
      }
      return { added, skipped, undo: undo.length ? { steps: undo } : null }
    },
  },

  {
    name: 'log_food',
    description: 'Log something eaten that is not already a planned meal (planned meals allocated to the person ' +
      'already count toward their day - do not log those again). Give your best per-portion estimate of kcal and ' +
      'macros with source "estimated", or "label"/"manual" when Ned read or gave the numbers. The figures are ' +
      'checked for physical plausibility and refused if impossible.',
    input_schema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'What was eaten, e.g. "Pret falafel wrap"' },
        date: { type: 'string' }, slot: { type: 'string', enum: SLOTS }, person: { type: 'string' },
        grams: { type: 'number', description: 'Portion weight if known' },
        kcal: { type: 'number' }, protein_g: { type: 'number' }, carbs_g: { type: 'number' },
        fat_g: { type: 'number' }, fibre_g: { type: 'number' },
        source: { type: 'string', enum: ['estimated', 'label', 'manual'] },
      },
      required: ['description', 'kcal', 'source'],
    },
    write: true,
    async run(ctx, input) {
      const issues = checkPortion(input)
      if (issues.length) return { written: false, reason: 'implausible figures', issues }
      const who = personFor(ctx, input.person)
      const { data, error } = await supabase.from('food_log').insert({
        house_id: ctx.houseId, user_id: who?.id ?? null, eaten_on: input.date || ctx.today,
        slot: input.slot ?? null, description: input.description.trim(), grams: input.grams ?? null,
        kcal: input.kcal, protein_g: input.protein_g ?? null, carbs_g: input.carbs_g ?? null,
        fat_g: input.fat_g ?? null, fibre_g: input.fibre_g ?? null, source: input.source,
      }).select('*').single()
      if (error) throw new Error(error.message)
      return { written: true, id: data.id, person: who?.name ?? null, date: data.eaten_on,
        undo: { steps: [{ kind: 'food_log', id: data.id }] } }
    },
  },

  {
    name: 'undo',
    description: 'Undo an earlier write, using the "undo" token that write returned.',
    input_schema: {
      type: 'object',
      properties: { token: { type: 'object', description: 'The undo object exactly as returned' } },
      required: ['token'],
    },
    write: true,
    async run(ctx, { token }) {
      const done = []
      for (const step of [...(token?.steps ?? [])].reverse()) {
        if (step.kind === 'purchase') {
          const { data: item } = await supabase.from('shopping_list_items').select('*').eq('id', step.item_id).single()
          if (item && item.house_id === ctx.houseId && item.bought) { await undoPurchase(item); done.push(step.kind) }
        } else if (step.kind === 'stock') {
          await supabase.from('ingredients').update(step.before).eq('id', step.ingredient_id).eq('house_id', ctx.houseId)
          done.push(step.kind)
        } else if (step.kind === 'list_item') {
          await supabase.from('shopping_list_items').delete().eq('id', step.item_id).eq('house_id', ctx.houseId)
          done.push(step.kind)
        } else if (step.kind === 'food_log') {
          await supabase.from('food_log').delete().eq('id', step.id).eq('house_id', ctx.houseId)
          done.push(step.kind)
        }
      }
      return { undone: done.length, steps: done }
    },
  },
]

/**
 * Plausibility for one portion (not per 100 g). With a weight we can use the
 * app's own per-100g check; without one, the Atwater cross-check still holds
 * and a single item over 3000 kcal is almost certainly a slip.
 */
export function checkPortion({ grams, kcal, protein_g, carbs_g, fat_g, fibre_g }) {
  const vals = { kcal, protein: protein_g, carbs: carbs_g, fat: fat_g, fibre: fibre_g }
  if (Object.values(vals).some(v => v != null && Number(v) < 0)) return ['figures cannot be negative']
  if (kcal != null && kcal > 3000) return [`${kcal} kcal in one portion is implausible`]
  const scale = grams > 0 ? 100 / grams : null
  const per100 = Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, v == null ? null : scale ? v * scale : v]))
  if (scale) return checkNutrition(per100).severity === 'error' ? checkNutrition(per100).issues : []
  // No weight: only the energy cross-check is meaningful.
  const r = checkNutrition({ ...per100, kcal: null })
  if (r.expectedKcal != null && kcal != null && Math.abs(kcal - r.expectedKcal) > Math.max(60, r.expectedKcal * 0.3)) {
    return [`the macros come to about ${r.expectedKcal} kcal, not ${kcal}`]
  }
  return []
}

export async function runTool(ctx, name, input) {
  const tool = TOOLS.find(t => t.name === name)
  if (!tool) throw new Error(`Unknown tool ${name}`)
  return tool.run(ctx, input ?? {})
}
