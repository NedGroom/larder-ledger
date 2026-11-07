/**
 * The assistant's tools (web/src/lib/assistant.js) against the fake Supabase, in
 * plain Node — no browser. A real supabase-js client is pointed at the fake via
 * `fakeFetch`, so every read and write goes through the same code the app uses
 * (recordPurchase, setIngredientStock, deckState...) and the test asserts on the
 * rows actually written.
 *
 *   cd web && npm install && node test/assistant.test.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { makeDb, fakeFetch, checker } from './fake-supabase.mjs'
import { useSupabaseClient } from '../src/lib/supabase.js'
import { TOOLS, makeContext, runTool, nameScore, checkPortion, londonToday } from '../src/lib/assistant.js'

const check = checker()
const today = londonToday()
const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString()
const addDays = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10)

const db = makeDb({
  users: [
    { id: 1, auth_uid: 'uid-1', name: 'Ned', target_kcal: 2400, target_protein_g: 120, target_fibre_g: 30 },
    { id: 2, auth_uid: 'uid-bot', name: 'Assistant', is_assistant: true },
  ],
  house_users: [{ house_id: 1, user_id: 1 }, { house_id: 1, user_id: 2 }],
  categories: [{ id: 1, house_id: 1, name: 'Veg', name_normalized: 'veg' }, { id: 2, house_id: 1, name: 'Tins', name_normalized: 'tins' }],
  ingredients: [
    { id: 10, house_id: 1, name: 'Tomatoes', name_normalized: 'tomatoes', has_any: true, keep: true, stock_qty: 800, stock_unit: 'g' },
    { id: 11, house_id: 1, name: 'Spinach', name_normalized: 'spinach', has_any: true, keep: true, card_weight: 80, kcal_per_100: 23, protein_per_100: 2.9, fibre_per_100: 2.2, carbs_per_100: 1.4, fat_per_100: 0.4 },
    { id: 12, house_id: 1, name: 'Chickpeas', name_normalized: 'chickpeas', has_any: false, keep: true },
    { id: 13, house_id: 1, name: 'Onion', name_normalized: 'onion', has_any: true, keep: true },
    { id: 14, house_id: 1, name: 'Oat milk', name_normalized: 'oat milk', has_any: false, keep: true },
    { id: 15, house_id: 1, name: 'Red pepper', name_normalized: 'red pepper', has_any: true, keep: true },
    { id: 16, house_id: 1, name: 'Green pepper', name_normalized: 'green pepper', has_any: true, keep: true },
  ],
  ingredient_categories: [
    { ingredient_id: 10, category_id: 1 }, { ingredient_id: 11, category_id: 1 }, { ingredient_id: 13, category_id: 1 },
    { ingredient_id: 12, category_id: 2 },
  ],
  stores: [{ id: 5, name: 'Tesco' }],
  meals: [
    { id: 30, house_id: 1, name: 'Chickpea curry', servings: 4 },
    { id: 31, house_id: 1, name: 'Tomato pasta', servings: 2 },
  ],
  meal_ingredients: [
    { id: 1, meal_id: 30, ingredient_id: 12 }, { id: 2, meal_id: 30, ingredient_id: 10 },
    { id: 3, meal_id: 30, ingredient_id: 13 }, { id: 4, meal_id: 30, ingredient_id: 11 },
    { id: 5, meal_id: 31, ingredient_id: 10 }, { id: 6, meal_id: 31, ingredient_id: 13 },
  ],
  shopping_lists: [{ id: 40, house_id: 1, status: 'done', source: 'receipt' }],
  shopping_list_items: [
    { id: 41, house_id: 1, list_id: 40, ingredient_id: 13, quantity: 1, bought: true, bought_at: daysAgo(120) },
  ],
  periods: [{ id: 50, house_id: 1, name: 'This fortnight', starts_on: addDays(today, -3), ends_on: addDays(today, 10) }],
  ingredient_targets: [{ id: 51, period_id: 50, ingredient_id: 11, target_cards: 5 }],
  cooks: [{ id: 60, house_id: 1, period_id: 50, cook_date: today }],
  cook_components: [{ id: 61, house_id: 1, cook_id: 60, meal_id: 30, name: 'Chickpea curry', servings_planned: 4 }],
  cook_component_ingredients: [{ id: 62, component_id: 61, ingredient_id: 11, qty_total: 240 }],
  allocations: [{ id: 70, house_id: 1, component_id: 61, period_id: 50, on_date: today, slot: 'dinner', servings: 1, for_user_id: 1 }],
  food_log: [],
})

useSupabaseClient(createClient('http://fake.local', 'anon', {
  global: { fetch: fakeFetch(db) }, auth: { persistSession: false, autoRefreshToken: false },
}))

const ctx = await makeContext({ defaultPerson: 'Ned' })
check('context: house and default person resolved', ctx.houseId === 1 && ctx.defaultPersonId === 1, JSON.stringify(ctx))

// ── Reads ────────────────────────────────────────────────────────────────────
const stale = await runTool(ctx, 'larder_stock', { status: 'stale' })
check('stock: onion bought 120 days ago reads as stale', stale.items.map(i => i.name).join() === 'Onion')

const veg = await runTool(ctx, 'larder_stock', { category: 'veggies' })
check('stock: "veggies" finds the Veg category', veg.items.map(i => i.name).sort().join() === 'Onion,Spinach,Tomatoes')
check('stock: uncounted quantity is null, not zero', veg.items.find(i => i.name === 'Spinach').quantity === null)

const missing = await runTool(ctx, 'larder_stock', { status: 'missing' })
check('stock: missing lists kept items not in stock', missing.items.map(i => i.name).sort().join() === 'Chickpeas,Oat milk')

const found = await runTool(ctx, 'find_ingredients', { query: 'tomato' })
check('find: "tomato" finds Tomatoes', found.matches[0]?.name === 'Tomatoes')
check('nameScore: plural folding and word prefix', nameScore('peppers', 'Red pepper') === 2 && nameScore('oat', 'Oat milk') === 2)

const deck = await runTool(ctx, 'deck', { category: 'veg' })
const spinach = deck.cards.find(c => c.name === 'Spinach')
// 1 of 4 servings allocated → 60 g of spinach at 80 g a card = 0.75 cards spent.
check('deck: spinach 5 target, 0.8 spent, 4.3 left', spinach && spinach.target === 5 && spinach.spent === 0.8 && spinach.remaining === 4.3,
  JSON.stringify(spinach))
check('deck: period and days left reported', deck.period?.days_left === 11)

const make = await runTool(ctx, 'what_can_i_make', {})
check('make: pasta (nothing missing) ranks above curry', make.dishes[0]?.dish === 'Tomato pasta')
check('make: curry says chickpeas are missing', make.dishes.find(d => d.dish === 'Chickpea curry')?.missing.join() === 'Chickpeas')
check('make: curry would use stale onion and quota spinach',
  make.dishes.find(d => d.dish === 'Chickpea curry')?.uses_stale.includes('Onion') &&
  make.dishes.find(d => d.dish === 'Chickpea curry')?.uses_quota.includes('Spinach'))

const plan = await runTool(ctx, 'meal_plan', {})
check('plan: tonight is chickpea curry for Ned', plan.days[today]?.[0]?.dish === 'Chickpea curry' && plan.days[today][0].for === 'Ned')
check('plan: 3 cooked servings not yet placed', plan.unplaced_cooked_food[0]?.servings_left === 3)

const day1 = await runTool(ctx, 'nutrition_day', {})
check('nutrition: planned curry counts toward Ned (60g spinach = 14 kcal)', day1.totals.kcal === 14 && day1.targets.kcal === 2400,
  JSON.stringify(day1.totals))

// ── Writes ───────────────────────────────────────────────────────────────────
const bought = await runTool(ctx, 'record_purchase', {
  shop: 'tesco',
  items: [{ name: 'chickpeas', quantity: 2, pack: '400g', price: 0.75 }, { name: 'oat milk' }, { name: 'pepper' }],
})
const chick = db.ingredients.find(i => i.id === 12)
check('purchase: chickpeas back in stock with 800 g', chick.has_any === true && chick.stock_qty === 800 && chick.stock_unit === 'g')
check('purchase: price logged at Tesco with a per-unit rate',
  db.ingredient_prices.some(p => p.ingredient_id === 12 && p.price === 0.75 && p.store_id === 5 && p.source === 'assistant'))
check('purchase: recorded as its own completed shop for today',
  db.shopping_lists.some(l => l.source === 'assistant' && l.status === 'done' && l.purchased_on === today))
check('purchase: existing oat milk matched, not duplicated',
  db.ingredients.filter(i => i.name_normalized === 'oat milk').length === 1 && db.ingredients.find(i => i.id === 14).has_any)
check('purchase: ambiguous "pepper" not written, candidates offered',
  bought.skipped[0]?.reason === 'ambiguous' && bought.skipped[0].candidates.length === 2)
check('purchase: undo token returned for both writes', bought.undo?.steps.length === 2)

await runTool(ctx, 'undo', { token: bought.undo })
check('undo: purchase price retracted', !db.ingredient_prices.some(p => p.ingredient_id === 12))
check('undo: lines back to unbought', db.shopping_list_items.filter(i => i.source === 'assistant' && i.bought).length === 0)

const out = await runTool(ctx, 'set_stock', { name: 'spinach', quantity: 0 })
check('stock: spinach set to none', db.ingredients.find(i => i.id === 11).has_any === false && out.written)
await runTool(ctx, 'undo', { token: out.undo })
check('stock: undo restores it', db.ingredients.find(i => i.id === 11).has_any === true && db.ingredients.find(i => i.id === 11).stock_qty == null)
const nope = await runTool(ctx, 'set_stock', { name: 'saffron', quantity: 1 })
check('stock: unknown ingredient is not created by a correction', nope.written === false)

const listed = await runTool(ctx, 'add_to_shopping_list', { items: [{ name: 'Lemons', quantity: 3 }] })
check('list: new ingredient created and put on a building list',
  listed.added[0]?.new_ingredient && db.shopping_lists.some(l => l.status === 'building' && l.source === 'assistant'))
const list = await runTool(ctx, 'shopping_list', {})
check('list: reads back what is on it', list.items.some(i => i.name === 'Lemons' && i.quantity === 3))

const silly = await runTool(ctx, 'log_food', { description: 'cake', kcal: 5000, source: 'estimated' })
check('food: 5000 kcal portion refused', silly.written === false)
const wrap = await runTool(ctx, 'log_food', { description: 'Pret falafel wrap', slot: 'lunch', kcal: 520,
  protein_g: 16, carbs_g: 62, fat_g: 22, fibre_g: 9, source: 'estimated' })
check('food: plausible wrap logged for Ned today', wrap.written && db.food_log[0]?.user_id === 1 && db.food_log[0].eaten_on === today)
const day2 = await runTool(ctx, 'nutrition_day', {})
check('nutrition: wrap adds to the day', day2.totals.kcal === 534 && day2.logged_food.length === 1)
check('portion check: macros that disagree with kcal are refused',
  checkPortion({ kcal: 100, protein_g: 30, carbs_g: 60, fat_g: 30 }).length === 1)

// ── Plumbing ─────────────────────────────────────────────────────────────────
check('every tool has a schema and says whether it writes',
  TOOLS.every(t => t.input_schema?.type === 'object' && typeof t.write === 'boolean' && t.description.length > 40))
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
let synced = true
try { execFileSync('node', [join(root, 'scripts/sync-mcp-lib.mjs'), '--check'], { stdio: 'pipe' }) } catch { synced = false }
check('edge function copies of the shared modules are up to date', synced)

process.exit(check.report() ? 0 : 1)
