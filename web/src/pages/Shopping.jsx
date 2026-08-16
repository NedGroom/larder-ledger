import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import { useApp } from '../App.jsx'

// Shopping is a loop:
//   ① Build   — pick from what you're out of, choose a shop, set quantities
//   ② Shop    — mark items bought (flips them back to in-stock + logs the price)
//   ③ History — past shops, kept for good
// There is at most one active (building/shopping) list per house — "Make list"
// reopens it rather than starting a second one.

const itemName = it => it.ingredients?.name ?? it.custom_name ?? '—'

// A single row on the Shop screen. Kept at module scope (stable identity) so its
// price/qty inputs don't lose focus when the parent re-renders.
function ShopRow({ item, onBought, onRemove }) {
  const [price, setPrice] = useState(item.price_paid ?? '')
  const [qty, setQty] = useState(item.quantity ?? 1)
  return (
    <div className="card" style={{ flexWrap: 'wrap', opacity: item.bought ? .7 : 1 }}>
      <span className="name" style={item.bought ? { textDecoration: 'line-through' } : undefined}>{itemName(item)}</span>
      {item.meals?.name && <span className="pill blue" style={{ fontSize: '.7rem' }}>🍲 {item.meals.name}</span>}
      <span className="meta">×{item.quantity}</span>
      {!item.bought
        ? <button className="btn small" onClick={() => onBought(item, true, price === '' ? null : +price, +qty || 1)}>Bought</button>
        : <button className="btn small secondary" onClick={() => onBought(item, false, null, item.quantity)}>Undo</button>}
      {!item.bought && <button className="btn small secondary" title="Remove from list" onClick={() => onRemove(item)}>✕</button>}
      {!item.bought && (
        <div className="bought-inputs" style={{ flexBasis: '100%' }}>
          <span className="meta">paid £</span>
          <input type="number" step="0.01" min="0" value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" style={{ width: 70 }} />
          <span className="meta">× qty</span>
          <input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} style={{ width: 52 }} />
        </div>
      )}
      {item.bought && item.price_paid != null && (
        <span className="meta">£{(item.price_paid * item.quantity).toFixed(2)}</span>
      )}
    </div>
  )
}

