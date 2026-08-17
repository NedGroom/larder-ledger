/**
 * A stand-in Supabase for browser tests.
 *
 * It intercepts the app's REST calls and serves them from an in-memory object,
 * so tests drive the real UI and real client code while being able to inspect
 * exactly what got written. It implements only the query shapes this app
 * actually uses — eq/in filters, the embedded relations, and single-row
 * requests — not PostgREST at large.
 */

export function makeDb(overrides = {}) {
  return {
    users: [{ id: 1, auth_uid: 'uid-1', email: 'ned@example.com', name: 'Ned' }],
    houses: [{ id: 1, name: 'Flat 69' }],
    house_users: [{ house_id: 1, user_id: 1, houses: { id: 1, name: 'Flat 69' } }],
    categories: [],
    ingredients: [],
    ingredient_categories: [],
    ingredient_prices: [],
    stores: [],
    meals: [],
    meal_ingredients: [],
    shopping_lists: [],
    shopping_list_items: [],
    ...overrides,
  }
}

/** Sign the browser in without a real auth round-trip. */
export async function signIn(page) {
  await page.addInitScript(() => {
    const exp = Math.floor(Date.now() / 1000) + 86400
    localStorage.setItem('sb-127-auth-token', JSON.stringify({
      access_token: 'fake', token_type: 'bearer', expires_in: 86400, expires_at: exp,
      refresh_token: 'fake',
      user: { id: 'uid-1', email: 'ned@example.com', user_metadata: { full_name: 'Ned' } },
    }))
  })
  await page.route('**/auth/v1/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"uid-1"}' }))
}

/**
 * Serve the AI receipt-extraction endpoint with a canned result.
 * Returns a handle whose `.prompt` holds the system prompt the app sent, so
 * tests can assert on what the model was actually told.
 */
export function stubAi(page, result) {
  const seen = { prompt: '' }
  page.route('**/functions/v1/copilot-proxy', async route => {
    seen.prompt = JSON.stringify(route.request().postDataJSON()?.messages?.[0]?.content ?? '')
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }),
    })
  })
  return seen
}

export async function installRoutes(page, db) {
  let nextId = 700

  await page.route('**/rest/v1/**', async route => {
    const req = route.request()
    const url = new URL(req.url())
    const table = url.pathname.split('/rest/v1/')[1].split('?')[0]
    const method = req.method()
    const select = url.searchParams.get('select') || ''

    // Fill in the relations the app asks for via PostgREST's embed syntax.
    const embed = r => {
      const out = { ...r }
      if (select.includes('ingredients(') && r.ingredient_id != null) {
        out.ingredients = { name: db.ingredients.find(i => i.id === r.ingredient_id)?.name }
      }
      if (select.includes('meals(')) out.meals = null
      if (select.includes('stores(')) {
        out.stores = r.store_id ? { name: db.stores.find(s => s.id === r.store_id)?.name } : null
      }
      if (select.includes('users(')) out.users = db.users[0]
      if (select.includes('shopping_list_items(count)')) {
        out.shopping_list_items = [{ count: db.shopping_list_items.filter(i => i.list_id === r.id).length }]
      }
      return out
    }

    let body
    if (method === 'GET') {
      let rows = db[table] ? [...db[table]] : []
      for (const [k, v] of url.searchParams) {
        if (['select', 'order', 'limit', 'offset'].includes(k)) continue
        if (v.startsWith('eq.')) {
          rows = rows.filter(r => String(r[k]) === v.slice(3))
        } else if (v.startsWith('in.')) {
          const set = v.slice(3).replace(/^\(|\)$/g, '').split(',').map(x => x.replace(/"/g, ''))
          rows = rows.filter(r => set.includes(String(r[k])))
        }
      }
      body = rows.map(embed)
    } else if (method === 'POST') {
      const payload = req.postDataJSON()
      const arr = Array.isArray(payload) ? payload : [payload]
      body = arr.map(p => {
        if (table === 'users' && p.auth_uid) {
          const found = db.users.find(u => u.auth_uid === p.auth_uid)
          if (found) return found
        }
        const row = { id: nextId++, ...p }
        ;(db[table] = db[table] || []).push(row)
        return row
      }).map(embed)
    } else if (method === 'PATCH') {
      const idFilter = url.searchParams.get('id')
      const rows = (db[table] || []).filter(r => !idFilter || String(r.id) === idFilter.slice(3))
      rows.forEach(r => Object.assign(r, req.postDataJSON()))
      body = rows.map(embed)
    } else if (method === 'DELETE') {
      const idFilter = url.searchParams.get('id')
      if (db[table] && idFilter) db[table] = db[table].filter(r => String(r.id) !== idFilter.slice(3))
      body = []
    } else {
      body = []
    }

    const wantsSingle = (req.headers()['accept'] || '').includes('vnd.pgrst.object')
    await route.fulfill({
      status: method === 'POST' ? 201 : 200,
      contentType: 'application/json',
      body: JSON.stringify(wantsSingle ? (body[0] ?? null) : body),
    })
  })
}

// ── Tiny assertion collector ─────────────────────────────────────────────────
export function checker() {
  const results = []
  const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail })
  check.report = errors => {
    let failed = 0
    for (const r of results) {
      console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}${r.ok || !r.detail ? '' : `  → ${r.detail}`}`)
      if (!r.ok) failed++
    }
    if (errors?.length) {
      console.log('\nBrowser errors:')
      for (const e of [...new Set(errors)].slice(0, 10)) console.log('  ' + e)
    }
    console.log(`\n${results.length - failed}/${results.length} checks passed`)
    return failed === 0 && !errors?.length
  }
  return check
}

export function watchErrors(page) {
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  page.on('pageerror', e => errors.push('pageerror: ' + e.message))
  return errors
}

export const BASE = 'http://localhost:5173/larder-ledger/'
export const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
