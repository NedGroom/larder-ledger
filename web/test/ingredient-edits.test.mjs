// Editing and retiring an ingredient: rename, drop a single price, archive and
// restore, and fold a duplicate into the one you're keeping.
//
// Merge is the one worth being careful about — it moves history rather than
// deleting it, and getting it wrong loses data silently. These checks read the
// fake database afterwards to prove where every row ended up.
import { chromium } from 'playwright'
import { makeDb, signIn, installRoutes, checker, watchErrors, BASE, CHROME } from './fake-supabase.mjs'

const db = makeDb({
  ingredients: [
    { id: 1, house_id: 1, name: 'Tomatos',  name_normalized: 'tomatos',  has_any: false, keep: true,
      card_weight: null, canonical_rate_unit: null, archived: false },
    { id: 2, house_id: 1, name: 'Tomatoes', name_normalized: 'tomatoes', has_any: true,  keep: true,
      card_weight: 80, canonical_rate_unit: '100g', archived: false },
    { id: 3, house_id: 1, name: 'Basil',    name_normalized: 'basil',    has_any: true,  keep: true, archived: false },
  ],
  stores: [{ id: 1, house_id: 1, name: 'Tesco' }],
  meals: [{ id: 10, house_id: 1, name: 'Ragu', parent_id: null, servings: 4 }],
  ingredient_prices: [
    { id: 1, ingredient_id: 1, store_id: 1, price: 1.20, label: 'tin, 400g', unit_size_unit: '400g',
      canonical_rate: 0.30, canonical_rate_unit: '100g', noted_at: '2026-08-10T00:00:00Z' },
    { id: 2, ingredient_id: 2, store_id: 1, price: 0.90, label: 'loose', unit_size_unit: '250g',
      canonical_rate: 0.36, canonical_rate_unit: '100g', noted_at: '2026-08-12T00:00:00Z' },
    { id: 3, ingredient_id: 3, store_id: 1, price: 0.80, label: 'pot', unit_size_unit: null,
      canonical_rate: null, canonical_rate_unit: null, noted_at: '2026-08-01T00:00:00Z' },
  ],
  // Both spellings appear in the same dish — the quantities must survive.
  meal_ingredients: [
    { id: 1, meal_id: 10, ingredient_id: 1, required_quantity: 200, required_unit: 'g', qty_normalised: 200 },
    { id: 2, meal_id: 10, ingredient_id: 2, required_quantity: 100, required_unit: 'g', qty_normalised: 100 },
  ],
  shopping_lists: [{ id: 50, house_id: 1, status: 'done', created_at: '2026-08-05T00:00:00Z' }],
  shopping_list_items: [
    { id: 1, house_id: 1, list_id: 50, ingredient_id: 1, quantity: 1, bought: true, price_paid: 1.20 },
  ],
})

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage()
const errors = watchErrors(page)
const check = checker()

// The panel asks before anything destructive; say yes to all of it.
page.on('dialog', d => d.accept())

await signIn(page)
await installRoutes(page, db)
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)

const openPanel = async name => {
  await page.locator('.ing-card', { hasText: new RegExp(`^${name}`) }).first().click()
  await page.waitForTimeout(600)
}

// ── Rename ───────────────────────────────────────────────────────────────────
await openPanel('Basil')
await page.locator('.ing-panel-name').fill('Fresh basil')
await page.keyboard.press('Enter')
await page.waitForTimeout(600)
const basil = db.ingredients.find(i => i.id === 3)
check('renaming writes the new name', basil.name === 'Fresh basil', JSON.stringify(basil))
check('the normalised name is kept in step', basil.name_normalized === 'fresh basil', basil.name_normalized)

// ── Deleting one price ───────────────────────────────────────────────────────
await page.locator('.price-row-del').first().click()
await page.waitForTimeout(600)
check('a single price can be dropped',
      !db.ingredient_prices.some(p => p.id === 3), JSON.stringify(db.ingredient_prices.map(p => p.id)))
check('the ingredient itself is untouched', db.ingredients.some(i => i.id === 3))
await page.locator('.ing-panel-header .btn').last().click()
await page.waitForTimeout(400)

// ── Archive, and the larder stops offering it ────────────────────────────────
await openPanel('Fresh basil')
await page.click('button:has-text("Archive, merge or delete")')
await page.waitForTimeout(500)
await page.locator('.ing-danger-row', { hasText: 'Archive' }).locator('button').click()
await page.waitForTimeout(700)
check('archiving sets the flag, not a delete',
      db.ingredients.find(i => i.id === 3)?.archived === true &&
      db.ingredients.length === 3, JSON.stringify(db.ingredients.map(i => [i.name, i.archived])))
