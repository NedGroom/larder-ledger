/**
 * A local larder-mcp with a demo house in memory — the real tools and protocol, a fake
 * database. For trying the assistant end to end without touching the live project
 * (Anki Life's `dev.py session start NAME --larder-dev` runs this in a container).
 *
 *   LARDER_MCP_TOKEN=dev deno run --allow-env --allow-net --allow-read supabase/functions/larder-mcp/dev.ts
 *   → http://localhost:8000  (POST JSON-RPC; GET /__db dumps the demo database)
 */
import { makeDb } from '../../../web/test/fake-supabase.mjs'
import { installFakeSupabase } from './fake.ts'

const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
const ago = (n: number) => new Date(Date.now() - n * 86400000).toISOString()

let id = 100
const ing = (name: string, extra: Record<string, unknown> = {}) =>
  ({ id: ++id, house_id: 1, name, name_normalized: name.toLowerCase(), has_any: true, keep: true, ...extra })

const items = {
  tomatoes: ing('Chopped tomatoes', { stock_qty: 1200, stock_unit: 'g', kcal_per_100: 21, protein_per_100: 1.1, carbs_per_100: 3.5, fat_per_100: 0.2, fibre_per_100: 0.9 }),
  chickpeas: ing('Chickpeas', { has_any: false, kcal_per_100: 120, protein_per_100: 7, carbs_per_100: 17, fat_per_100: 2, fibre_per_100: 5 }),
  spinach: ing('Spinach', { card_weight: 80, kcal_per_100: 23, protein_per_100: 2.9, carbs_per_100: 1.4, fat_per_100: 0.4, fibre_per_100: 2.2 }),
  broccoli: ing('Broccoli', { card_weight: 80, kcal_per_100: 34, protein_per_100: 2.8, carbs_per_100: 4, fat_per_100: 0.4, fibre_per_100: 2.6 }),
  peppers: ing('Peppers', { card_weight: 80, has_any: false }),
  onions: ing('Onions', { stock_qty: 3, stock_unit: 'unit' }),
  rice: ing('Basmati rice', { stock_qty: 900, stock_unit: 'g', kcal_per_100: 350, protein_per_100: 8, carbs_per_100: 78, fat_per_100: 1, fibre_per_100: 1 }),
  eggs: ing('Eggs', { stock_qty: 4, stock_unit: 'unit' }),
  milk: ing('Oat milk', { has_any: false }),
  feta: ing('Feta', {}),
  pasta: ing('Penne', { stock_qty: 500, stock_unit: 'g' }),
  lentils: ing('Red lentils', { stock_qty: 750, stock_unit: 'g' }),
}
const I = items

const db = makeDb({
  users: [
    { id: 1, auth_uid: 'uid-ned', name: 'Ned', target_kcal: 2400, target_protein_g: 120, target_fibre_g: 30 },
    { id: 2, auth_uid: 'uid-bot', name: 'Assistant', is_assistant: true },
  ],
  house_users: [{ house_id: 1, user_id: 1 }, { house_id: 1, user_id: 2 }],
  categories: [
    { id: 1, house_id: 1, name: 'Veg', name_normalized: 'veg' },
    { id: 2, house_id: 1, name: 'Tins & dry', name_normalized: 'tins & dry' },
    { id: 3, house_id: 1, name: 'Dairy & eggs', name_normalized: 'dairy & eggs' },
  ],
  ingredients: Object.values(items),
  ingredient_categories: [
    ...[I.spinach, I.broccoli, I.peppers, I.onions].map(i => ({ ingredient_id: i.id, category_id: 1 })),
    ...[I.tomatoes, I.chickpeas, I.rice, I.pasta, I.lentils].map(i => ({ ingredient_id: i.id, category_id: 2 })),
    ...[I.eggs, I.milk, I.feta].map(i => ({ ingredient_id: i.id, category_id: 3 })),
  ],
  stores: [{ id: 1, name: 'Tesco' }, { id: 2, name: 'Lidl' }],
  meals: [
    { id: 201, house_id: 1, name: 'Chickpea and spinach curry', servings: 4 },
    { id: 202, house_id: 1, name: 'Shakshuka', servings: 2 },
    { id: 203, house_id: 1, name: 'Red lentil dal', servings: 4 },
    { id: 204, house_id: 1, name: 'Broccoli and feta pasta', servings: 2 },
  ],
  meal_ingredients: [
    ...[I.chickpeas, I.spinach, I.tomatoes, I.onions, I.rice].map((i, n) => ({ id: 300 + n, meal_id: 201, ingredient_id: i.id })),
    ...[I.eggs, I.tomatoes, I.peppers, I.onions, I.feta].map((i, n) => ({ id: 310 + n, meal_id: 202, ingredient_id: i.id })),
    ...[I.lentils, I.tomatoes, I.onions, I.spinach, I.rice].map((i, n) => ({ id: 320 + n, meal_id: 203, ingredient_id: i.id })),
    ...[I.pasta, I.broccoli, I.feta].map((i, n) => ({ id: 330 + n, meal_id: 204, ingredient_id: i.id })),
  ],
  shopping_lists: [{ id: 400, house_id: 1, status: 'done', source: 'receipt', purchased_on: day(-100) }],
  shopping_list_items: [
    { id: 401, house_id: 1, list_id: 400, ingredient_id: I.feta.id, quantity: 1, bought: true, bought_at: ago(100) },
    { id: 402, house_id: 1, list_id: 400, ingredient_id: I.lentils.id, quantity: 1, bought: true, bought_at: ago(130) },
  ],
  periods: [{ id: 500, house_id: 1, name: 'This fortnight', starts_on: day(-4), ends_on: day(9) }],
  ingredient_targets: [
    { id: 501, period_id: 500, ingredient_id: I.spinach.id, target_cards: 6 },
    { id: 502, period_id: 500, ingredient_id: I.broccoli.id, target_cards: 4 },
    { id: 503, period_id: 500, ingredient_id: I.peppers.id, target_cards: 3 },
  ],
  cooks: [{ id: 600, house_id: 1, period_id: 500, cook_date: day(-1) }],
  cook_components: [{ id: 601, house_id: 1, cook_id: 600, meal_id: 203, name: 'Red lentil dal', servings_planned: 4 }],
  cook_component_ingredients: [
    { id: 602, component_id: 601, ingredient_id: I.spinach.id, qty_total: 320 },
    { id: 603, component_id: 601, ingredient_id: I.lentils.id, qty_total: 250 },
    { id: 604, component_id: 601, ingredient_id: I.tomatoes.id, qty_total: 400 },
    { id: 605, component_id: 601, ingredient_id: I.rice.id, qty_total: 300 },
  ],
  allocations: [
    { id: 700, house_id: 1, component_id: 601, period_id: 500, on_date: day(-1), slot: 'dinner', servings: 1, for_user_id: 1 },
    { id: 701, house_id: 1, component_id: 601, period_id: 500, on_date: day(0), slot: 'lunch', servings: 1, for_user_id: 1 },
  ],
  food_log: [],
})

installFakeSupabase(db)
Deno.env.set('ASSISTANT_DEFAULT_PERSON', Deno.env.get('ASSISTANT_DEFAULT_PERSON') ?? 'Ned')
if (!Deno.env.get('LARDER_MCP_TOKEN')) Deno.env.set('LARDER_MCP_TOKEN', 'dev')
const { handle } = await import('./index.ts')

Deno.serve({ port: Number(Deno.env.get('PORT') ?? 8000) }, req =>
  new URL(req.url).pathname === '/__db' ? Response.json(db) : handle(req))
