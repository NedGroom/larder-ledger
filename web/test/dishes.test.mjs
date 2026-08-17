// Authoring a dish with computable quantities, and the "plan this on Thursday"
// shortcut that turns one into a cook, a component and an allocation.
import { chromium } from 'playwright'
import { makeDb, signIn, installRoutes, checker, watchErrors, BASE, CHROME } from './fake-supabase.mjs'

const db = makeDb({
  categories: [{ id: 10, house_id: 1, name: 'Indian', name_normalized: 'indian' }],
  ingredients: [
    { id: 1, house_id: 1, name: 'Spinach', name_normalized: 'spinach', has_any: false, keep: true, card_weight: 80 },
    { id: 2, house_id: 1, name: 'Lentils', name_normalized: 'lentils', has_any: true,  keep: true, card_weight: 100 },
  ],
  periods: [{ id: 50, house_id: 1, name: 'Test fortnight', starts_on: '2026-08-10', ends_on: '2026-08-30' }],
})

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage()
const errors = watchErrors(page)
const check = checker()

await signIn(page)
await installRoutes(page, db)
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)

await page.click('text=🍲 Dishes')
await page.waitForTimeout(800)

// ── Authoring ────────────────────────────────────────────────────────────────
await page.click('button:has-text("New dish")')
await page.waitForTimeout(500)
check('the recipe form explains the g/ml column',
      (await page.textContent('.modal')).includes('for the whole dish'))

await page.locator('.modal input').first().fill('Dahl')
// servings = the yield
const servingsInput = page.locator('.modal label:has-text("Servings") input')
await servingsInput.fill('6')

// Tick both ingredients and give quantities.
const spinachRow = page.locator('.ing-picker-row', { hasText: 'Spinach' })
await spinachRow.locator('input[type=checkbox]').check()
await page.waitForTimeout(200)
await spinachRow.locator('input[placeholder="qty"]').fill('2')
await page.waitForTimeout(200)
check('an unconvertible unit leaves the g/ml box for the user',
      (await spinachRow.locator('.ing-norm').inputValue()) === '',
      await spinachRow.locator('.ing-norm').inputValue())
await spinachRow.locator('.ing-norm').fill('480')

const lentilRow = page.locator('.ing-picker-row', { hasText: 'Lentils' })
await lentilRow.locator('input[type=checkbox]').check()
await page.waitForTimeout(200)
await lentilRow.locator('input[placeholder="qty"]').fill('600')

// Tag it.
await page.locator('.modal .cat-chip-label', { hasText: 'Indian' }).click()

await page.locator('.modal button:has-text("Save")').first().click()
await page.waitForTimeout(1200)

check('the dish was saved with its yield',
      db.meals.length === 1 && Number(db.meals[0].servings) === 6, JSON.stringify(db.meals))
const spinachLine = db.meal_ingredients.find(m => m.ingredient_id === 1)
check('a hand-typed g/ml figure is stored', Number(spinachLine?.qty_normalised) === 480,
      JSON.stringify(db.meal_ingredients))
check('the human phrasing survives alongside it', Number(spinachLine?.required_quantity) === 2)
check('the dish was categorised', db.meal_categories.length === 1 && db.meal_categories[0].category_id === 10)

// ── The plan-a-dish shortcut ─────────────────────────────────────────────────
await page.waitForTimeout(400)
await page.locator('.card', { hasText: 'Dahl' }).first().click()
await page.waitForTimeout(600)
await page.locator('.modal button:has-text("Plan")').first().click()
await page.waitForTimeout(700)

check('planning asks for a date, slot and servings',
      (await page.textContent('.modal')).includes('Slot'))

await page.locator('.modal input[type=date]').fill('2026-08-20')
await page.waitForTimeout(300)
check('it explains what happens to the rest of the batch',
      /One serving goes on 2026-08-20/.test(await page.textContent('.modal')),
      (await page.textContent('.modal')).slice(0, 200))

await page.locator('.modal button:has-text("Plan it")').click()
await page.waitForTimeout(1500)

check('a cook session was created on that date',
      db.cooks.length === 1 && db.cooks[0].cook_date === '2026-08-20', JSON.stringify(db.cooks))
check('it was filed under the period covering that date', db.cooks[0].period_id === 50)
check('a component holds the whole batch',
      db.cook_components.length === 1 && Number(db.cook_components[0].servings_planned) === 6)
check('its quantities were snapshotted',
      db.cook_component_ingredients.length === 2 &&
      Number(db.cook_component_ingredients.find(l => l.ingredient_id === 1).qty_total) === 480)
check('exactly one serving was placed',
      db.allocations.length === 1 && Number(db.allocations[0].servings) === 1, JSON.stringify(db.allocations))
check('placed on the chosen day and slot',
      db.allocations[0].on_date === '2026-08-20' && db.allocations[0].slot === 'dinner')
check('the missing ingredient went on a shopping list, the stocked one did not',
      db.shopping_list_items.length === 1 && db.shopping_list_items[0].ingredient_id === 1,
      JSON.stringify(db.shopping_list_items.map(i => i.ingredient_id)))
check('that shop is tied to the period', db.shopping_lists[0]?.period_id === 50)

// ── And it shows up in the planner ───────────────────────────────────────────
await page.click('text=📅 Plan')
await page.waitForTimeout(1200)
check('the planned serving appears on the calendar',
      (await page.textContent('body')).includes('Dahl'))

await browser.close()
process.exit(check.report(errors) ? 0 : 1)
