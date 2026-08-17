// A receipt scanned during a shop fills the list you already had — ticking off
// what you planned rather than starting a parallel set of lines.
import { chromium } from 'playwright'
import { makeDb, signIn, installRoutes, stubAi, checker, watchErrors, BASE, CHROME } from './fake-supabase.mjs'

const db = makeDb({
  ingredients: [
    { id: 1, house_id: 1, name: 'Tomatoes', name_normalized: 'tomatoes', has_any: false, keep: true, canonical_rate_unit: 'g' },
  ],
  stores: [{ id: 1, house_id: 1, name: 'Tesco' }],
  // A shop already under way, with Tomatoes planned but not yet bought.
  shopping_lists: [{ id: 900, house_id: 1, store_id: 1, status: 'shopping', source: 'manual', purchased_on: '2026-08-17' }],
  shopping_list_items: [{ id: 901, house_id: 1, list_id: 900, ingredient_id: 1, quantity: 1, bought: false, source: 'manual' }],
})

const AI_RESULT = {
  items: [
    { description: 'TOMATOES 400G', quantity: 2, price: 1.15, unit: '400g', match_type: 'existing', match_name: 'Tomatoes', match_alts: [] },
    { description: 'MARMITE 250G',  quantity: 1, price: 3.40, unit: '250g', match_type: 'new',      match_name: 'Marmite',  match_alts: [] },
  ],
  fees: [], discounts: [], receipt_total: 5.70, store_name: 'Tesco', purchase_date: '2026-08-17',
}

const SHOP_ROW = '.card:not(.ing-card)'

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage()
const errors = watchErrors(page)
const check = checker()

await signIn(page)
stubAi(page, AI_RESULT)
await installRoutes(page, db)
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)

await page.click('text=🛒 Shopping')
await page.waitForTimeout(1200)
check('lands straight in the shop in progress', (await page.textContent('body')).includes('Shopping at Tesco'))
check('the planned line is waiting', await page.locator(SHOP_ROW, { hasText: 'Tomatoes' }).count() === 1)

await page.click('button:has-text("Fill from receipt")')
await page.waitForTimeout(600)
check('the scan is framed as filling this shop',
      (await page.textContent('body')).includes('Fill this shop from the receipt'))
check('no shop/date picker — the shop already has one',
      await page.locator('.receipt-shop-confirm').count() === 0)

await page.fill('.receipt-inline textarea', 'TESCO\nTOMATOES\nMARMITE')
await page.click('button:has-text("Extract prices with AI")')
await page.waitForTimeout(1500)
await page.click('button:has-text("Save all")')
await page.waitForTimeout(2500)

check('no second shop was opened', db.shopping_lists.length === 1)
const tomatoes = db.shopping_list_items.filter(i => i.ingredient_id === 1)
check('the planned line was filled, not duplicated', tomatoes.length === 1, JSON.stringify(tomatoes))
check('it reused the original row', tomatoes[0]?.id === 901)
check('it is bought at the receipt price and quantity',
      tomatoes[0]?.bought === true && Number(tomatoes[0]?.price_paid) === 1.15 && tomatoes[0]?.quantity === 2)
check('the unplanned item joined the same shop',
      db.shopping_list_items.length === 2 && db.shopping_list_items.every(i => i.list_id === 900))
check('the receipt purchases show up in the list', (await page.textContent('body')).includes('Marmite'))
check('spend reflects the receipt', (await page.textContent('body')).includes('Spent so far: £5.70'))

await browser.close()
process.exit(check.report(errors) ? 0 : 1)