export default function Shopping() {
  const { house } = useApp()
  const [view, setView] = useState('build')
  const [loading, setLoading] = useState(true)

  const [candidates, setCandidates] = useState([])   // ingredients with has_any=false
  const [stores, setStores] = useState([])
  const [pricesByIng, setPricesByIng] = useState({}) // ingredient_id → { store_id: price }
  const [activeList, setActiveList] = useState(null)  // {id, store_id, status, stores?}
  const [items, setItems] = useState([])              // items of the active list
  const [history, setHistory] = useState([])

  // build-screen local state
  const [picked, setPicked] = useState({})            // ingredient_id → { checked, qty }
  const [oneOffs, setOneOffs] = useState([])          // [{ name, qty }]
  const [oneOffName, setOneOffName] = useState('')
  const [addName, setAddName] = useState('')          // add-to-active-list input
  const [storeId, setStoreId] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: cand }, { data: st }, { data: lists }] = await Promise.all([
      supabase.from('ingredients').select('id, name, keep, has_any').eq('house_id', house.id).eq('has_any', false).order('name'),
      supabase.from('stores').select('id, name').eq('house_id', house.id).order('name'),
      supabase.from('shopping_lists').select('*, stores(name)').eq('house_id', house.id).in('status', ['building', 'shopping']).order('created_at', { ascending: false }).limit(1),
    ])
    setStores(st ?? [])
    const list = lists?.[0] ?? null
    setActiveList(list)

    // default build selection: every out item that we "keep" is ticked
    const p = {}
    for (const c of (cand ?? [])) p[c.id] = { checked: !!c.keep, qty: 1 }
    setCandidates(cand ?? [])
    setPicked(p)

    // latest known price per (ingredient, store), for the build price preview
    const candIds = (cand ?? []).map(c => c.id)
    if (candIds.length) {
      const { data: prices } = await supabase
        .from('ingredient_prices')
        .select('ingredient_id, store_id, price, noted_at')
        .in('ingredient_id', candIds)
        .order('noted_at', { ascending: false })
      const map = {}
      for (const row of (prices ?? [])) {
        const k = row.store_id ?? '_'
        map[row.ingredient_id] ??= {}
        if (map[row.ingredient_id][k] == null) map[row.ingredient_id][k] = row.price // first = latest
      }
      setPricesByIng(map)
    } else {
      setPricesByIng({})
    }

    if (list) {
      const { data: li } = await supabase
        .from('shopping_list_items')
        .select('*, ingredients(name), meals(name)')
        .eq('list_id', list.id)
        .order('created_at', { ascending: true })
      setItems(li ?? [])
      setView(v => (v === 'history' ? 'history' : 'shop'))
    } else {
      setItems([])
      setView(v => (v === 'history' ? 'history' : 'build'))
    }
    setLoading(false)
  }, [house.id])

  useEffect(() => { load() }, [load])

  const loadHistory = useCallback(async () => {
    const { data } = await supabase
      .from('shopping_lists')
      .select('*, stores(name), shopping_list_items(count)')
      .eq('house_id', house.id).eq('status', 'done')
      .order('completed_at', { ascending: false })
    setHistory(data ?? [])
  }, [house.id])
  useEffect(() => { if (view === 'history') loadHistory() }, [view, loadHistory])

  // ── ① Build ─────────────────────────────────────────────────────────────────
  const toggle = id => setPicked(p => ({ ...p, [id]: { ...p[id], checked: !p[id]?.checked } }))
  const setQty = (id, qty) => setPicked(p => ({ ...p, [id]: { ...p[id], qty: Math.max(1, qty) } }))

  // price for a candidate at the chosen shop (cheapest across shops when "Any")
  function priceFor(ingredientId) {
    const byStore = pricesByIng[ingredientId]
    if (!byStore) return null
    if (storeId) return byStore[storeId] ?? null
    const vals = Object.values(byStore).filter(v => v != null)
    return vals.length ? Math.min(...vals) : null
  }
  function addOneOff() {
    const n = oneOffName.trim()
    if (!n) return
    setOneOffs(o => [...o, { name: n, qty: 1 }])
    setOneOffName('')
  }

  async function startShop() {
    const chosen = candidates.filter(c => picked[c.id]?.checked)
    if (chosen.length === 0 && oneOffs.length === 0) { setMsg('Tick at least one item first'); return }
    setBusy(true); setMsg('')
    const { data: list, error } = await supabase
      .from('shopping_lists')
      .insert({ house_id: house.id, store_id: storeId ? +storeId : null, status: 'shopping' })
      .select('*, stores(name)').single()
    if (error) { setMsg(error.message); setBusy(false); return }

    const rows = [
      ...chosen.map(c => ({ house_id: house.id, list_id: list.id, ingredient_id: c.id, quantity: picked[c.id].qty, auto_generated: false, bought: false })),
      ...oneOffs.map(o => ({ house_id: house.id, list_id: list.id, ingredient_id: null, custom_name: o.name, quantity: o.qty, auto_generated: false, bought: false })),
    ]
    const { error: e2 } = await supabase.from('shopping_list_items').insert(rows)
    if (e2) { setMsg(e2.message); setBusy(false); return }

    setOneOffs([]); setBusy(false)
    await load()
    setView('shop')
  }

  // ── ② Shop ──────────────────────────────────────────────────────────────────
  async function markBought(item, bought, price, qty) {
    const patch = { bought, quantity: qty, price_paid: price ?? null, bought_at: bought ? new Date().toISOString() : null }
    const { error } = await supabase.from('shopping_list_items').update(patch).eq('id', item.id)
    if (error) { setMsg(error.message); return }
    if (bought && item.ingredient_id) {
      await supabase.from('ingredients').update({ has_any: true }).eq('id', item.ingredient_id)
      // only log a price on the transition into "bought" (avoid dup rows on re-toggles)
      if (!item.bought && price != null && !isNaN(price)) {
        await supabase.from('ingredient_prices').insert({
          ingredient_id: item.ingredient_id,
          store_id: activeList?.store_id ?? null,
          price, currency: 'GBP', source: 'shop',
        })
      }
    }
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, ...patch } : i))
  }

  async function addToActiveList() {
    const n = addName.trim()
    if (!n || !activeList) return
    const { data } = await supabase.from('shopping_list_items')
      .insert({ house_id: house.id, list_id: activeList.id, ingredient_id: null, custom_name: n, quantity: 1, auto_generated: false, bought: false })
      .select('*, ingredients(name), meals(name)').single()
    if (data) setItems(prev => [...prev, data])
    setAddName('')
  }

  async function removeItem(item) {
    await supabase.from('shopping_list_items').delete().eq('id', item.id)
    setItems(prev => prev.filter(i => i.id !== item.id))
  }

  async function finishShop() {
    const total = items.filter(i => i.bought).reduce((t, i) => t + (i.price_paid ? i.price_paid * i.quantity : 0), 0)
    await supabase.from('shopping_lists')
      .update({ status: 'done', completed_at: new Date().toISOString(), total_paid: total })
      .eq('id', activeList.id)
    setActiveList(null); setItems([])
    setView('history')
    await load()
  }

  async function cancelShop() {
    if (!activeList) return
    await supabase.from('shopping_lists').delete().eq('id', activeList.id) // cascades items
    setActiveList(null); setItems([])
    setView('build')
    await load()
  }

  // ── render helpers (plain functions, inlined — no remounting) ────────────────
  const subNav = () => (
    <div className="shop-nav">
      <span className="shop-nav-lbl">Shopping</span>
      {[['build', '① Build'], ['shop', '② Shop'], ['history', '③ History']].map(([id, label]) => (
        <button key={id} className={view === id ? 'on' : ''} onClick={() => setView(id)}>{label}</button>
      ))}
    </div>
  )

  function buildView() {
    if (activeList) {
      return (
        <div className="shop-banner">
          <p><strong>You have a shop in progress</strong>{activeList.stores?.name ? ` at ${activeList.stores.name}` : ''}.</p>
          <p className="muted-note">Only one shop runs at a time. Continue it, or cancel to start fresh.</p>
          <div className="btn-row">
            <button className="btn" onClick={() => setView('shop')}>Continue shopping →</button>
            <button className="btn secondary" onClick={cancelShop}>Cancel shop</button>
          </div>
        </div>
      )
    }
    const chosenCount = candidates.filter(c => picked[c.id]?.checked).length + oneOffs.length
    return (
      <>
        <div className="section-title"><h2>Make a shopping list</h2></div>
        <p className="muted-note">Everything you're out of. Items you keep are ticked; not-kept ones are left off — change any of them.</p>

        <label>Shop (for price preview)
          <select value={storeId} onChange={e => setStoreId(e.target.value)}>
            <option value="">Any shop</option>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>

        {candidates.length === 0 && oneOffs.length === 0 && (
          <p className="empty">Nothing is out of stock. Add a one-off below, or mark items missing in the Larder.</p>
        )}

        <div style={{ marginTop: '.6rem' }}>
          {candidates.map(c => {
            const sel = picked[c.id] ?? {}
            const price = priceFor(c.id)
            return (
              <div key={c.id} className="card" style={{ opacity: sel.checked ? 1 : .55 }}>
                <input type="checkbox" checked={!!sel.checked} onChange={() => toggle(c.id)} aria-label={`Include ${c.name}`} />
                <span className="name">{c.name}</span>
                {!c.keep && <span className="pill gray" style={{ fontSize: '.7rem' }}>not kept</span>}
                {sel.checked && (
                  <span className="qty-step">
                    <button type="button" onClick={() => setQty(c.id, (sel.qty ?? 1) - 1)} aria-label="Fewer">−</button>
                    <span>{sel.qty ?? 1}</span>
                    <button type="button" onClick={() => setQty(c.id, (sel.qty ?? 1) + 1)} aria-label="More">+</button>
                  </span>
                )}
                <span className="meta" style={{ minWidth: 48, textAlign: 'right' }}>
                  {price != null ? `£${(price * (sel.checked ? (sel.qty ?? 1) : 1)).toFixed(2)}` : '—'}
                </span>
              </div>
            )
          })}

          {oneOffs.map((o, i) => (
            <div key={`o${i}`} className="card">
              <span className="name">{o.name}</span>
              <span className="pill blue" style={{ fontSize: '.7rem' }}>one-off</span>
              <button className="btn small secondary" onClick={() => setOneOffs(oneOffs.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
        </div>

        <div className="field-row" style={{ marginTop: '.5rem' }}>
          <label style={{ flex: 1 }}>Add a one-off item (not in your Larder)
            <input value={oneOffName} onChange={e => setOneOffName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOneOff() } }}
              placeholder="e.g. Birthday candles" />
          </label>
          <button className="btn small" type="button" style={{ marginTop: 22 }} onClick={addOneOff}>Add</button>
        </div>

        {(() => {
          const est = candidates.filter(c => picked[c.id]?.checked)
            .reduce((t, c) => { const p = priceFor(c.id); return p != null ? t + p * (picked[c.id].qty ?? 1) : t }, 0)
          const anyPriced = candidates.some(c => picked[c.id]?.checked && priceFor(c.id) != null)
          return anyPriced ? (
            <p className="muted-note" style={{ marginTop: '.6rem' }}>
              Estimated at {storeId ? stores.find(s => String(s.id) === storeId)?.name : 'the cheapest shop'}: <strong>£{est.toFixed(2)}</strong>
              {' '}(items without a recorded price aren't counted)
            </p>
          ) : null
        })()}

        {msg && <p className="msg err">{msg}</p>}
        <button className="btn" style={{ marginTop: '.4rem' }} onClick={startShop} disabled={busy || chosenCount === 0}>
          {busy ? <span className="spinner" /> : `Start shop → (${chosenCount})`}
        </button>
      </>
    )
  }

  function shopView() {
    if (!activeList) {
      return (<>
        <div className="section-title"><h2>Shop</h2></div>
        <p className="empty">No shop in progress. Build a list in ① first.</p>
      </>)
    }
    const done = items.filter(i => i.bought).length
    const spent = items.filter(i => i.bought).reduce((t, i) => t + (i.price_paid ? i.price_paid * i.quantity : 0), 0)
    return (
      <>
        <div className="section-title">
          <h2>Shopping{activeList.stores?.name ? ` at ${activeList.stores.name}` : ''}</h2>
          <span className="pill blue">{done}/{items.length} bought</span>
        </div>
        <div className="fbar fbar--wide" style={{ margin: '0 0 .6rem' }}>
          <span className="fbar-fill" style={{ width: `${items.length ? done / items.length * 100 : 0}%` }} />
        </div>
        <p className="muted-note">
          Tap <strong>Bought</strong> as it goes in the trolley — enter what you paid and it drops back into your Larder.
          Or record the whole shop from a receipt in the <strong>Shops</strong> tab.
        </p>

        {items.map(item => <ShopRow key={item.id} item={item} onBought={markBought} onRemove={removeItem} />)}

        <div className="field-row" style={{ marginTop: '.5rem' }}>
          <label style={{ flex: 1 }}>Forgot something? Add it
            <input value={addName} onChange={e => setAddName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addToActiveList() } }}
              placeholder="e.g. Milk" />
          </label>
          <button className="btn small" type="button" style={{ marginTop: 22 }} onClick={addToActiveList}>Add</button>
        </div>

        <hr className="divider" />
        <div className="section-title">
          <h2 style={{ fontSize: '1rem' }}>Spent so far: £{spent.toFixed(2)}</h2>
          <button className="btn" onClick={finishShop} disabled={done === 0}>Finish shop</button>
        </div>
      </>
    )
  }

  function historyView() {
    return (
      <>
        <div className="section-title">
          <h2>Past shops</h2>
          {!activeList && <button className="btn small" onClick={() => setView('build')}>+ New list</button>}
        </div>
        {history.length === 0 && <p className="empty">No finished shops yet.</p>}
        {history.map(h => {
          const count = h.shopping_list_items?.[0]?.count ?? 0
          const date = h.completed_at ? new Date(h.completed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : ''
          return (
            <div key={h.id} className="card">
              <span className="name">{h.stores?.name ?? 'Mixed'}</span>
              <span className="meta">{date} · {count} item{count === 1 ? '' : 's'}</span>
              <span className="pill green">£{Number(h.total_paid ?? 0).toFixed(2)}</span>
            </div>
          )
        })}
      </>
    )
  }

  return (
    <>
      {subNav()}
      {loading
        ? <p className="empty">Loading…</p>
        : (view === 'build' ? buildView() : view === 'shop' ? shopView() : historyView())}
    </>
  )
}
