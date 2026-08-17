# Browser tests

End-to-end checks that drive the real UI in Chromium against a **fake Supabase**
(`fake-supabase.mjs` intercepts the REST calls and serves them from memory).
Nothing touches the live database, and no AI credits are spent — the receipt
extraction endpoint is stubbed with a canned response.

Because the fake database is a plain object, the tests can assert on what the
app actually *wrote*, not just what it rendered. That's where the value is: they
cover the promises the data model makes — every shopping-list line points at a
real ingredient, a buy logs exactly one price and can retract it, a receipt fills
the line you planned instead of duplicating it.

## Running them

The planner's arithmetic is tested separately as pure functions — no browser,
no server, nothing to set up:

```bash
cd web && node test/planner-math.test.mjs
```

The browser suites need a dev server and Playwright. Playwright is deliberately
not a dependency in `package.json` — install it on demand:

```bash
cd web
printf 'VITE_SUPABASE_URL=http://127.0.0.1:9999\nVITE_SUPABASE_ANON_KEY=test\n' > .env
npm run dev &
npm i --no-save playwright

for t in larder-and-shop receipt-as-shop receipt-fills-shop planner dishes; do
  node test/$t.test.mjs
done
```

Each script exits non-zero if any check fails **or** if the browser logged any
error, and prints a line per check.

`CHROME_PATH` overrides the Chromium binary if Playwright's default location
isn't right for your machine.

## The suites

| File | Covers |
|---|---|
| `larder-and-shop.test.mjs` | Browsing the larder (categories, dimming, search, quick-create), building a list from it, buying/undoing, adding mid-shop, history |
| `receipt-as-shop.test.mjs` | A receipt scanned in the Shops tab becoming its own completed shop, with the shop and date read off the photo |
| `receipt-fills-shop.test.mjs` | A receipt scanned mid-shop filling the list already in progress |
| `planner.test.mjs` | The deck, adding to a cook, placing servings, the analyse view, and handing off to a shop |
| `dishes.test.mjs` | Authoring a dish with computable quantities, and the plan-a-dish shortcut |
| `planner-math.test.mjs` | The planner's arithmetic as pure functions (overlapping periods, scaling, nutrition, card debits) |

## A caveat worth knowing

`fake-supabase.mjs` implements only the query shapes this app uses — `eq`/`in`
filters, the embedded relations, and single-row requests. It is not PostgREST.
If you write a query it doesn't understand it will quietly return the wrong
rows, so check the fake when a test result looks impossible.
