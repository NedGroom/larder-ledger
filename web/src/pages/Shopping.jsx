import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import { useApp } from '../App.jsx'
import IngredientBrowser from '../components/IngredientBrowser.jsx'
import IngredientPanel from '../components/IngredientPanel.jsx'
import Receipts from './Receipts.jsx'
import { loadLarder, loadPrices, priceFor, recordPurchase, undoPurchase } from '../lib/larder.js'
import { requirementsForPeriod, todayStr as planToday } from '../lib/planner.js'

// Shopping is a loop:
//   ① Build   — scroll the larder and set quantities for what you want
//   ② Shop    — mark items bought, by hand or from a receipt
//   ③ History — past shops, kept for good
//
// Building a list is the same act as browsing the larder: same cards, same
// categories, same search. A line is "on the list" simply by having a quantity
// above zero. Every line points at a real ingredient, so anything you buy once
// is remembered and offered again next time.
//
// There is at most one active (building/shopping) list per house.

const itemName = it => it.ingredients?.name ?? '—'
const today = () => new Date().toISOString().slice(0, 10)

// A single row on the Shop screen. Kept at module scope (stable identity) so its
// price/qty inputs don't lose focus when the parent re-renders.
function ShopRow({ item, onBought, onUndo, onRemove }) {
  const [price, setPrice] = useState(item.price_paid ?? '')
  const [qty, setQty] = useState(item.quantity ?? 1)
  const [unit, setUnit] = useState(item.unit_size_unit ?? '')

  return (
    <div className="card" style={{ flexWrap: 'wrap', opacity: item.bought ? .7 : 1 }}>
      <span className="name" style={item.bought ? { textDecoration: 'line-through' } : undefined}>{itemName(item)}</span>
      {item.meals?.name && <span className="pill blue" style={{ fontSize: '.7rem' }}>🍲 {item.meals.name}</span>}
      {item.source === 'receipt-ai' && <span className="pill gray" style={{ fontSize: '.7rem' }}>🧾 receipt</span>}
      <span className="meta">×{item.quantity}</span>
      {!item.bought
        ? <button className="btn small" onClick={() => onBought(item, price, qty, unit)}>Bought</button>
        : <button className="btn small secondary" onClick={() => onUndo(item)}>Undo</button>}
      {!item.bought && <button className="btn small secondary" title="Remove from list" onClick={() => onRemove(item)}>✕</button>}
      {!item.bought && (
        <div className="bought-inputs" style={{ flexBasis: '100%' }}>
          <span className="meta">paid £</span>
          <input type="number" step="0.01" min="0" value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" style={{ width: 70 }} />
          <span className="meta">× qty</span>
          <input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} style={{ width: 52 }} />
          <span className="meta">pack</span>
          <input value={unit} onChange={e => setUnit(e.target.value)} placeholder="500g" style={{ width: 64 }} />
        </div>
      )}
      {item.bought && item.price_paid != null && (
        <span className="meta">£{(item.price_paid * item.quantity).toFixed(2)}</span>
      )}
    </div>
  )
}

/**
 * Pull a period's planned cooks onto the list. The plan is a source for the
 * shopping list, never a second list of its own.
 */
function PlanPreset({ periods, components, ingredients, onFill }) {
  const [periodId, setPeriodId] = useState(String(periods[0]?.id ?? ''))
  const [includeStocked, setIncludeStocked] = useState(false)
  const period = periods.find(p => String(p.id) === periodId)

  const need = period ? requirementsForPeriod(period, components) : {}
  const outstanding = Object.keys(need).map(Number)
    .filter(id => includeStocked || !ingredients.find(i => i.id === id)?.has_any).length

  return (
    <div className="plan-preset">
      <span className="meta">From the plan</span>
      <select value={periodId} onChange={e => setPeriodId(e.target.value)}>
        {periods.map(p => (
          <option key={p.id} value={p.id}>
            {p.name || `${p.starts_on} → ${p.ends_on}`}
          </option>
        ))}
      </select>
      <label className="plan-preset-check">
        <input type="checkbox" checked={includeStocked} onChange={e => setIncludeStocked(e.target.checked)} />
        <span>include what's in the house</span>
      </label>
      <button className="btn small secondary" type="button" disabled={!period || outstanding === 0}
        onClick={() => onFill(period, includeStocked)}>
        Add {outstanding} item{outstanding === 1 ? '' : 's'}
      </button>
    </div>
  )
}

