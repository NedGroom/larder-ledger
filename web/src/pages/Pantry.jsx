import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import { useApp } from '../App.jsx'
import { calcCanonicalRate, formatRate } from '../lib/units.js'

// ── Store comparison section ──────────────────────────────────────────────────
function StoreComparison({ prices, canonRateUnit }) {
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

  // For each store: find "current" prices = most recent per distinct unit_size_unit
  // Then derive best_rate and cheapest from those current prices only
  const stores = Object.values(byStore).map(store => {
    // Most recent entry per pack size
    const currentMap = {}
    for (const p of store.prices) {
      const key = p.unit_size_unit || '__no_unit__'
      if (!currentMap[key] || new Date(p.noted_at) > new Date(currentMap[key].noted_at)) {
        currentMap[key] = p
      }
    }
    const current = Object.values(currentMap)

    // Best canonical rate (lowest = cheapest per unit)
    const withRate = current.filter(p => p.canonical_rate != null)
    const bestRateEntry = withRate.length
      ? withRate.reduce((a, b) => Number(a.canonical_rate) <= Number(b.canonical_rate) ? a : b)
      : null

    // Cheapest absolute price
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

  // Find overall winners
  const bestRateStore   = stores.reduce((a, b) => a.bestRate   <= b.bestRate   ? a : b)
  const cheapestStore   = stores.reduce((a, b) => a.cheapestPrice <= b.cheapestPrice ? a : b)
  const sameStore       = bestRateStore.id === cheapestStore.id

  // Sort all stores by best canonical rate ascending (Infinity last), ties broken by cheapest price, then name
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
        // Sort all history for this store newest first
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

// ── Ingredient detail panel ───────────────────────────────────────────────────
function IngredientPanel({ ing, onClose, onUpdated }) {
  const [canonRateUnit, setCanonRateUnit] = useState(ing.canonical_rate_unit || '')
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

  useEffect(() => { fetchPrices() }, [ing.id])

  async function saveCanonRateUnit() {
    if (!canonRateUnit.trim()) return
    setSaving(true); setMsg('')
    const unit = canonRateUnit.trim()

    const { error: ingErr } = await supabase
      .from('ingredients')
      .update({ canonical_rate_unit: unit })
      .eq('id', ing.id)
    if (ingErr) { setMsg('Error: ' + ingErr.message); setSaving(false); return }

    if (prices?.length) {
      for (const p of prices) {
        if (!p.unit_size_unit) continue
        const rate = calcCanonicalRate(Number(p.price), p.unit_size_unit, unit)
        if (rate == null) continue
        await supabase
          .from('ingredient_prices')
          .update({ canonical_rate: rate, canonical_rate_unit: unit })
          .eq('id', p.id)
      }
    }

    setMsg('Saved and rates recalculated ✓')
    onUpdated({ ...ing, canonical_rate_unit: unit })
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

        {/* Canonical rate unit editor */}
        <div className="ing-panel-section">
          <div className="ing-panel-label">Canonical rate unit</div>
          <p style={{ fontSize: '.77rem', color: 'var(--color-text-muted)', margin: '0 0 .4rem' }}>
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
        {prices?.length > 0 && (
          <StoreComparison prices={prices} canonRateUnit={canonRateUnit} />
        )}
      </div>
    </div>
  )
}

export default function Pantry() {
  const { house } = useApp()
  const [ingredients, setIngredients] = useState([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('')
  const [canonicalQty, setCanonicalQty] = useState('')
  const [hasAny, setHasAny] = useState(false)
  const [msg, setMsg] = useState({ text: '', ok: true })
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)   // ingredient panel

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('ingredients')
      .select('*')
      .eq('house_id', house.id)
      .order('name')
    setIngredients(data ?? [])
    setLoading(false)
  }, [house.id])

  useEffect(() => { load() }, [load])

  async function addIngredient(e) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    const { error } = await supabase.from('ingredients').insert({
      house_id: house.id,
      name: name.trim(),
      name_normalized: name.trim().toLowerCase(),
      canonical_unit: unit.trim() || null,
      canonical_quantity: canonicalQty ? +canonicalQty : null,
      has_any: hasAny,
    })
    if (error) {
      setMsg({ text: error.message, ok: false })
    } else {
      setMsg({ text: `"${name.trim()}" added`, ok: true })
      setName(''); setUnit(''); setCanonicalQty(''); setHasAny(false)
      await load()
    }
    setSaving(false)
  }

  async function toggleHasAny(ing) {
    const { error } = await supabase
      .from('ingredients')
      .update({ has_any: !ing.has_any })
      .eq('id', ing.id)
    if (!error) {
      setIngredients(prev => prev.map(i => i.id === ing.id ? { ...i, has_any: !ing.has_any } : i))
    }
  }

  const filtered = ingredients.filter(i =>
    i.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <>
      <div className="section-title">
        <h2>Add ingredient</h2>
      </div>
      <form onSubmit={addIngredient}>
        <div className="field-row">
          <label>
            Name
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Pasta" required />
          </label>
          <label style={{ maxWidth: 110 }}>
            Unit
            <input value={unit} onChange={e => setUnit(e.target.value)} placeholder="g / ml / unit" />
          </label>
          <label style={{ maxWidth: 90 }}>
            Per qty
            <input type="number" min="0" step="any" value={canonicalQty} onChange={e => setCanonicalQty(e.target.value)} placeholder="100" />
          </label>
        </div>
        <div className="toggle-wrap" style={{ marginTop: '.5rem' }}>
          <label className="toggle">
            <input type="checkbox" checked={hasAny} onChange={e => setHasAny(e.target.checked)} />
            <span className="toggle-slider" />
          </label>
          <span>In stock</span>
        </div>
        <button className="btn" type="submit" disabled={saving}>
          {saving ? <span className="spinner" /> : '+ Add'}
        </button>
        {msg.text && <p className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</p>}
      </form>

      <hr className="divider" />

      <div className="section-title">
        <h2>Pantry ({ingredients.length})</h2>
      </div>
      <input
        type="search" placeholder="Search…" value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ marginBottom: '.5rem' }}
      />
      {loading && <p className="empty">Loading…</p>}
      {!loading && filtered.length === 0 && <p className="empty">No ingredients yet.</p>}
      {filtered.map(ing => (
        <div key={ing.id} className="card card--clickable" onClick={() => setSelected(ing)}>
          <span className="name">{ing.name}</span>
          {ing.canonical_rate_unit && (
            <span className="meta">per {ing.canonical_rate_unit}</span>
          )}
          <span className={`pill ${ing.has_any ? 'green' : 'red'}`}>
            {ing.has_any ? 'In stock' : 'Missing'}
          </span>
          <div className="toggle-wrap" style={{ margin: 0 }} onClick={e => e.stopPropagation()}>
            <label className="toggle">
              <input
                type="checkbox"
                checked={ing.has_any}
                onChange={() => toggleHasAny(ing)}
              />
              <span className="toggle-slider" />
            </label>
          </div>
        </div>
      ))}

      {selected && (
        <IngredientPanel
          ing={selected}
          onClose={() => setSelected(null)}
          onUpdated={updated => {
            setIngredients(prev => prev.map(i => i.id === updated.id ? updated : i))
            setSelected(updated)
          }}
        />
      )}
    </>
  )
}

