import { useState, useMemo, useEffect } from 'react'
import { groupByCategory, findOrCreateIngredient } from '../lib/larder.js'

// ── Ways to look at the larder ───────────────────────────────────────────────
// Declared as data so the toolbar and the logic can't drift apart, and so
// adding a view is one entry rather than three edits.

const GROUPINGS = [
  { key: 'category', label: 'Categories' },
  { key: 'status',   label: 'In stock / missing' },
  { key: 'none',     label: 'One flat list' },
]

const SORTS = {
  name:   { label: 'A–Z',            cmp: (a, b) => a.name.localeCompare(b.name) },
  stock:  { label: 'Least in stock', cmp: (a, b) => stockRank(a) - stockRank(b) || a.name.localeCompare(b.name) },
  stale:  { label: 'Longest ago',    cmp: null },   // needs lastBought; applied below
}

/** Out of it first, then the smallest quantity, then anything uncounted. */
function stockRank(i) {
  if (!i.has_any) return -1
  return i.stock_qty == null ? Number.MAX_SAFE_INTEGER : Number(i.stock_qty)
}

const FILTERS = {
  all:        { label: 'Everything',   test: () => true },
  missing:    { label: 'Missing',      test: i => !i.has_any },
  instock:    { label: 'In stock',     test: i => !!i.has_any },
  uncounted:  { label: 'Uncounted',    test: i => i.has_any && i.stock_qty == null,
                hint: "In stock, but nobody has said how much" },
  // The three things that make an ingredient useless to the planner. This is
  // the same set the deck complains about, reachable from the place you'd fix
  // it rather than only from the rail.
  needswork:  { label: 'Needs setting up',
                test: i => i.card_weight == null || i.kcal_per_100 == null || (i.categoryIds ?? []).length === 0,
                hint: 'No card weight, no nutrition, or not filed in a category' },
}

