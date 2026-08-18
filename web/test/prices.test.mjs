// The ingredient panel's price comparison: every product you've bought, ranked
// cheapest per unit, each naming its shop and what it actually was.
import { chromium } from 'playwright'
import { makeDb, signIn, installRoutes, checker, watchErrors, BASE, CHROME } from './fake-supabase.mjs'

const db = makeDb({
  ingredients: [
    { id: 1, house_id: 1, name: 'Eggs', name_normalized: 'eggs', has_any: true, keep: true, canonical_rate_unit: 'unit' },
  ],
  stores: [{ id: 1, house_id: 1, name: 'Tesco' }, { id: 2, house_id: 1, name: 'Lidl' }],
  ingredient_prices: [
    // Deliberately out of rate order, and the dearest is the most recent.
    { id: 1, ingredient_id: 1, store_id: 1, price: 2.40, label: '6 large free range', unit_size_unit: '6pk',
      canonical_rate: 0.40, canonical_rate_unit: 'unit', noted_at: '2026-08-16T00:00:00Z' },
    { id: 2, ingredient_id: 1, store_id: 2, price: 3.00, label: '12 medium', unit_size_unit: '12pk',
      canonical_rate: 0.25, canonical_rate_unit: 'unit', noted_at: '2026-08-10T00:00:00Z' },
    { id: 3, ingredient_id: 1, store_id: 1, price: 1.80, label: null, unit_size_unit: null,
      canonical_rate: null, canonical_rate_unit: null, noted_at: '2026-08-01T00:00:00Z' },
    // An older price for the same product as #2 — must not appear twice.
    { id: 4, ingredient_id: 1, store_id: 2, price: 2.80, label: '12 medium', unit_size_unit: '12pk',
      canonical_rate: 0.233, canonical_rate_unit: 'unit', noted_at: '2026-07-01T00:00:00Z' },
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

await page.locator('.ing-card', { hasText: 'Eggs' }).first().click()
await page.waitForTimeout(700)

const rows = page.locator('.price-row')
check('one row per distinct product, newest price of each', await rows.count() === 3,
      String(await rows.count()))

const order = await rows.locator('.price-row-what').allTextContents()
check('cheapest per unit comes first', /12 medium/.test(order[0]), JSON.stringify(order))
check('the dearer pack comes second', /6 large free range/.test(order[1]), JSON.stringify(order))
check('a price with no comparable rate sinks to the bottom',
      /name this product/.test(order[2]) || order[2].includes('Tesco'), JSON.stringify(order))

check('each row names its shop',
      order[0].includes('Lidl') && order[1].includes('Tesco'), JSON.stringify(order))
check('each row shows the pack size', order[0].includes('12pk'))
check('the cheapest is marked', await page.locator('.price-row--best').count() === 1)
check('rates are shown per unit',
      (await rows.first().locator('.price-row-rate').textContent()).includes('unit'),
      await rows.first().locator('.price-row-rate').textContent())

// Full history stays reachable, including the superseded price.
await page.click('button:has-text("All 4 prices")')
await page.waitForTimeout(300)
check('history shows every price including superseded ones',
      (await page.textContent('.store-cmp-history')).includes('2.80'))

// Relabelling an unnamed price.
await page.locator('.price-row', { hasText: 'name this product' }).locator('.price-row-label').click()
await page.waitForTimeout(200)
await page.locator('.price-row input').fill('half dozen, unknown size')
await page.keyboard.press('Enter')
await page.waitForTimeout(700)
check('a price can be named after the fact',
      db.ingredient_prices.find(p => p.id === 3)?.label === 'half dozen, unknown size',
      JSON.stringify(db.ingredient_prices.find(p => p.id === 3)))

await browser.close()
process.exit(check.report(errors) ? 0 : 1)