export default function Shopping() {
  const { house } = useApp()
  const [view, setView] = useState('build')
  const [loading, setLoading] = useState(true)

  const [ingredients, setIngredients] = useState([])
  const [categories, setCategories] = useState([])
  const [stores, setStores] = useState([])
  const [pricesByIng, setPricesByIng] = useState({})
  const [activeList, setActiveList] = useState(null)  // {id, store_id, status, stores?}
  const [items, setItems] = useState([])              // items of the active list
  const [history, setHistory] = useState([])
  const [histItems, setHistItems] = useState({})      // list_id → items[]
  const [expandedHist, setExpandedHist] = useState(null)

  const [picked, setPicked] = useState({})            // ingredient_id → qty (build screen)
  const [storeId, setStoreId] = useState('')
  const [shopDate, setShopDate] = useState(today())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [selected, setSelected] = useState(null)      // ingredient detail panel
  const [periods, setPeriods] = useState([])
  const [planComponents, setPlanComponents] = useState([])
  const [showReceipt, setShowReceipt] = useState(false)
  const [receiptOpened, setReceiptOpened] = useState(false)
  const [showAddMore, setShowAddMore] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ ingredients: ings, categories: cats }, { data: st }, { data: lists }] = await Promise.all([
      loadLarder(house.id),
      supabase.from('stores').select('id, name').eq('house_id', house.id).order('name'),
      supabase.from('shopping_lists').select('*, stores(name)').eq('house_id', house.id)
        .in('status', ['building', 'shopping']).order('created_at', { ascending: false }).limit(1),
    ])

    // What the meal plan says this house intends to cook — the shopping list's
    // other source, alongside browsing the larder by hand.
    const [{ data: per }, { data: comps }] = await Promise.all([
      supabase.from('periods').select('*').eq('house_id', house.id).order('starts_on', { ascending: false }),
      supabase.from('cook_components')
        .select('id, cooks(period_id), cook_component_ingredients(ingredient_id, qty_total)')
        .eq('house_id', house.id),
    ])
    setPeriods(per ?? [])
    setPlanComponents(comps ?? [])
    setIngredients(ings)
    setCategories(cats)
    setStores(st ?? [])
    setPricesByIng(await loadPrices(ings.map(i => i.id)))

    const list = lists?.[0] ?? null
    setActiveList(list)

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
      .order('purchased_on', { ascending: false, nullsFirst: false })
      .order('completed_at', { ascending: false })
    setHistory(data ?? [])
  }, [house.id])
  useEffect(() => { if (view === 'history') loadHistory() }, [view, loadHistory])

  async function toggleHistExpand(listId) {
    if (expandedHist === listId) { setExpandedHist(null); return }
    setExpandedHist(listId)
    if (!histItems[listId]) {
      const { data } = await supabase
        .from('shopping_list_items')
        .select('*, ingredients(name), meals(name)')
        .eq('list_id', listId)
        .order('created_at', { ascending: true })
      setHistItems(prev => ({ ...prev, [listId]: data ?? [] }))
    }
  }

  // Keep the local larder copy honest after a buy flips something into stock.
  function markStocked(ingredientId) {
    setIngredients(prev => prev.map(i => i.id === ingredientId ? { ...i, has_any: true } : i))
  }

  // Once a shop is under way its own store decides the prices shown, so a
  // reload mid-shop doesn't silently fall back to cheapest-anywhere.
  const previewStoreId = activeList ? (activeList.store_id ?? '') : storeId
  const priceOf = id => priceFor(pricesByIng, id, previewStoreId)

  // ── ① Build ─────────────────────────────────────────────────────────────────
  const setQty = (id, qty) => setPicked(p => {
    const next = { ...p }
    if (qty > 0) next[id] = qty; else delete next[id]
    return next
  })

  /**
   * Tick everything a period's planned cooks call for. Things already in the
   * house are left off — you'll see them greyed in the larder either way, so
   * the plan being fully covered stays visible.
   */
  function fillFromPlan(period, includeStocked) {
    const need = requirementsForPeriod(period, planComponents)
    const ids = Object.keys(need).map(Number)
      .filter(id => includeStocked || !ingredients.find(i => i.id === id)?.has_any)
    if (!ids.length) { setMsg('That period’s cooks don’t need anything you haven’t got.'); return }
    setPicked(p => {
      const next = { ...p }
      for (const id of ids) next[id] ??= 1
      return next
    })
    setMsg('')
  }

  async function toggleKeep(ing) {
    const next = !(ing.keep ?? true)
    setIngredients(prev => prev.map(i => i.id === ing.id ? { ...i, keep: next } : i))
    const { error } = await supabase.from('ingredients').update({ keep: next }).eq('id', ing.id)
    if (error) setIngredients(prev => prev.map(i => i.id === ing.id ? { ...i, keep: ing.keep } : i))
  }

  async function startShop() {
    const chosen = Object.entries(picked).filter(([, q]) => q > 0)
    if (chosen.length === 0) { setMsg('Add a quantity to something first'); return }
    setBusy(true); setMsg('')

    const { data: list, error } = await supabase
      .from('shopping_lists')
      .insert({
        house_id: house.id,
        store_id: storeId ? +storeId : null,
        status: 'shopping',
        purchased_on: shopDate || today(),
        source: 'manual',
      })
      .select('*, stores(name)').single()
    if (error) { setMsg(error.message); setBusy(false); return }

    const rows = chosen.map(([ingredientId, qty]) => ({
      house_id: house.id,
      list_id: list.id,
      ingredient_id: +ingredientId,
      quantity: qty,
      auto_generated: false,
      bought: false,
      source: 'manual',
    }))
    const { error: e2 } = await supabase.from('shopping_list_items').insert(rows)
    if (e2) { setMsg(e2.message); setBusy(false); return }

    setPicked({}); setBusy(false)
    await load()
    setView('shop')
  }

  // ── ② Shop ──────────────────────────────────────────────────────────────────
  async function markBought(item, price, qty, unit) {
    try {
      const row = await recordPurchase({
        houseId: house.id,
        listId: activeList.id,
        ingredientId: item.ingredient_id,
        itemId: item.id,
        quantity: qty,
        price,
        unitSizeUnit: unit,
        storeId: activeList.store_id,
        source: 'manual',
      })
      setItems(prev => prev.map(i => i.id === row.id ? row : i))
      markStocked(item.ingredient_id)
    } catch (e) { setMsg(e.message) }
  }

  async function undoBought(item) {
    try {
      const row = await undoPurchase(item)
      setItems(prev => prev.map(i => i.id === row.id ? row : i))
    } catch (e) { setMsg(e.message) }
  }

  async function removeItem(item) {
    await supabase.from('shopping_list_items').delete().eq('id', item.id)
    setItems(prev => prev.filter(i => i.id !== item.id))
  }

  // Adding to a shop in progress uses the very same browser as Build. Setting a
  // quantity writes an unbought line straight onto the live list.
  const liveQuantities = Object.fromEntries(items.filter(i => !i.bought).map(i => [i.ingredient_id, i.quantity]))

  async function setLiveQty(ingredientId, qty) {
    const existing = items.find(i => i.ingredient_id === ingredientId && !i.bought)
    if (qty <= 0) {
      if (existing) await removeItem(existing)
      return
    }
    if (existing) {
      const { data } = await supabase.from('shopping_list_items')
        .update({ quantity: qty }).eq('id', existing.id)
        .select('*, ingredients(name), meals(name)').single()
      if (data) setItems(prev => prev.map(i => i.id === data.id ? data : i))
      return
    }
    const { data, error } = await supabase.from('shopping_list_items')
      .insert({
        house_id: house.id, list_id: activeList.id, ingredient_id: ingredientId,
        quantity: qty, auto_generated: false, bought: false, source: 'manual',
      })
      .select('*, ingredients(name), meals(name)').single()
    if (error) { setMsg(error.message); return }
    setItems(prev => [...prev, data])
  }

  // Receipt lines land as purchases on this list — same rows as ticking by hand.
  function onReceiptPurchases(rows) {
    setItems(prev => {
      const byId = new Map(prev.map(i => [i.id, i]))
      for (const r of rows) byId.set(r.id, r)
      return [...byId.values()]
    })
    for (const r of rows) markStocked(r.ingredient_id)
  }

  async function finishShop() {
    const raw = items.filter(i => i.bought).reduce((t, i) => t + (i.price_paid ? i.price_paid * i.quantity : 0), 0)
    const total = Math.round(raw * 100) / 100
    await supabase.from('shopping_lists')
      .update({ status: 'done', completed_at: new Date().toISOString(), total_paid: total })
      .eq('id', activeList.id)
    setActiveList(null); setItems([]); setShowReceipt(false); setReceiptOpened(false); setShowAddMore(false)
    setView('history')
    await load()
    await loadHistory()
  }

  async function cancelShop() {
    if (!activeList) return
    await supabase.from('shopping_lists').delete().eq('id', activeList.id) // cascades items
    setActiveList(null); setItems([]); setShowReceipt(false); setReceiptOpened(false); setShowAddMore(false)
    setView('build')
    await load()
  }

  // ── render ──────────────────────────────────────────────────────────────────
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

    const chosen = Object.entries(picked).filter(([, q]) => q > 0)
    const est = chosen.reduce((t, [id, q]) => { const p = priceOf(+id); return p != null ? t + p * q : t }, 0)
    const anyPriced = chosen.some(([id]) => priceOf(+id) != null)

    return (
      <>
        <div className="section-title"><h2>Make a shopping list</h2></div>
        <p className="muted-note">
          Your whole larder, grouped. What you're out of comes first; what you already have is dimmed
          but still there. Set a quantity on anything you want — that's what puts it on the list.
        </p>

        <div className="field-row">
          <label>Shop
            <select value={storeId} onChange={e => setStoreId(e.target.value)}>
              <option value="">Any shop</option>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label style={{ maxWidth: 170 }}>Date
            <input type="date" value={shopDate} onChange={e => setShopDate(e.target.value)} />
          </label>
        </div>

        {periods.length > 0 && (
          <PlanPreset periods={periods} components={planComponents} ingredients={ingredients} onFill={fillFromPlan} />
        )}

        <IngredientBrowser
          houseId={house.id}
          ingredients={ingredients}
          categories={categories}
          priceOf={priceOf}
          mode="pick"
          quantities={picked}
          onQtyChange={setQty}
          onToggleKeep={toggleKeep}
          onSelect={setSelected}
          onCreated={ing => setIngredients(prev =>
            prev.some(i => i.id === ing.id) ? prev : [...prev, ing].sort((a, b) => a.name.localeCompare(b.name))
          )}
          keptOnlyDefault
        />

        {anyPriced && (
          <p className="muted-note" style={{ marginTop: '.6rem' }}>
            Estimated at {storeId ? stores.find(s => String(s.id) === storeId)?.name : 'the cheapest shop'}: <strong>£{est.toFixed(2)}</strong>
            {' '}(items without a recorded price aren't counted)
          </p>
        )}

        {msg && <p className="msg err">{msg}</p>}
        <div className="shop-sticky-action">
          <button className="btn" onClick={startShop} disabled={busy || chosen.length === 0}>
            {busy ? <span className="spinner" /> : `Start shop → (${chosen.length})`}
          </button>
        </div>
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
          Tap <strong>Bought</strong> as it goes in the trolley — what you paid is logged against
          {activeList.stores?.name ? ` ${activeList.stores.name}` : ' the shop'} and it drops back into your Larder.
          Or scan the receipt at the end and let it fill the whole shop in.
        </p>

        <div className="btn-row" style={{ marginBottom: '.6rem' }}>
          <button
            className={`btn small ${showReceipt ? '' : 'secondary'}`}
            onClick={() => { setReceiptOpened(true); setShowReceipt(v => !v) }}
          >
            🧾 {showReceipt ? 'Hide receipt' : 'Fill from receipt'}
          </button>
          <button className={`btn small ${showAddMore ? '' : 'secondary'}`} onClick={() => setShowAddMore(v => !v)}>
            {showAddMore ? 'Done adding' : '+ Add more items'}
          </button>
        </div>

        {/* Stays mounted once opened: collapsing it must not throw away a scan
            the user has already paid an AI call for. */}
        {receiptOpened && (
          <div className="receipt-inline" style={showReceipt ? undefined : { display: 'none' }}>
            <Receipts
              mode="attach"
              listId={activeList.id}
              lockedStoreId={activeList.store_id}
              onPurchases={onReceiptPurchases}
            />
          </div>
        )}

        {showAddMore && (
          <div className="receipt-inline">
            <IngredientBrowser
              houseId={house.id}
              ingredients={ingredients}
              categories={categories}
              priceOf={priceOf}
              mode="pick"
              quantities={liveQuantities}
              onQtyChange={setLiveQty}
              onToggleKeep={toggleKeep}
              onSelect={setSelected}
              onCreated={ing => setIngredients(prev =>
                prev.some(i => i.id === ing.id) ? prev : [...prev, ing].sort((a, b) => a.name.localeCompare(b.name))
              )}
              keptOnlyDefault
            />
          </div>
        )}

        {msg && <p className="msg err">{msg}</p>}

        {items.length === 0 && <p className="empty">Nothing on this list yet — add some items above.</p>}
        {items.map(item => (
          <ShopRow key={item.id} item={item} onBought={markBought} onUndo={undoBought} onRemove={removeItem} />
        ))}

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
          const when = h.purchased_on ?? h.completed_at
          const date = when
            ? new Date(when).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
            : ''
          const isOpen = expandedHist === h.id
          const hItems = histItems[h.id]
          const stated = h.receipt_total != null ? Number(h.receipt_total) : null
          const ours = Number(h.total_paid ?? 0)
          const mismatch = stated != null && Math.abs(stated - ours) >= 0.01

          return (
            <div key={h.id}>
              <div className="card card--clickable" onClick={() => toggleHistExpand(h.id)}>
                <span className="name">{h.stores?.name ?? 'Mixed'}</span>
                <span className="meta">{date} · {count} item{count === 1 ? '' : 's'}</span>
                {h.source === 'receipt' && <span className="pill gray" style={{ fontSize: '.7rem' }}>🧾 receipt</span>}
                <span className="pill green">£{ours.toFixed(2)}</span>
                <span className="meta">{isOpen ? '▲' : '▼'}</span>
              </div>
              {isOpen && (
                <div className="hist-detail">
                  {mismatch && (
                    <p className="muted-note">
                      Receipt said £{stated.toFixed(2)} — £{Math.abs(stated - ours).toFixed(2)}{' '}
                      {stated > ours ? 'more than' : 'less than'} the items add up to.
                    </p>
                  )}
                  {hItems === undefined && <p className="empty">Loading…</p>}
                  {hItems?.length === 0 && <p className="empty">No items recorded.</p>}
                  {hItems?.map(item => (
                    <div key={item.id} className="card" style={{ opacity: item.bought ? 1 : .6 }}>
                      <span className="name">{itemName(item)}</span>
                      {item.meals?.name && <span className="pill blue" style={{ fontSize: '.7rem' }}>🍲 {item.meals.name}</span>}
                      <span className="meta">×{item.quantity}{item.unit_size_unit ? ` · ${item.unit_size_unit}` : ''}</span>
                      {!item.bought && <span className="pill gray" style={{ fontSize: '.7rem' }}>not bought</span>}
                      {item.bought && item.price_paid != null && (
                        <span className="meta">£{Number(item.price_paid).toFixed(2)} each · £{(item.price_paid * item.quantity).toFixed(2)}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
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

      {selected && (
        <IngredientPanel
          ing={selected}
          houseId={house.id}
          categories={categories}
          onClose={() => setSelected(null)}
          onUpdated={updated => {
            setIngredients(prev => prev.map(i => i.id === updated.id ? { ...i, ...updated } : i))
            setSelected(updated)
          }}
          onCategoriesChanged={cat => setCategories(prev => prev.some(c => c.id === cat.id) ? prev : [...prev, cat].sort((a, b) => a.name.localeCompare(b.name)))}
          onCategoryDeleted={cat => {
            setCategories(prev => prev.filter(c => c.id !== cat.id))
            setIngredients(prev => prev.map(i => ({ ...i, categoryIds: (i.categoryIds ?? []).filter(x => x !== cat.id) })))
          }}
        />
      )}
    </>
  )
}