/** Whole months since a date, or null if it was never bought. */
function monthsSince(iso) {
  if (!iso) return null
  const then = new Date(iso)
  if (isNaN(then)) return null
  return (Date.now() - then.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
}

/** Stock reads as a shelf quantity, not a measurement: 1.2kg, not 1200g. */
function formatStock(qty) {
  const n = Number(qty)
  if (!isFinite(n)) return ''
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`
  return String(Math.round(n * 10) / 10)
}

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

/**
 * How much is on the shelf, edited in place.
 *
 * Nothing decrements this automatically — the app doesn't watch you eat — so
 * correcting it here is not an edge case, it's the main way the number stays
 * true. That makes it worth being an always-live field on the card rather than
 * something buried two taps deep in a panel.
 *
 * Writes are deferred until you stop typing, so a three-digit quantity is one
 * save rather than three.
 */
function StockField({ ing, onStockChange }) {
  const [qty, setQty] = useState(ing.stock_qty ?? '')
  const [unit, setUnit] = useState(ing.stock_unit ?? '')
  const [dirty, setDirty] = useState(false)

  // Follow the row when it changes underneath us — a purchase, or a reload —
  // but never clobber what's being typed.
  useEffect(() => {
    if (dirty) return
    setQty(ing.stock_qty ?? '')
    setUnit(ing.stock_unit ?? '')
  }, [ing.stock_qty, ing.stock_unit, dirty])

  useEffect(() => {
    if (!dirty) return
    const t = setTimeout(async () => {
      await onStockChange(ing, qty, unit)
      setDirty(false)
    }, 600)
    return () => clearTimeout(t)
  }, [qty, unit, dirty])

  const edit = fn => (e) => { setDirty(true); fn(e.target.value) }

  return (
    <span className="stock-field" title="How much is in the house. Buying adds to this; nothing takes it away, so correct it here.">
      <input
        type="number" min="0" step="any" inputMode="decimal"
        className="stock-qty" placeholder="—"
        value={qty} onChange={edit(setQty)}
        aria-label={`How much ${ing.name} is in the house`}
      />
      <input
        className="stock-unit" placeholder="g"
        value={unit} onChange={edit(setUnit)}
        aria-label={`Unit for ${ing.name}`}
      />
      {dirty && <span className="stock-saving" aria-hidden>·</span>}
    </span>
  )
}

export function IngredientCard({ ing, price, mode, qty = 0, lastBought, onQtyChange, onToggleStock, onToggleKeep, onSelect, onStockChange }) {
  const picked = mode === 'pick' && qty > 0
  const lineTotal = price != null ? price * (qty || 1) : null
  // Something the house thinks it has but hasn't replaced in months is the
  // forgotten jar at the back — worth saying out loud, gently.
  const staleMonths = ing.has_any ? monthsSince(lastBought) : null

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

      {mode === 'browse' && onStockChange ? (
        <span className="ing-card-stock" onClick={e => e.stopPropagation()}>
          <StockField ing={ing} onStockChange={onStockChange} />
        </span>
      ) : (
        <span className={`pill ${ing.has_any ? 'green' : 'red'}`}>
          {ing.has_any
            ? (ing.stock_qty != null ? `${formatStock(ing.stock_qty)}${ing.stock_unit ?? ''}` : 'In stock')
            : 'Missing'}
        </span>
      )}

      {staleMonths != null && staleMonths >= 3 && (
        <span className="pill amber" title={`Last bought ${new Date(lastBought).toLocaleDateString('en-GB')}`}>
          {Math.floor(staleMonths)}m ago
        </span>
      )}

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
  onStockChange,           // (ing, qty, unit) => Promise — browse mode only
  lastBought = {},         // ingredientId → ISO date of the most recent purchase
  keptOnlyDefault = false,
  newIngredientKeep = true,
}) {
  const [search, setSearch] = useState('')
  const [keptOnly, setKeptOnly] = useState(keptOnlyDefault)
  const [grouping, setGrouping] = useState('category')
  const [sort, setSort] = useState('name')
  const [filter, setFilter] = useState('all')
  const [collapsed, setCollapsed] = useState({})
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState('')

  const q = search.trim().toLowerCase()

  const visible = useMemo(() => ingredients.filter(i => {
    if (keptOnly && !(i.keep ?? true) && !(quantities[i.id] > 0)) return false
    if (q && !i.name.toLowerCase().includes(q)) return false
    // Something you've already put on the list stays visible whatever the
    // filter says — losing sight of it mid-build would be maddening.
    if (quantities[i.id] > 0) return true
    return (FILTERS[filter] ?? FILTERS.all).test(i)
  }), [ingredients, keptOnly, q, filter, quantities])

  /**
   * Order within a section.
   *
   * Whatever the chosen sort, what the house is *out of* floats to the top:
   * that's the thing you act on, and it's the ordering the shopping-list
   * builder depends on. The sort decides everything below that line.
   */
  const ordered = useMemo(() => {
    const cmp = sort === 'stale'
      ? (a, b) => {
          const am = monthsSince(lastBought[a.id]), bm = monthsSince(lastBought[b.id])
          // Never bought at all is the oldest thing there is.
          if (am == null && bm == null) return a.name.localeCompare(b.name)
          if (am == null) return -1
          if (bm == null) return 1
          return bm - am
        }
      : (SORTS[sort] ?? SORTS.name).cmp
    const missingFirst = (a, b) => (a.has_any ? 1 : 0) - (b.has_any ? 1 : 0)
    return list => [...list].sort((a, b) => missingFirst(a, b) || cmp(a, b))
  }, [sort, lastBought])

  const sections = useMemo(() => {
    if (grouping === 'none') {
      return [{ key: '__all__', name: `All ${visible.length}`, items: ordered(visible) }]
    }
    if (grouping === 'status') {
      const out = [
        { key: '__missing__', name: 'Missing',  items: ordered(visible.filter(i => !i.has_any)) },
        { key: '__have__',    name: 'In stock', items: ordered(visible.filter(i => i.has_any)) },
      ]
      return out.filter(sec => sec.items.length > 0)
    }
    // groupByCategory already sorts missing-first; re-apply the chosen order
    // on top so the section contents follow the toolbar.
    return groupByCategory(visible, categories).map(sec => ({ ...sec, items: ordered(sec.items) }))
  }, [grouping, visible, categories, ordered])

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

  const counts = useMemo(() => ({
    total: ingredients.length,
    showing: visible.length,
    missing: ingredients.filter(i => !i.has_any).length,
    uncounted: ingredients.filter(i => i.has_any && i.stock_qty == null).length,
    stale: ingredients.filter(i => i.has_any && (monthsSince(lastBought[i.id]) ?? 0) >= 3).length,
  }), [ingredients, visible, lastBought])

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

      <div className="larder-toolbar">
        <label className="larder-tool">
          <span className="meta">Group</span>
          <select value={grouping} onChange={e => setGrouping(e.target.value)}>
            {GROUPINGS.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
        </label>

        <label className="larder-tool">
          <span className="meta">Sort</span>
          <select value={sort} onChange={e => setSort(e.target.value)}
                  title="Whatever you pick, things you're out of stay at the top of each group">
            {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>

        <span className="larder-filter-chips">
          {Object.entries(FILTERS).map(([k, v]) => {
            const n = k === 'all' ? ingredients.length : ingredients.filter(v.test).length
            if (k !== 'all' && k !== filter && n === 0) return null   // nothing to show, don't offer it
            return (
              <button key={k} type="button" title={v.hint}
                className={`chip ${filter === k ? 'chip--on' : ''}`}
                onClick={() => setFilter(k)}>
                {v.label} <span className="chip-count">{n}</span>
              </button>
            )
          })}
        </span>
      </div>

      {counts.total > 0 && (
        <p className="larder-summary meta">
          Showing {counts.showing} of {counts.total}
          {counts.missing > 0 && <> · <strong>{counts.missing}</strong> missing</>}
          {counts.uncounted > 0 && <> · {counts.uncounted} in stock but uncounted</>}
          {counts.stale > 0 && <> · {counts.stale} not bought in 3+ months</>}
        </p>
      )}

      {canCreate && (
        <button className="larder-create" onClick={createFromSearch} disabled={creating}>
          {creating ? <span className="spinner" /> : <>+ Add <strong>{search.trim()}</strong> to your larder</>}
        </button>
      )}
      {err && <p className="msg err">{err}</p>}

      {sections.length === 0 && (
        <p className="empty">
          {q ? 'Nothing matches that yet.'
            : filter !== 'all' ? `Nothing is “${FILTERS[filter].label.toLowerCase()}” — good news.`
            : keptOnly ? 'Nothing kept yet — switch to "All items".'
            : 'Your larder is empty.'}
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
                onStockChange={onStockChange}
                lastBought={lastBought[ing.id]}
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
