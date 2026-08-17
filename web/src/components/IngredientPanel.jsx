import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { calcCanonicalRate, formatRate } from '../lib/units.js'
import { findOrCreateCategory, setIngredientCategories } from '../lib/larder.js'
import { NUTRIENTS } from '../lib/planner.js'

// ── Store comparison ──────────────────────────────────────────────────────────
function StoreComparison({ prices }) {
  const [expanded, setExpanded] = useState({}) // storeId → bool

  if (!prices?.length) return null

  // Group all prices by store
  const byStore = {}
  for (const p of prices) {
    const sid = p.store_id ?? '__none__'
    const sname = p.stores?.name ?? '—'
    if (!byStore[sid]) byStore[sid] = { id: sid, name: sname, prices: [] }
    byStore[sid].prices.push(p)
  }

  // For each store: "current" prices = most recent per distinct pack size.
  // best_rate and cheapest are derived from those only.
  const stores = Object.values(byStore).map(store => {
    const currentMap = {}
    for (const p of store.prices) {
      const key = p.unit_size_unit || '__no_unit__'
      if (!currentMap[key] || new Date(p.noted_at) > new Date(currentMap[key].noted_at)) {
        currentMap[key] = p
      }
    }
    const current = Object.values(currentMap)

    const withRate = current.filter(p => p.canonical_rate != null)
    const bestRateEntry = withRate.length
      ? withRate.reduce((a, b) => Number(a.canonical_rate) <= Number(b.canonical_rate) ? a : b)
      : null

    const cheapestEntry = current.length
      ? current.reduce((a, b) => Number(a.price) <= Number(b.price) ? a : b)
      : null

    return {
      ...store,
      current,
      bestRateEntry,
      cheapestEntry,
      bestRate: bestRateEntry ? Number(bestRateEntry.canonical_rate) : Infinity,
      cheapestPrice: cheapestEntry ? Number(cheapestEntry.price) : Infinity,
    }
  })

  const bestRateStore = stores.reduce((a, b) => a.bestRate <= b.bestRate ? a : b)
  const cheapestStore = stores.reduce((a, b) => a.cheapestPrice <= b.cheapestPrice ? a : b)
  const sameStore     = bestRateStore.id === cheapestStore.id

  const sorted = [...stores].sort((a, b) => {
    if (a.bestRate !== b.bestRate) return a.bestRate - b.bestRate
    if (a.cheapestPrice !== b.cheapestPrice) return a.cheapestPrice - b.cheapestPrice
    return a.name.localeCompare(b.name)
  })

  function badges(store) {
    const tags = []
    if (store.id === bestRateStore.id)               tags.push({ label: '🏆 Best rate', cls: 'badge--gold' })
    if (!sameStore && store.id === cheapestStore.id) tags.push({ label: '💰 Cheapest', cls: 'badge--green' })
    return tags
  }

  return (
    <div className="ing-panel-section">
      <div className="ing-panel-label">Store comparison</div>
      {sorted.map(store => {
        const isOpen = expanded[store.id]
        const tags = badges(store)
        const history = [...store.prices].sort((a, b) => new Date(b.noted_at) - new Date(a.noted_at))

        return (
          <div key={store.id} className={`store-cmp-card ${tags.length ? 'store-cmp-card--featured' : ''}`}>
            <button
              className="store-cmp-header"
              onClick={() => setExpanded(prev => ({ ...prev, [store.id]: !prev[store.id] }))}
            >
              <span className="store-cmp-name">{store.name}</span>
              <span className="store-cmp-badges">
                {tags.map(t => <span key={t.label} className={`badge ${t.cls}`}>{t.label}</span>)}
              </span>
              <span className="store-cmp-summary">
                {store.bestRateEntry && (
                  <span className="store-cmp-rate">
                    {formatRate(Number(store.bestRateEntry.canonical_rate), store.bestRateEntry.canonical_rate_unit)}
                    <span className="store-cmp-rate-pack"> ({store.bestRateEntry.unit_size_unit}, £{Number(store.bestRateEntry.price).toFixed(2)})</span>
                  </span>
                )}
                {!store.bestRateEntry && store.cheapestEntry && (
                  <span className="store-cmp-rate">£{Number(store.cheapestEntry.price).toFixed(2)}{store.cheapestEntry.unit_size_unit ? ` / ${store.cheapestEntry.unit_size_unit}` : ''}</span>
                )}
              </span>
              <span className="store-cmp-chevron">{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
              <div className="store-cmp-history">
                {history.map(p => (
                  <div key={p.id} className="ing-panel-price-row">
                    <span className="ing-panel-price-val">£{Number(p.price).toFixed(2)}</span>
                    {p.unit_size_unit && <span className="ing-panel-price-unit">/ {p.unit_size_unit}</span>}
                    {p.canonical_rate != null && (
                      <span className="ing-panel-price-rate">{formatRate(Number(p.canonical_rate), p.canonical_rate_unit)}</span>
                    )}
                    <span className="ing-panel-price-date">{new Date(p.noted_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Category picker ───────────────────────────────────────────────────────────
// Every known category as a toggleable chip, plus a box to name a new one.
// An ingredient can hold as many as make sense — it shows up under each.
export function CategoryPicker({ houseId, categories, selectedIds, onChange, onCategoriesChanged, onCategoryDeleted }) {
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [managing, setManaging] = useState(false)
  const [err, setErr] = useState('')

  function toggle(id) {
    onChange(selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id])
  }

  // Categories are free-form, so a typo would otherwise sit in the chip row for
  // good. Deleting one only unfiles its ingredients — nothing is lost.
  async function remove(cat) {
    const ok = window.confirm(`Delete the “${cat.name}” category? Ingredients in it stay in your larder, just uncategorised.`)
    if (!ok) return
    setBusy(true); setErr('')
    const { error } = await supabase.from('categories').delete().eq('id', cat.id)
    if (error) setErr(error.message)
    else {
      onChange(selectedIds.filter(x => x !== cat.id))
      onCategoryDeleted?.(cat)
    }
    setBusy(false)
  }

  async function addNew() {
    const name = newName.trim()
    if (!name) return
    setBusy(true); setErr('')
    try {
      const cat = await findOrCreateCategory({ houseId, name })
      if (!selectedIds.includes(cat.id)) onChange([...selectedIds, cat.id])
      onCategoriesChanged?.(cat)
      setNewName('')
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <div className="cat-picker">
      <div className="cat-chip-row">
        {categories.length === 0 && (
          <span className="muted-note" style={{ margin: 0 }}>No categories yet — name one below.</span>
        )}
        {categories.map(c => (
          <span key={c.id} className={`cat-chip ${selectedIds.includes(c.id) ? 'cat-chip--on' : ''}`}>
            <button type="button" className="cat-chip-label" onClick={() => toggle(c.id)}>{c.name}</button>
            {managing && (
              <button
                type="button" className="cat-chip-del" title={`Delete ${c.name}`}
                onClick={() => remove(c)} disabled={busy}
              >✕</button>
            )}
          </span>
        ))}
        {categories.length > 0 && (
          <button
            type="button"
            className="cat-chip cat-chip--manage"
            onClick={() => setManaging(v => !v)}
          >{managing ? 'Done' : 'Edit'}</button>
        )}
      </div>
      <div className="cat-add-row">
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addNew() } }}
          placeholder="New category…"
        />
        <button type="button" className="btn small secondary" onClick={addNew} disabled={busy || !newName.trim()}>Add</button>
      </div>
      {err && <p className="msg err" style={{ marginTop: '.3rem' }}>{err}</p>}
    </div>
  )
}

// ── Planner facts ─────────────────────────────────────────────────────────────
/**
 * Card weight, stock detail and nutrients.
 *
 * Nutrients are deliberately left blank rather than zeroed: a blank means "not
 * looked up yet" and is excluded from the analyse view, whereas a zero would
 * quietly drag a day's totals down and look like real data.
 */
function PlannerFacts({ ing, onUpdated }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    setForm({
      card_weight: ing.card_weight ?? '',
      qualitative_note: ing.qualitative_note ?? '',
      stock_qty: ing.stock_qty ?? '',
      stock_unit: ing.stock_unit ?? '',
      ...Object.fromEntries(NUTRIENTS.map(n => [n.per100, ing[n.per100] ?? ''])),
    })
  }, [ing.id])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function save() {
    setSaving(true); setMsg('')
    const patch = {
      card_weight: form.card_weight === '' ? null : Number(form.card_weight),
      qualitative_note: form.qualitative_note.trim() || null,
      stock_qty: form.stock_qty === '' ? null : Number(form.stock_qty),
      stock_unit: form.stock_unit.trim() || null,
      ...Object.fromEntries(NUTRIENTS.map(n => [n.per100, form[n.per100] === '' ? null : Number(form[n.per100])])),
    }
    // Recording a quantity implies we have some; clearing it says nothing either way.
    if (patch.stock_qty > 0) patch.has_any = true
    const { error } = await supabase.from('ingredients').update(patch).eq('id', ing.id)
    if (error) { setMsg('Error: ' + error.message); setSaving(false); return }
    onUpdated({ ...ing, ...patch })
    setMsg('Saved ✓')
    setSaving(false)
    setTimeout(() => setMsg(''), 2000)
  }

  return (
    <div className="ing-panel-section">
      <button className="ing-facts-toggle" onClick={() => setOpen(v => !v)}>
        <span className="ing-panel-label" style={{ margin: 0 }}>Planning &amp; nutrition</span>
        <span className="meta">
          {ing.card_weight ? `1 card = ${ing.card_weight}g` : 'no card weight'}
          {' · '}
          {NUTRIENTS.filter(n => ing[n.per100] != null).length}/{NUTRIENTS.length} nutrients
        </span>
        <span>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <>
          <p className="ing-panel-hint">
            One card is how much of this counts as a single portion in the deck.
            Leave a nutrient blank if you haven't looked it up — blank is treated as
            unknown, not as zero.
          </p>
          <div className="field-row">
            <label>1 card = (g/ml)
              <input type="number" min="1" step="1" value={form.card_weight ?? ''}
                onChange={e => set('card_weight', e.target.value)} placeholder="80" />
            </label>
            <label>In the house
              <input type="number" min="0" step="any" value={form.stock_qty ?? ''}
                onChange={e => set('stock_qty', e.target.value)} placeholder="qty" />
            </label>
            <label style={{ maxWidth: 90 }}>Unit
              <input value={form.stock_unit ?? ''} onChange={e => set('stock_unit', e.target.value)} placeholder="g" />
            </label>
          </div>

          <label>Rough measures <span className="meta">(your own reference when writing recipes)</span>
            <input value={form.qualitative_note ?? ''} onChange={e => set('qualitative_note', e.target.value)}
              placeholder="1 handful ≈ 30g · 1 tin ≈ 400g" />
          </label>

          <div className="nutrient-grid">
            {NUTRIENTS.map(n => (
              <label key={n.key}>{n.label} /100
                <input type="number" min="0" step="any" value={form[n.per100] ?? ''}
                  onChange={e => set(n.per100, e.target.value)} placeholder="—" />
              </label>
            ))}
          </div>

          <button className="btn small" onClick={save} disabled={saving}>
            {saving ? <span className="spinner" /> : 'Save'}
          </button>
          {msg && <p className="msg ok" style={{ marginTop: '.3rem', fontSize: '.78rem' }}>{msg}</p>}
        </>
      )}
    </div>
  )
}

// ── Ingredient detail panel ───────────────────────────────────────────────────
export default function IngredientPanel({ ing, houseId, categories, onClose, onUpdated, onCategoriesChanged, onCategoryDeleted }) {
  const [canonRateUnit, setCanonRateUnit] = useState(ing.canonical_rate_unit || '')
  const [catIds, setCatIds] = useState(ing.categoryIds ?? [])
  const [prices, setPrices] = useState(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  async function fetchPrices() {
    const { data } = await supabase
      .from('ingredient_prices')
      .select('id, store_id, price, unit_size_unit, canonical_rate, canonical_rate_unit, noted_at, stores(name)')
      .eq('ingredient_id', ing.id)
      .order('noted_at', { ascending: false })
    setPrices(data ?? [])
  }

  useEffect(() => {
    setCanonRateUnit(ing.canonical_rate_unit || '')
    setCatIds(ing.categoryIds ?? [])
    fetchPrices()
  }, [ing.id])

  // Categories save as you tick them — no separate save button to forget.
  async function updateCategories(next) {
    setCatIds(next)
    try {
      await setIngredientCategories(ing.id, next)
      onUpdated({ ...ing, categoryIds: next })
    } catch (e) { setMsg('Error: ' + e.message) }
  }

  async function saveCanonRateUnit() {
    if (!canonRateUnit.trim()) return
    setSaving(true); setMsg('')
    const unit = canonRateUnit.trim()

    const { error: ingErr } = await supabase
      .from('ingredients').update({ canonical_rate_unit: unit }).eq('id', ing.id)
    if (ingErr) { setMsg('Error: ' + ingErr.message); setSaving(false); return }

    if (prices?.length) {
      for (const p of prices) {
        if (!p.unit_size_unit) continue
        const rate = calcCanonicalRate(Number(p.price), p.unit_size_unit, unit)
        if (rate == null) continue
        await supabase.from('ingredient_prices')
          .update({ canonical_rate: rate, canonical_rate_unit: unit }).eq('id', p.id)
      }
    }

    setMsg('Saved and rates recalculated ✓')
    onUpdated({ ...ing, canonical_rate_unit: unit, categoryIds: catIds })
    await fetchPrices()
    setSaving(false)
  }

  return (
    <div className="ing-panel-backdrop" onClick={onClose}>
      <div className="ing-panel" onClick={e => e.stopPropagation()}>
        <div className="ing-panel-header">
          <h3 style={{ margin: 0 }}>{ing.name}</h3>
          <button className="btn ghost small" onClick={onClose}>✕</button>
        </div>

        {/* Categories */}
        <div className="ing-panel-section">
          <div className="ing-panel-label">Categories</div>
          <p className="ing-panel-hint">
            Where this shows up when browsing. It can sit in several at once.
          </p>
          <CategoryPicker
            houseId={houseId}
            categories={categories}
            selectedIds={catIds}
            onChange={updateCategories}
            onCategoriesChanged={onCategoriesChanged}
            onCategoryDeleted={onCategoryDeleted}
          />
        </div>

        {/* What the planner needs to know */}
        <PlannerFacts ing={ing} onUpdated={onUpdated} />

        {/* Canonical rate unit editor */}
        <div className="ing-panel-section">
          <div className="ing-panel-label">Canonical rate unit</div>
          <p className="ing-panel-hint">
            Unit used to compare prices across pack sizes (e.g. "g", "100g", "ml", "unit").
            Saving recalculates all stored rates for this ingredient.
          </p>
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
            <input
              style={{ flex: 1, margin: 0 }}
              value={canonRateUnit}
              onChange={e => setCanonRateUnit(e.target.value)}
              placeholder="e.g. g, 100g, ml, unit"
            />
            <button className="btn small" onClick={saveCanonRateUnit} disabled={saving || !canonRateUnit.trim()}>
              {saving ? <span className="spinner" /> : 'Save'}
            </button>
          </div>
          {msg && <p className="msg ok" style={{ marginTop: '.3rem', fontSize: '.78rem' }}>{msg}</p>}
        </div>

        {/* Store comparison */}
        {prices === null && (
          <div className="ing-panel-section"><p className="empty">Loading…</p></div>
        )}
        {prices?.length === 0 && (
          <div className="ing-panel-section"><p className="empty">No prices recorded yet.</p></div>
        )}
        {prices?.length > 0 && <StoreComparison prices={prices} />}
      </div>
    </div>
  )
}
