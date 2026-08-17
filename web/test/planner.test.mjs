// The planner end to end: the deck, adding to a cook, placing servings on days,
// and the arithmetic those actions are supposed to produce in the database.
import { chromium } from 'playwright'
import { makeDb, signIn, installRoutes, checker, watchErrors, BASE, CHROME } from './fake-supabase.mjs'

const db = makeDb({
  users: [{ id: 1, auth_uid: 'uid-1', email: 'ned@example.com', name: 'Ned', target_protein_g: 100 }],
  categories: [{ id: 10, house_id: 1, name: 'Greens', name_normalized: 'greens' }],
  ingredients: [
    { id: 1, house_id: 1, name: 'Spinach', name_normalized: 'spinach', has_any: false, keep: true, card_weight: 80, protein_per_100: 2.9 },
    { id: 2, house_id: 1, name: 'Lentils', name_normalized: 'lentils', has_any: false, keep: true, card_weight: 100, protein_per_100: 9 },
    { id: 3, house_id: 1, name: 'Salt',    name_normalized: 'salt',    has_any: true,  keep: true, card_weight: null },
  ],
  ingredient_categories: [{ ingredient_id: 1, category_id: 10 }],
  // Dahl: yields 6, uses 480g spinach (6 cards) and 600g lentils (6 cards)
  meals: [{ id: 100, house_id: 1, name: 'Dahl', parent_id: null, servings: 6, dish_type: 'meal' }],
  meal_ingredients: [
    { id: 1, meal_id: 100, ingredient_id: 1, required_quantity: 2, required_unit: 'handfuls', qty_normalised: 480 },
    { id: 2, meal_id: 100, ingredient_id: 2, required_quantity: 600, required_unit: 'g', qty_normalised: 600 },
  ],
  periods: [{ id: 50, house_id: 1, name: 'Test fortnight', starts_on: '2026-08-17', ends_on: '2026-08-30' }],
  ingredient_targets: [
    { id: 1, period_id: 50, ingredient_id: 1, target_cards: 6 },
    { id: 2, period_id: 50, ingredient_id: 2, target_cards: 6 },
  ],
})

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage()
const errors = watchErrors(page)
const check = checker()

await signIn(page)
await installRoutes(page, db)
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)

await page.click('text=📅 Plan')
await page.waitForTimeout(1200)

// ── The deck ─────────────────────────────────────────────────────────────────
check('the planner opens on the unfinished period',
      (await page.locator('.plan-bar-period select').inputValue()) === '50')
check('planning panels are shown', await page.locator('.plan-panel').count() >= 3)
check('the deck shows a stack per target', await page.locator('.deck-stack').count() === 2,
      String(await page.locator('.deck-stack').count()))
check('an ingredient with no card weight stays out of the deck',
      !(await page.textContent('.plan-panel')).includes('Salt'))
check('stacks start at their full target',
      (await page.locator('.deck-stack', { hasText: 'Spinach' }).first().textContent()).includes('6'))
check('the deck groups by category', (await page.textContent('body')).includes('Greens'))

// ── Adding a dish to a cook ──────────────────────────────────────────────────
await page.locator('.dish-chip', { hasText: 'Dahl' }).click()
await page.waitForTimeout(400)
check('the dish prompt asks only for servings',
      (await page.textContent('.modal')).includes('Servings to make'))

await page.locator('.modal input[type=number]').first().fill('3')
await page.waitForTimeout(200)
check('scaling against the recipe yield is explained',
      (await page.textContent('.modal')).includes('recipe makes 6'))

await page.locator('.modal button:has-text("Add to cook")').click()
await page.waitForTimeout(1200)

check('a cook session was created', db.cooks.length === 1 && db.cooks[0].period_id === 50)
check('a component records the planned servings',
      db.cook_components.length === 1 && Number(db.cook_components[0].servings_planned) === 3)
const lines = db.cook_component_ingredients
check('the recipe was scaled and snapshotted, not referenced',
      lines.length === 2 && Number(lines.find(l => l.ingredient_id === 1).qty_total) === 240,
      JSON.stringify(lines.map(l => [l.ingredient_id, l.qty_total])))
