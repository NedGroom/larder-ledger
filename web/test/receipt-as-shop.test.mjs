// A receipt scanned from the Shops tab becomes a completed shop of its own.
import { chromium } from 'playwright'
import { makeDb, signIn, installRoutes, stubAi, checker, watchErrors, BASE, CHROME } from './fake-supabase.mjs'

const db = makeDb({
  categories: [{ id: 10, house_id: 1, name: 'Produce', name_normalized: 'produce' }],
  ingredients: [
    { id: 1, house_id: 1, name: 'Tomatoes', name_normalized: 'tomatoes', has_any: false, keep: true, canonical_rate_unit: 'g' },
  ],
  ingredient_categories: [{ ingredient_id: 1, category_id: 10 }],
  stores: [{ id: 1, house_id: 1, name: 'Tesco' }],
})

// One item the house knows, one it has never seen.
const AI_RESULT = {
  items: [
    { description: 'TOMATOES 400G', quantity: 2, price: 1.15, unit: '400g', match_type: 'existing', match_name: 'Tomatoes', match_alts: ['Tinned tomatoes', 'Cherry tomatoes'] },
    { description: 'MARMITE 250G',  quantity: 1, price: 3.40, unit: '250g', match_type: 'new',      match_name: 'Marmite',  match_alts: ['Yeast extract', 'Spread'] },
  ],
  fees: [], discounts: [], receipt_total: 5.70,
  store_name: 'Tesco', purchase_date: '2026-08-11',
}

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage()
const errors = watchErrors(page)
const check = checker()

await signIn(page)
const ai = stubAi(page, AI_RESULT)
await installRoutes(page, db)
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)

await page.click('text=🏪 Shops')
await page.waitForTimeout(700)
await page.click('summary:has-text("Scan a receipt")')
await page.waitForTimeout(500)
check('the scan is framed as a shop', (await page.textContent('body')).includes('Receipt → shop'))

await page.fill('textarea', 'TESCO\nTOMATOES 400G  2 @ 1.15\nMARMITE 250G  3.40\nTOTAL 5.70')
await page.click('button:has-text("Extract prices with AI")')
await page.waitForTimeout(1500)

check('the model is told which ingredients we know', ai.prompt.includes('Known ingredients') && ai.prompt.includes('Tomatoes'))
check('the model is told which shops we know', ai.prompt.includes('Known shops') && ai.prompt.includes('Tesco'))
check('the model is asked for the shop and date', ai.prompt.includes('store_name') && ai.prompt.includes('purchase_date'))
check('both lines are up for review', (await page.textContent('body')).includes('Review extracted items (2 found)'))

const confirm = page.locator('.receipt-shop-confirm')
check('shop and date are put up for confirmation', await confirm.count() === 1)
check('the shop read off the receipt is preselected', await confirm.locator('select').inputValue() === '1')
check('the date read off the receipt is preselected',
      await confirm.locator('input[type=date]').inputValue() === '2026-08-11')

await page.click('button:has-text("Save all")')
await page.waitForTimeout(2500)

check('exactly one shop was opened', db.shopping_lists.length === 1, JSON.stringify(db.shopping_lists))
const list = db.shopping_lists[0] || {}
check('it is already complete', list.status === 'done')
check('it is marked as coming from a receipt', list.source === 'receipt')
check('it carries the receipt date, not today', list.purchased_on === '2026-08-11')
check('it remembers the printed total', Number(list.receipt_total) === 5.7)
check('it is attributed to the right shop', list.store_id === 1)
check('our line total is tallied without float dust', Number(list.total_paid) === 5.7, String(list.total_paid))

check('both lines became purchases', db.shopping_list_items.length === 2)
check('purchases are bought, priced and packed',
      db.shopping_list_items.every(i => i.bought && i.price_paid != null && i.unit_size_unit && i.source === 'receipt-ai'))
check('every purchase points at a real ingredient', db.shopping_list_items.every(i => i.ingredient_id != null))
check('the unknown item became a remembered ingredient',
      db.ingredients.some(i => i.name === 'Marmite' && i.keep === true))
check('prices were logged for both', db.ingredient_prices.length === 2)
check('prices carry a canonical rate', db.ingredient_prices.every(p => p.canonical_rate != null))
check('prices are attributed to the shop', db.ingredient_prices.every(p => p.store_id === 1))
// The receipt knows the product; that wording must survive onto the price row,
// or the comparison can't tell two products under one ingredient apart.
check('the receipt line names the product on the price row',
      db.ingredient_prices.some(p => p.label === 'TOMATOES 400G') &&
      db.ingredient_prices.some(p => p.label === 'MARMITE 250G'),
      JSON.stringify(db.ingredient_prices.map(p => p.label)))
check('bought items are back in stock', db.ingredients.every(i => i.has_any === true))

// A finished receipt must not occupy the "one shop at a time" slot.
await page.click('text=🛒 Shopping')
await page.waitForTimeout(1200)
check('it does not block building a new list', (await page.textContent('body')).includes('Make a shopping list'))

await page.click('button:has-text("③ History")')
await page.waitForTimeout(900)
const hist = await page.textContent('body')
check('the scanned shop appears in history', hist.includes('Tesco') && hist.includes('11 Aug'))
check('history marks it as a receipt', hist.includes('🧾 receipt'))

await browser.close()
process.exit(check.report(errors) ? 0 : 1)
