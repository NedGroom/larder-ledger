// Browsing the larder, building a list from it, and shopping that list.
import { chromium } from 'playwright'
import { makeDb, signIn, installRoutes, checker, watchErrors, BASE, CHROME } from './fake-supabase.mjs'

const db = makeDb({
  categories: [
    { id: 10, house_id: 1, name: 'Produce', name_normalized: 'produce' },
    { id: 11, house_id: 1, name: 'Store cupboard', name_normalized: 'store cupboard' },
  ],
  ingredients: [
    { id: 1, house_id: 1, name: 'Tomatoes',   name_normalized: 'tomatoes',   has_any: false, keep: true,  canonical_rate_unit: 'g' },
    { id: 2, house_id: 1, name: 'Pasta',      name_normalized: 'pasta',      has_any: true,  keep: true,  canonical_rate_unit: 'g' },
    { id: 3, house_id: 1, name: 'Olive oil',  name_normalized: 'olive oil',  has_any: true,  keep: true,  canonical_rate_unit: 'ml' },
    { id: 4, house_id: 1, name: 'Party hats', name_normalized: 'party hats', has_any: false, keep: false, canonical_rate_unit: null },
  ],
  // Tomatoes is deliberately in two categories: it must appear under both.
  ingredient_categories: [
    { ingredient_id: 1, category_id: 10 },
    { ingredient_id: 1, category_id: 11 },
    { ingredient_id: 2, category_id: 11 },
  ],
  ingredient_prices: [
    { id: 100, ingredient_id: 1, store_id: 1, price: 1.5, noted_at: '2026-08-01T00:00:00Z' },
    { id: 101, ingredient_id: 2, store_id: 1, price: 0.9, noted_at: '2026-08-01T00:00:00Z' },
  ],
  stores: [{ id: 1, house_id: 1, name: 'Tesco' }],
})

// Shop rows and larder cards share the .card look on purpose; this picks the row.
const SHOP_ROW = '.card:not(.ing-card)'

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage()
const errors = watchErrors(page)
const check = checker()

await signIn(page)
await installRoutes(page, db)
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)

// ── Larder ───────────────────────────────────────────────────────────────────
check('app renders past auth', (await page.textContent('body')).includes('Larder'))
check('category sections render', await page.locator('.larder-section').count() >= 2)
check('an ingredient in two categories shows under both',
      await page.locator('.ing-card', { hasText: 'Tomatoes' }).count() === 2)
check('in-stock cards are dimmed', await page.locator('.ing-card--stocked').count() > 0)
check('missing cards stay prominent', await page.locator('.ing-card--wanted').count() > 0)

await page.fill('.larder-search', 'past')
await page.waitForTimeout(250)
check('search filters the list',
      await page.locator('.ing-card', { hasText: 'Pasta' }).count() > 0 &&
      await page.locator('.ing-card', { hasText: 'Tomatoes' }).count() === 0)

await page.fill('.larder-search', 'Marmite')
await page.waitForTimeout(250)
check('an unknown name offers to create it', await page.locator('.larder-create').count() === 1)
await page.click('.larder-create')
await page.waitForTimeout(400)
check('the created ingredient joins the larder', (await page.textContent('body')).includes('Marmite'))

// ── Build ────────────────────────────────────────────────────────────────────
await page.click('text=🛒 Shopping')
await page.waitForTimeout(900)
check('build uses the very same browser', await page.locator('.larder-browser').count() === 1)
check('build defaults to kept-only', (await page.textContent('body')).includes('Kept only'))
check('quantities start at zero',
      await page.locator('.qty-add').count() > 0 && await page.locator('.qty-step').count() === 0)
check('an empty list cannot start a shop',
      await page.locator('button:has-text("Start shop")').isDisabled())

await page.locator('select').first().selectOption({ label: 'Tesco' })
await page.waitForTimeout(300)
await page.locator('.ing-card', { hasText: 'Tomatoes' }).first().locator('.qty-add').click()
await page.waitForTimeout(300)
check('a quantity above zero puts it on the list', await page.locator('.ing-card--picked').count() >= 1)
check('the shop can now be started', !(await page.locator('button:has-text("Start shop")').isDisabled()))
check('an estimate is shown', (await page.textContent('body')).includes('Estimated at'))

await page.locator('button:has-text("Start shop")').click()
await page.waitForTimeout(1400)
check('the shop stage is reached', (await page.textContent('body')).includes('Shopping at Tesco'))

// ── Shop ─────────────────────────────────────────────────────────────────────
const row = page.locator(SHOP_ROW, { hasText: 'Tomatoes' }).first()
await row.locator('input[type=number]').first().fill('1.20')
await row.locator('input[type=number]').nth(1).fill('2')
await row.locator('input[placeholder="500g"]').fill('400g')
await row.locator('button:has-text("Bought")').click()
await page.waitForTimeout(700)

check('buying logs a price', db.ingredient_prices.some(p => p.ingredient_id === 1 && Number(p.price) === 1.2))
check('buying works out a canonical rate from the pack size',
      db.ingredient_prices.some(p => p.ingredient_id === 1 && p.canonical_rate != null))
const bought = db.shopping_list_items.find(i => i.ingredient_id === 1)
check('the planned line is filled in, not duplicated',
      db.shopping_list_items.filter(i => i.ingredient_id === 1).length === 1 && bought.bought === true)
check('the line links the price it logged', bought.price_id != null)
check('a bought item returns to stock', db.ingredients.find(i => i.id === 1).has_any === true)
check('the running spend is shown', (await page.textContent('body')).includes('Spent so far: £2.40'))

const before = db.ingredient_prices.length
await page.locator(SHOP_ROW, { hasText: 'Tomatoes' }).first().locator('button:has-text("Undo")').click()
await page.waitForTimeout(700)
check('undo retracts the price it logged', db.ingredient_prices.length === before - 1)
check('undo returns the line to unbought',
      db.shopping_list_items.find(i => i.ingredient_id === 1).bought === false)

await page.click('button:has-text("Add more items")')
await page.waitForTimeout(500)
await page.locator('.receipt-inline .ing-card', { hasText: 'Pasta' }).first().locator('.qty-add').click()
await page.waitForTimeout(700)
check('adding mid-shop writes a real line', db.shopping_list_items.some(i => i.ingredient_id === 2 && !i.bought))
check('every line references an ingredient — no loose names',
      db.shopping_list_items.every(i => i.ingredient_id != null))

// ── History ──────────────────────────────────────────────────────────────────
await page.locator(SHOP_ROW, { hasText: 'Tomatoes' }).first().locator('input[type=number]').first().fill('1.10')
await page.locator(SHOP_ROW, { hasText: 'Tomatoes' }).first().locator('button:has-text("Bought")').click()
await page.waitForTimeout(600)
await page.click('button:has-text("Finish shop")')
await page.waitForTimeout(1200)

check('history lists the finished shop', (await page.textContent('body')).includes('Past shops'))
check('the list is marked done with a total',
      db.shopping_lists.some(l => l.status === 'done' && l.total_paid > 0))
check('the shop carries its date', db.shopping_lists.every(l => l.purchased_on))

await page.locator(SHOP_ROW, { hasText: 'Tesco' }).first().click()
await page.waitForTimeout(600)
check('history rows expand', await page.locator('.hist-detail').count() === 1)
check('the expansion names the items', (await page.textContent('.hist-detail')).includes('Tomatoes'))

await browser.close()
process.exit(check.report(errors) ? 0 : 1)
