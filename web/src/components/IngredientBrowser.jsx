import { useState, useMemo } from 'react'
import { groupByCategory, findOrCreateIngredient } from '../lib/larder.js'

/**
 * IngredientBrowser — one way to scroll the larder.
 *
 * The Larder tab and the shopping-list builder render this same component, so
 * browsing what the house has and choosing what to buy feel like the same act.
 * The cards are identical; the only difference is the control on the right —
 * a stock toggle when browsing, a quantity stepper when building a list.
 *
 * Things the house is out of sit at the top of each category and stay bright;
 * what's already in stock fades back but remains pickable, because "we have
 * some, but get more" is a normal thing to want.
 *
 * mode: 'browse' (Larder) | 'pick' (build a list)
 */

function QtyStepper({ qty, onChange }) {
  if (!qty) {
    return (
      <button type="button" className="qty-add" onClick={() => onChange(1)} aria-label="Add to list">+</button>
    )
  }
  return (
    <span className="qty-step">
      <button type="button" onClick={() => onChange(qty - 1)} aria-label="Fewer">−</button>
      <span>{qty}</span>
      <button type="button" onClick={() => onChange(qty + 1)} aria-label="More">+</button>
    </span>
  )
}

export function IngredientCard({ ing, price, mode, qty = 0, onQtyChange, onToggleStock, onToggleKeep, onSelect }) {
  const picked = mode === 'pick' && qty > 0
  const lineTotal = price != null ? price * (qty || 1) : null

  return (
    <div
      className={`card card--clickable ing-card ${ing.has_any ? 'ing-card--stocked' : 'ing-card--wanted'} ${picked ? 'ing-card--picked' : ''}`}
      onClick={() => onSelect?.(ing)}
    >
      <span className="name">{ing.name}</span>

      {price != null && (
        <span className="meta ing-card-price">
          £{lineTotal.toFixed(2)}
          {qty > 1 && <span className="ing-card-each"> ({qty} × £{price.toFixed(2)})</span>}
        </span>
      )}

      <span className={`pill ${ing.has_any ? 'green' : 'red'}`}>
        {ing.has_any ? 'In stock' : 'Missing'}
      </span>

      <button
        className={`pill ${(ing.keep ?? true) ? 'blue' : 'gray'}`}
        style={{ border: 'none', cursor: 'pointer', fontSize: '.7rem' }}
        title="Whether this is something you generally keep stocked"
        onClick={e => { e.stopPropagation(); onToggleKeep?.(ing) }}
      >
        {(ing.keep ?? true) ? '★ Kept' : 'Not kept'}
      </button>

      <div className="ing-card-control" onClick={e => e.stopPropagation()}>
        {mode === 'pick' ? (
          <QtyStepper qty={qty} onChange={q => onQtyChange(ing.id, Math.max(0, q))} />
        ) : (
          <label className="toggle" title="In stock">
            <input type="checkbox" checked={!!ing.has_any} onChange={() => onToggleStock?.(ing)} />
            <span className="toggle-slider" />
          </label>
        )}
      </div>
    </div>
  )
}

export default function IngredientBrowser({
  houseId,
  ingredients,
  categories,
  priceOf,                 // (ingredientId) => number | null
  mode = 'browse',
  quantities = {},
  onQtyChange,
  onToggleStock,
  onToggleKeep,
  onSelect,
  onCreated,               // (ingredient) => void — a new row was created
  keptOnlyDefault = false,
  newIngredientKeep = true,
}) {
  const [search, setSearch] = useState('')
  const [keptOnly, setKeptOnly] = useState(keptOnlyDefault)
  const [collapsed, setCollapsed] = useState({})
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState('')

  const q = search.trim().toLowerCase()

  const visible = useMemo(() => ingredients.filter(i => {
    if (keptOnly && !(i.keep ?? true) && !(quantities[i.id] > 0)) return false
    if (q && !i.name.toLowerCase().includes(q)) return false
    return true
  }), [ingredients, keptOnly, q, quantities])

  const sections = useMemo(() => groupByCategory(visible, categories), [visible, categories])

  // Nothing in the larder matches what you typed — offer to make it real.
  const exactExists = ingredients.some(i => i.name.trim().toLowerCase() === q)
  const canCreate = q.length > 0 && !exactExists

  async function createFromSearch() {
    setCreating(true); setErr('')
    try {
      const ing = await findOrCreateIngredient({ houseId, name: search.trim(), keep: newIngredientKeep })
      onCreated?.(ing)
      // In list-building, a thing you just went looking for is a thing you want.
      if (mode === 'pick') onQtyChange?.(ing.id, Math.max(1, quantities[ing.id] ?? 0))
      setSearch('')
    } catch (e) { setErr(e.message) }
    setCreating(false)
  }

  const hiddenByKeep = keptOnly
    ? ingredients.filter(i => !(i.keep ?? true) && !(quantities[i.id] > 0)).length
    : 0

  return (
    <div className="larder-browser">
      <div className="larder-search-row">
        <input
          type="search"
          className="larder-search"
          placeholder="Search the larder…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && canCreate) { e.preventDefault(); createFromSearch() } }}
        />
        <button
          type="button"
          className={`btn small ${keptOnly ? '' : 'secondary'}`}
          title="Only show things you generally keep stocked"
          onClick={() => setKeptOnly(v => !v)}
        >{keptOnly ? '★ Kept only' : 'All items'}</button>
      </div>

      {canCreate && (
        <button className="larder-create" onClick={createFromSearch} disabled={creating}>
          {creating ? <span className="spinner" /> : <>+ Add <strong>{search.trim()}</strong> to your larder</>}
        </button>
      )}
      {err && <p className="msg err">{err}</p>}

      {sections.length === 0 && (
        <p className="empty">
          {q ? 'Nothing matches that yet.' : keptOnly ? 'Nothing kept yet — switch to "All items".' : 'Your larder is empty.'}
        </p>
      )}

      {sections.map(sec => {
        const isCollapsed = collapsed[sec.key]
        const missing = sec.items.filter(i => !i.has_any).length
        const pickedHere = mode === 'pick'
          ? sec.items.filter(i => quantities[i.id] > 0).length
          : 0
        return (
          <section key={sec.key} className="larder-section">
            <button
              className="larder-section-header"
              onClick={() => setCollapsed(c => ({ ...c, [sec.key]: !c[sec.key] }))}
            >
              <span className="larder-section-name">{sec.name}</span>
              <span className="larder-section-meta">
                {pickedHere > 0 && <span className="pill blue">{pickedHere} on list</span>}
                {missing > 0 && <span className="pill red">{missing} missing</span>}
                <span className="meta">{sec.items.length}</span>
              </span>
              <span className="larder-section-chevron">{isCollapsed ? '▼' : '▲'}</span>
            </button>

            {!isCollapsed && sec.items.map(ing => (
              <IngredientCard
                key={`${sec.key}-${ing.id}`}
                ing={ing}
                price={priceOf?.(ing.id) ?? null}
                mode={mode}
                qty={quantities[ing.id] ?? 0}
                onQtyChange={onQtyChange}
                onToggleStock={onToggleStock}
                onToggleKeep={onToggleKeep}
                onSelect={onSelect}
              />
            ))}
          </section>
        )
      })}

      {hiddenByKeep > 0 && (
        <p className="muted-note larder-hidden-note">
          {hiddenByKeep} item{hiddenByKeep === 1 ? '' : 's'} hidden — tap “★ Kept only” to see everything.
        </p>
      )}
    </div>
  )
}
