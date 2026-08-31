// Browsing the larder: seeing and correcting what's on the shelf, and the ways
// of looking at it — grouping, sorting, filtering, searching.
import { chromium } from 'playwright'
import { makeDb, signIn, installRoutes, checker, watchErrors, BASE, CHROME } from './fake-supabase.mjs'

const iso = daysAgo => new Date(Date.now() - daysAgo * 864e5).toISOString()

const db = makeDb({
  categories: [
    { id: 10, house_id: 1, name: 'Produce', name_normalized: 'produce' },
    { id: 11, house_id: 1, name: 'Cupboard', name_normalized: 'cupboard' },
  ],
  ingredients: [
    // in stock, counted, bought recently, fully set up
    { id: 1, house_id: 1, name: 'Tomatoes', name_normalized: 'tomatoes', has_any: true, keep: true,
      stock_qty: 800, stock_unit: 'g', card_weight: 80, kcal_per_100: 18, archived: false },
    // in stock but nobody has said how much
    { id: 2, house_id: 1, name: 'Pasta', name_normalized: 'pasta', has_any: true, keep: true,
      stock_qty: null, stock_unit: null, card_weight: 75, kcal_per_100: 350, archived: false },
    // out of it
    { id: 3, house_id: 1, name: 'Basil', name_normalized: 'basil', has_any: false, keep: true,
      card_weight: 5, kcal_per_100: 23, archived: false },
    // in stock, but last bought long ago, and nothing set up for the planner
    { id: 4, house_id: 1, name: 'Saffron', name_normalized: 'saffron', has_any: true, keep: false,
      stock_qty: 2, stock_unit: 'g', card_weight: null, kcal_per_100: null, archived: false },
    // stays uncounted throughout, so the "uncounted" view has something to find
    { id: 5, house_id: 1, name: 'Rice', name_normalized: 'rice', has_any: true, keep: true,
      stock_qty: null, stock_unit: null, card_weight: 75, kcal_per_100: 130, archived: false },
  ],
  ingredient_categories: [
    { ingredient_id: 1, category_id: 10 },
    { ingredient_id: 3, category_id: 10 },
    { ingredient_id: 2, category_id: 11 },
    { ingredient_id: 5, category_id: 11 },
    // Saffron is deliberately unfiled
  ],
  shopping_lists: [{ id: 50, house_id: 1, status: 'done' }],
  shopping_list_items: [
    { id: 1, house_id: 1, list_id: 50, ingredient_id: 1, quantity: 2, bought: true, bought_at: iso(4) },
    { id: 2, house_id: 1, list_id: 50, ingredient_id: 2, quantity: 1, bought: true, bought_at: iso(20) },
    { id: 3, house_id: 1, list_id: 50, ingredient_id: 4, quantity: 1, bought: true, bought_at: iso(300) },
    { id: 4, house_id: 1, list_id: 50, ingredient_id: 5, quantity: 1, bought: true, bought_at: iso(10) },
  ],
})

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage()
const errors = watchErrors(page)
const check = checker()

await signIn(page)
await installRoutes(page, db)
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)

const cards = () => page.locator('.ing-card')
const names = async () => (await cards().locator('.name').allTextContents()).map(s => s.trim())

// ── What's on the shelf is visible without opening anything ──────────────────
const tomatoes = page.locator('.ing-card', { hasText: 'Tomatoes' }).first()
check('the quantity in stock is shown on the card',
      await tomatoes.locator('.stock-qty').inputValue() === '800',
      await tomatoes.locator('.stock-qty').inputValue())
check('with its unit', await tomatoes.locator('.stock-unit').inputValue() === 'g')
check('an uncounted item shows an empty box, not a zero',
      await page.locator('.ing-card', { hasText: 'Pasta' }).first().locator('.stock-qty').inputValue() === '')

// ── And can be corrected in place ────────────────────────────────────────────
await tomatoes.locator('.stock-qty').fill('450')
await page.waitForTimeout(1100)          // debounced save
check('editing the quantity writes it straight through',
      Number(db.ingredients.find(i => i.id === 1).stock_qty) === 450,
      String(db.ingredients.find(i => i.id === 1).stock_qty))