check('the human phrasing is kept alongside the number',
      lines.find(l => l.ingredient_id === 1).qty_text === '2 handfuls')

// Cooking alone must not spend cards — only placing does.
await page.waitForTimeout(300)
const spinachStack = page.locator('.deck-stack', { hasText: 'Spinach' }).first()
check('cooking spends no cards yet',
      (await spinachStack.locator('.deck-stack-count').textContent()) === '6')
check('but the cooked-not-placed amount is shown',
      (await spinachStack.textContent()).includes('cooked'),
      await spinachStack.textContent())

// ── Placing a serving ────────────────────────────────────────────────────────
await page.locator('.cook-comp button:has-text("Place")').click()
await page.waitForTimeout(300)
check('the held batch is announced', (await page.textContent('body')).includes('Holding Dahl'))
check('days offer themselves as targets', await page.locator('.plan-day-drop').count() > 0)

await page.locator('.plan-day-drop').first().click()
await page.waitForTimeout(400)
await page.locator('.modal button:has-text("Place it")').click()
await page.waitForTimeout(900)

check('an allocation was written', db.allocations.length === 1, JSON.stringify(db.allocations))
const alloc = db.allocations[0]
check('it owns to the period being planned', alloc.period_id === 50)
check('it lands on the first day of the period', alloc.on_date === '2026-08-17')
check('it carries a slot', ['breakfast', 'lunch', 'dinner'].includes(alloc.slot))
check('it is assigned to the logged-in user', alloc.for_user_id === 1)

await page.waitForTimeout(400)
const afterPlace = page.locator('.deck-stack', { hasText: 'Spinach' }).first()
check('placing one serving spends one card',
      (await afterPlace.locator('.deck-stack-count').textContent()) === '5',
      await afterPlace.locator('.deck-stack-count').textContent())
check('the serving shows on the calendar',
      (await page.textContent('.plan-week-grid')).includes('Dahl'))
check('the batch reports what is left', (await page.textContent('.cook-comp')).includes('2 of 3 left'))

// ── Taking it back off ───────────────────────────────────────────────────────
page.once('dialog', d => d.accept())
await page.locator('.plan-alloc').first().click()
await page.waitForTimeout(800)
check('removing the serving deletes the allocation', db.allocations.length === 0)
check('the card comes back',
      (await page.locator('.deck-stack', { hasText: 'Spinach' }).first().locator('.deck-stack-count').textContent()) === '6')

// ── Period = None ────────────────────────────────────────────────────────────
await page.locator('.plan-bar-period select').selectOption('')
await page.waitForTimeout(600)
check('choosing no period hides the planning panels', await page.locator('.deck-stack').count() === 0)
check('and leaves a plain month calendar', await page.locator('.month-grid').count() === 1)

// ── Analyse ──────────────────────────────────────────────────────────────────
await page.locator('.plan-bar-period select').selectOption('50')
await page.waitForTimeout(600)
await page.click('button:has-text("Analyse plan")')
await page.waitForTimeout(500)
const analyse = await page.textContent('.modal')
check('the analyse view opens with the nutrients', analyse.includes('Protein') && analyse.includes('Fibre'))
check('it measures against the personal target', analyse.includes('/ 100'))
await page.click('.modal-close')

// ── Handing off to the shop ──────────────────────────────────────────────────
await page.waitForTimeout(300)
await page.click('button:has-text("Done for now")')
await page.waitForTimeout(700)
const shop = await page.textContent('.modal')
check('the shop step lists what the plan needs', shop.includes('Spinach') && shop.includes('Lentils'))
check('quantities are shown in grams', /\d+g planned/.test(shop))
await page.locator('.modal button:has-text("Add to shop")').click()
await page.waitForTimeout(1000)

check('a shop was opened for the period',
      db.shopping_lists.length === 1 && db.shopping_lists[0].period_id === 50,
      JSON.stringify(db.shopping_lists))
check('the needed items were added to it',
      db.shopping_list_items.length === 2 && db.shopping_list_items.every(i => i.ingredient_id),
      JSON.stringify(db.shopping_list_items.map(i => i.ingredient_id)))

await browser.close()
process.exit(check.report(errors) ? 0 : 1)