check('its prices and history are left alone', db.ingredient_prices.length === 2)
await page.locator('.ing-panel-header .btn').last().click()
await page.waitForTimeout(500)
check('it leaves the larder', await page.locator('.ing-card', { hasText: 'Fresh basil' }).count() === 0)
check('it is offered back from the archived shelf',
      (await page.textContent('.archived-shelf')).includes('1 archived'))

// ── Restore ──────────────────────────────────────────────────────────────────
await page.click('.archived-shelf button:has-text("Show")')
await page.waitForTimeout(300)
await page.click('.archived-row button:has-text("Restore")')
await page.waitForTimeout(700)
check('restoring puts it back', db.ingredients.find(i => i.id === 3)?.archived === false)
check('and back in the larder', await page.locator('.ing-card', { hasText: 'Fresh basil' }).count() === 1)

// ── Typing an archived name back in revives it ───────────────────────────────
await openPanel('Fresh basil')
await page.click('button:has-text("Archive, merge or delete")')
await page.waitForTimeout(400)
await page.locator('.ing-danger-row', { hasText: 'Archive' }).locator('button').click()
await page.waitForTimeout(700)
await page.locator('.ing-panel-header .btn').last().click()
await page.waitForTimeout(500)

await page.fill('.larder-search', 'fresh basil')
await page.waitForTimeout(500)
await page.click('.larder-create')
await page.waitForTimeout(900)
check('typing an archived name back in revives it rather than colliding',
      db.ingredients.filter(i => i.name_normalized === 'fresh basil').length === 1 &&
      db.ingredients.find(i => i.id === 3)?.archived === false,
      JSON.stringify(db.ingredients.map(i => [i.name, i.archived])))
check('and it is back on the shelf it belongs on',
      await page.locator('.ing-card', { hasText: 'Fresh basil' }).count() === 1 &&
      await page.locator('.archived-shelf').count() === 0)
await page.fill('.larder-search', '')
await page.waitForTimeout(400)

// ── Merge the misspelling into the keeper ────────────────────────────────────
await openPanel('Tomatos')
await page.click('button:has-text("Archive, merge or delete")')
await page.waitForTimeout(500)
await page.locator('.ing-danger-row select').selectOption({ label: 'Tomatoes' })
await page.locator('.ing-danger-row', { hasText: 'Merge into another' }).locator('button').click()
await page.waitForTimeout(1200)

check('the duplicate is gone', !db.ingredients.some(i => i.id === 1),
      JSON.stringify(db.ingredients.map(i => i.name)))
check('the keeper survives', db.ingredients.some(i => i.id === 2))
check('its prices moved rather than died',
      db.ingredient_prices.filter(p => p.ingredient_id === 2).length === 2,
      JSON.stringify(db.ingredient_prices.map(p => [p.id, p.ingredient_id])))
check('past purchases moved too',
      db.shopping_list_items.every(i => i.ingredient_id === 2),
      JSON.stringify(db.shopping_list_items.map(i => i.ingredient_id)))

const ragu = db.meal_ingredients.filter(l => l.ingredient_id === 2)
check('the dish ends up with one line for the ingredient', ragu.length === 1,
      JSON.stringify(db.meal_ingredients))
check('and the two quantities were added, not one thrown away',
      ragu[0]?.qty_normalised === 300 && Number(ragu[0]?.required_quantity) === 300,
      JSON.stringify(ragu[0]))

// ── Delete outright ──────────────────────────────────────────────────────────
await page.waitForTimeout(400)
await openPanel('Tomatoes')
await page.click('button:has-text("Archive, merge or delete")')
await page.waitForTimeout(600)
const warning = await page.textContent('.ing-danger')
check('the delete option says what it would take with it',
      /2 price\(s\)/.test(warning) && /1 recipe line\(s\)/.test(warning), warning)

await page.locator('.ing-danger-row', { hasText: 'Delete' }).locator('button').click()
await page.waitForTimeout(900)
check('deleting removes the ingredient', !db.ingredients.some(i => i.id === 2),
      JSON.stringify(db.ingredients.map(i => i.name)))

await browser.close()
process.exit(check.report(errors) ? 0 : 1)