await page.locator('.ing-card', { hasText: 'Pasta' }).first().locator('.stock-qty').fill('500')
await page.locator('.ing-card', { hasText: 'Pasta' }).first().locator('.stock-unit').fill('g')
await page.waitForTimeout(1100)
const pasta = db.ingredients.find(i => i.id === 2)
check('counting something also records its unit', Number(pasta.stock_qty) === 500 && pasta.stock_unit === 'g')

// Typing zero is a statement, not a blank.
await tomatoes.locator('.stock-qty').fill('0')
await page.waitForTimeout(1100)
check('typing zero marks it out of stock', db.ingredients.find(i => i.id === 1).has_any === false)
await tomatoes.locator('.stock-qty').fill('800')
await page.waitForTimeout(1100)
check('and putting a quantity back marks it in stock again',
      db.ingredients.find(i => i.id === 1).has_any === true)

// ── Ways to look at it ───────────────────────────────────────────────────────
check('it groups by category out of the box',
      (await page.locator('.larder-section-name').allTextContents()).some(t => t.includes('Produce')))

await page.selectOption('.larder-toolbar select >> nth=0', 'status')
await page.waitForTimeout(400)
const statusGroups = await page.locator('.larder-section-name').allTextContents()
check('it can group by whether you have any',
      statusGroups.some(t => t.includes('Missing')) && statusGroups.some(t => t.includes('In stock')),
      JSON.stringify(statusGroups))

await page.selectOption('.larder-toolbar select >> nth=0', 'none')
await page.waitForTimeout(400)
check('or show one flat list', await page.locator('.larder-section').count() === 1)

// Missing-first holds whatever the sort, because that's what you act on.
check('what you are out of comes first', (await names())[0] === 'Basil', JSON.stringify(await names()))

await page.selectOption('.larder-toolbar select >> nth=1', 'stale')
await page.waitForTimeout(400)
const stale = await names()
check('sorting by longest-ago puts the forgotten jar above the fresh stuff',
      stale.indexOf('Saffron') < stale.indexOf('Tomatoes'), JSON.stringify(stale))

await page.selectOption('.larder-toolbar select >> nth=1', 'stock')
await page.waitForTimeout(400)
const byStock = await names()
check('sorting by least-in-stock puts the small quantity above the large',
      byStock.indexOf('Saffron') < byStock.indexOf('Tomatoes'), JSON.stringify(byStock))

// ── Filters ──────────────────────────────────────────────────────────────────
await page.click('.chip:has-text("Missing")')
await page.waitForTimeout(400)
check('the missing filter shows only what you are out of',
      JSON.stringify(await names()) === JSON.stringify(['Basil']), JSON.stringify(await names()))

await page.click('.chip:has-text("Needs setting up")')
await page.waitForTimeout(400)
check('“needs setting up” finds the ingredient the planner can\'t use',
      (await names()).includes('Saffron'), JSON.stringify(await names()))
check('and leaves out the ones that are ready', !(await names()).includes('Tomatoes'))

await page.click('.chip:has-text("Uncounted")')
await page.waitForTimeout(400)
check('“uncounted” finds stock nobody has measured', JSON.stringify(await names()) === JSON.stringify(['Rice']),
      JSON.stringify(await names()))

await page.click('.chip:has-text("Everything")')
await page.waitForTimeout(400)
check('and everything comes back', (await names()).length === 5)

// ── Search still works alongside the rest ────────────────────────────────────
await page.fill('.larder-search', 'saff')
await page.waitForTimeout(400)
check('search narrows to a match', JSON.stringify(await names()) === JSON.stringify(['Saffron']))
await page.fill('.larder-search', '')
await page.waitForTimeout(400)

// ── The summary line ─────────────────────────────────────────────────────────
const summary = await page.textContent('.larder-summary')
check('the summary counts what is missing', /1\s*missing/.test(summary), summary)
check('and flags long-forgotten stock', /not bought in 3\+ months/.test(summary), summary)
check('a stale item is badged on its own card',
      await page.locator('.ing-card', { hasText: 'Saffron' }).first().locator('.pill.amber').count() === 1)

await browser.close()
process.exit(check.report(errors) ? 0 : 1)
