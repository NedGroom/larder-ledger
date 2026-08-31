import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { calcCanonicalRate, formatRate } from '../lib/units.js'
import {
  findOrCreateCategory, setIngredientCategories, renameIngredient, ingredientUsage,
  setIngredientArchived, deleteIngredient, deletePrice, mergeIngredients,
  loadIngredientUnits, addIngredientUnit, deleteIngredientUnit,
} from '../lib/larder.js'
import { NUTRIENTS } from '../lib/planner.js'
import { extractNutrition, storedAiConfig, PROVIDERS } from '../lib/ai.js'
import { checkNutrition, nutritionPatch } from '../lib/nutrition.js'

// ── Price comparison ──────────────────────────────────────────────────────────
/**
 * Every product you've bought under this ingredient, cheapest per unit first.
 *
 * "Current" means the most recent price for each distinct product — a different
 * label, pack size or shop is a different product, so 6 large eggs and 12
 * medium sit side by side and can be compared honestly, rather than one hiding
 * the other behind an average.
 */
function PriceComparison({ prices, onRelabel, onDelete }) {
  const [showHistory, setShowHistory] = useState(false)
  const [editing, setEditing] = useState(null)   // price id being relabelled
  const [draft, setDraft] = useState('')

  if (!prices?.length) return null

  const key = p => `${p.store_id ?? '_'}|${(p.label ?? '').toLowerCase()}|${p.unit_size_unit ?? ''}`

  const currentMap = {}
  for (const p of prices) {
    const k = key(p)
    if (!currentMap[k] || new Date(p.noted_at) > new Date(currentMap[k].noted_at)) currentMap[k] = p
  }

  // Cheapest per unit first; anything with no comparable rate sinks to the
  // bottom rather than pretending to be free.
  const current = Object.values(currentMap).sort((a, b) => {
    const ra = a.canonical_rate != null ? Number(a.canonical_rate) : Infinity
    const rb = b.canonical_rate != null ? Number(b.canonical_rate) : Infinity
    if (ra !== rb) return ra - rb
    return Number(a.price) - Number(b.price)
  })

  const best = current.find(p => p.canonical_rate != null)
  const history = [...prices].sort((a, b) => new Date(b.noted_at) - new Date(a.noted_at))

  async function saveLabel(p) {
    await onRelabel(p, draft)
    setEditing(null)
  }

  // A price is a fact about one shop on one day. A mistyped one skews the
  // comparison for good, so any single row can be dropped without touching the
  // ingredient or the purchase it came from.
  function remove(p) {
    const what = [p.label, p.stores?.name, `£${Number(p.price).toFixed(2)}`].filter(Boolean).join(' · ')
    if (!window.confirm(`Delete this price? (${what})`)) return
    onDelete(p)
  }

  return (
    <div className="ing-panel-section">
      <div className="ing-panel-label">Prices — cheapest per unit first</div>
      {!best && (
        <p className="ing-panel-hint">
          No comparable rates yet. Set this ingredient's canonical rate unit below
          (e.g. <code>unit</code> for eggs, <code>100g</code> for mince) and record pack
          sizes, and these will sort by price per unit.
        </p>
      )}

      {current.map(p => (
        <div key={p.id} className={`price-row ${p.id === best?.id ? 'price-row--best' : ''}`}>
          <span className="price-row-rate">
            {p.canonical_rate != null
              ? formatRate(Number(p.canonical_rate), p.canonical_rate_unit)
              : <span className="meta">no rate</span>}
          </span>

          <span className="price-row-what">
            {editing === p.id ? (
              <input
                autoFocus value={draft} onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveLabel(p); if (e.key === 'Escape') setEditing(null) }}
                onBlur={() => saveLabel(p)}
                placeholder="which product?"
              />
            ) : (
              <button className="price-row-label" title="Click to name this product"
                onClick={() => { setEditing(p.id); setDraft(p.label ?? '') }}>
                {p.label || <span className="meta">name this product…</span>}
              </button>
            )}
            <span className="meta">
              {p.stores?.name ?? 'no shop'}{p.unit_size_unit ? ` · ${p.unit_size_unit}` : ''}
            </span>
          </span>

          <span className="price-row-price">£{Number(p.price).toFixed(2)}</span>
          {p.id === best?.id && <span className="badge badge--gold">cheapest</span>}
          <button className="price-row-del" title="Delete this price" onClick={() => remove(p)}>✕</button>
        </div>
      ))}

      <button className="btn ghost small" onClick={() => setShowHistory(v => !v)} style={{ marginTop: '.4rem' }}>
        {showHistory ? '▲ Hide history' : `▼ All ${history.length} price${history.length === 1 ? '' : 's'}`}
      </button>
      {showHistory && (
        <div className="store-cmp-history">
          {history.map(p => (
            <div key={p.id} className="ing-panel-price-row">
              <span className="ing-panel-price-val">£{Number(p.price).toFixed(2)}</span>
              {p.label && <span className="ing-panel-price-unit">{p.label}</span>}
              {p.unit_size_unit && <span className="ing-panel-price-unit">/ {p.unit_size_unit}</span>}
              {p.canonical_rate != null && (
                <span className="ing-panel-price-rate">{formatRate(Number(p.canonical_rate), p.canonical_rate_unit)}</span>
              )}
              <span className="meta">{p.stores?.name ?? '—'}</span>
              <span className="ing-panel-price-date">
                {new Date(p.noted_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
              </span>
              <button className="price-row-del" title="Delete this price" onClick={() => remove(p)}>✕</button>
            </div>
          ))}
        </div>
      )}
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
    // Typing a figure by hand supersedes whatever a photo or a guess put there.
    const touchedNutrition = NUTRIENTS.some(n =>
      (patch[n.per100] ?? null) !== (ing[n.per100] ?? null))
    if (touchedNutrition) {
      patch.nutrition_source = NUTRIENTS.some(n => patch[n.per100] != null) ? 'manual' : null
      patch.nutrition_noted_at = new Date().toISOString()
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
          {ing.nutrition_source === 'estimated' && ' (estimated)'}
          {ing.nutrition_source === 'label' && ' (off the packet)'}
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

          <LabelCapture ing={ing} onApplied={onUpdated} />

          {ing.nutrition_source === 'estimated' && (
            <p className="msg warn" style={{ fontSize: '.78rem' }}>
              These figures were <strong>estimated from the name</strong>, not read off a
              packet. Good enough to plan with; photograph the label to replace them.
            </p>
          )}
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

// ── Reading the nutrition off the packet ──────────────────────────────────────
/**
 * Photograph the back of the packet instead of typing five numbers off it.
 *
 * The numbers are never written straight through. A reading goes past two
 * checks first: the arithmetic in `nutrition.js`, which runs on every provider
 * and catches a slipped decimal point; and, where the provider can search the
 * web, a comparison against what this food is typically like, which catches the
 * reading that is internally consistent but taken off the wrong column. Both
 * are shown to the user, who confirms — the app never silently accepts a figure
 * it has reason to doubt.
 */
function LabelCapture({ ing, onApplied }) {
  const [reading, setReading] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const { provider, apiKey } = storedAiConfig()
  const conf = PROVIDERS[provider]
  const canRead = !!conf?.extractNutrition && (!conf.requiresApiKey || !!apiKey)

  async function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''            // let the same photo be retried
    if (!file) return
    setBusy(true); setErr(''); setReading(null)
    try {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(String(r.result).split(',')[1])
        r.onerror = rej
        r.readAsDataURL(file)
      })
      setReading(await extractNutrition({ provider, apiKey, content: b64, imageMime: file.type }))
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  async function apply() {
    setSaving(true); setErr('')
    const patch = nutritionPatch(reading, 'label')
    const { error } = await supabase.from('ingredients').update(patch).eq('id', ing.id)
    if (error) { setErr(error.message); setSaving(false); return }
    onApplied({ ...ing, ...patch })
    setReading(null)
    setSaving(false)
  }

  const verdict = reading ? checkNutrition(reading) : null
  const online = reading?.verified

  if (!canRead) {
    return (
      <p className="ing-panel-hint">
        📷 Reading a label from a photo needs an image-capable AI provider — set one
        up under “Scan a receipt” on the Shops tab, and it'll appear here.
      </p>
    )
  }

  return (
    <div className="label-capture">
      <label className="btn small secondary label-capture-btn">
        {busy ? <span className="spinner" /> : '📷 Read the label'}
        <input type="file" accept="image/*" capture="environment" onChange={onFile} hidden disabled={busy} />
      </label>
      {conf.verifiesOnline
        ? <span className="meta"> checked against the web before it's offered</span>
        : <span className="meta"> arithmetic-checked ({conf.name} can't search the web)</span>}

      {err && <p className="msg err">{err}</p>}

      {reading && (
        <div className="label-reading">
          {reading.productName && <div className="label-reading-name">{reading.productName}</div>}

          <div className="label-reading-grid">
            {NUTRIENTS.map(n => {
              const key = n.key === 'kcal' ? 'kcal' : n.key
              const v = reading[key]
              return (
                <span key={n.key} className="label-reading-cell">
                  <span className="meta">{n.label}</span>
                  <strong>{v == null ? '—' : v}</strong>
                </span>
              )
            })}
            {reading.packGrams != null && (
              <span className="label-reading-cell">
                <span className="meta">Pack</span><strong>{reading.packGrams}g</strong>
              </span>
            )}
          </div>

          {verdict.severity !== 'ok' && (
            <p className="msg err">
              <strong>Doesn't add up.</strong> {verdict.issues.join('. ')}.
              {' '}Re-take the photo, or correct the figures by hand below after saving.
            </p>
          )}
          {verdict.severity === 'ok' && verdict.expectedKcal != null && (
            <p className="ing-panel-hint">
              ✓ The macros reconstruct to about {verdict.expectedKcal} kcal, which matches the label.
            </p>
          )}

          {online && (
            <p className={`ing-panel-hint ${online.agrees ? '' : 'label-disagrees'}`}>
              {online.agrees ? '✓' : '⚠'} Web check:{' '}
              {online.comment || (online.agrees ? 'consistent with published figures' : 'differs from published figures')}
              {online.typicalKcal != null && ` (typically ~${online.typicalKcal} kcal/100g)`}
            </p>
          )}
          {reading.notes && <p className="ing-panel-hint">Note: {reading.notes}</p>}
          {reading.confidence !== 'high' && (
            <p className="ing-panel-hint">Read with <strong>{reading.confidence}</strong> confidence.</p>
          )}

          <div className="btn-row">
            <button className="btn small" onClick={apply} disabled={saving}>
              {saving ? <span className="spinner" /> : (verdict.severity === 'ok' ? 'Use these' : 'Use anyway')}
            </button>
            <button className="btn small secondary" onClick={() => setReading(null)}>Discard</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── What an odd unit weighs ───────────────────────────────────────────────────
/**
 * The ingredient's own measures.
 *
 * This replaces the free-text "rough measures" note, which held exactly the
 * right fact in a form nothing could read. A recipe line saying "2 tins" now
 * resolves to 800g, which means it counts against the deck and contributes its
 * nutrients — where before it normalised to null and vanished from both.
 */
function Measures({ ing, units, onChanged }) {
  const [label, setLabel] = useState('')
  const [grams, setGrams] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function add(e) {
    e?.preventDefault()
    setBusy(true); setErr('')
    try {
      await addIngredientUnit(ing.id, label, grams)
      setLabel(''); setGrams('')
      await onChanged()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  async function remove(u) {
    setBusy(true); setErr('')
    try { await deleteIngredientUnit(u.id); await onChanged() } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <div className="ing-panel-section">
      <div className="ing-panel-label">Measures</div>
      <p className="ing-panel-hint">
        What an awkward unit weighs, for this ingredient. A recipe line in a unit
        listed here converts automatically; one in a unit that isn't is invisible
        to the deck and to nutrition. Use <code>each</code> for a countable thing
        (one onion, one egg).
      </p>

      {units.length > 0 && (
        <div className="measure-list">
          {units.map(u => (
            <span key={u.id} className="measure-chip">
              1 {u.label} = {Number(u.grams)}g
              <button title="Remove" onClick={() => remove(u)} disabled={busy}>✕</button>
            </span>
          ))}
        </div>
      )}

      <form className="measure-add" onSubmit={add}>
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="tin" aria-label="Measure name" />
        <span className="meta">=</span>
        <input type="number" min="0" step="any" value={grams} onChange={e => setGrams(e.target.value)}
               placeholder="400" aria-label="Grams" />
        <span className="meta">g</span>
        <button className="btn small secondary" type="submit" disabled={busy || !label.trim() || !grams}>Add</button>
      </form>
      {err && <p className="msg err">{err}</p>}
    </div>
  )
}

// ── Retiring an ingredient ────────────────────────────────────────────────────
/**
 * Archive, merge or delete.
 *
 * These are ranked by how much they cost you, and the panel offers them in that
 * order. Archiving is free — the ingredient leaves the larder and the deck but
 * every recipe, shop and cook that mentions it is untouched. Merging is the
 * right answer to a near-duplicate: history moves rather than dies. Deleting is
 * last and shows exactly what it takes with it, because the foreign keys
 * cascade and there is no undo.
 */
function DangerZone({ ing, ingredients, onArchived, onRemoved }) {
  const [open, setOpen] = useState(false)
  const [usage, setUsage] = useState(null)
  const [mergeId, setMergeId] = useState('')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => { setOpen(false); setUsage(null); setMergeId(''); setErr(''); setBusy('') }, [ing.id])

  async function reveal() {
    setOpen(true)
    if (!usage) {
      try { setUsage(await ingredientUsage(ing.id)) } catch (e) { setErr(e.message) }
    }
  }

  async function run(what, fn) {
    setBusy(what); setErr('')
    try { await fn() } catch (e) { setErr(e.message); setBusy(''); return false }
    setBusy('')
    return true
  }

  const archived = !!ing.archived

  async function toggleArchive() {
    const ok = await run('archive', () => setIngredientArchived(ing.id, !archived))
    if (ok) onArchived({ ...ing, archived: !archived })
  }

  async function doMerge() {
    const target = ingredients.find(i => String(i.id) === String(mergeId))
    if (!target) return
    const msg = `Fold “${ing.name}” into “${target.name}”?\n\n` +
      `Its prices, recipe lines, shops and cooks all move across, and “${ing.name}” is removed. This can't be undone.`
    if (!window.confirm(msg)) return
    const ok = await run('merge', () => mergeIngredients(ing.id, target.id))
    if (ok) onRemoved(ing, { reason: 'merged', into: target })
  }

  async function doDelete() {
    const bits = usage ? [
      usage.prices   && `${usage.prices} price${usage.prices === 1 ? '' : 's'}`,
      usage.recipes  && `${usage.recipes} recipe line${usage.recipes === 1 ? '' : 's'}`,
      usage.purchases && `${usage.purchases} shopping line${usage.purchases === 1 ? '' : 's'}`,
      usage.targets  && `${usage.targets} deck target${usage.targets === 1 ? '' : 's'}`,
      usage.cookLines && `${usage.cookLines} cook line${usage.cookLines === 1 ? '' : 's'}`,
    ].filter(Boolean) : []
    const msg = bits.length
      ? `Delete “${ing.name}” and ${bits.join(', ')}?\n\nThis can't be undone. Archive it instead if you only want it out of the way.`
      : `Delete “${ing.name}”? This can't be undone.`
    if (!window.confirm(msg)) return
    const ok = await run('delete', () => deleteIngredient(ing.id))
    if (ok) onRemoved(ing, { reason: 'deleted' })
  }

  const others = ingredients.filter(i => i.id !== ing.id && !i.archived)

  return (
    <div className="ing-panel-section ing-danger">
      {!open ? (
        <button className="btn ghost small" onClick={reveal}>Archive, merge or delete…</button>
      ) : (
        <>
          <div className="ing-panel-label">Retire this ingredient</div>

          <div className="ing-danger-row">
            <div>
              <strong>{archived ? 'Bring back' : 'Archive'}</strong>
              <p className="ing-panel-hint" style={{ margin: 0 }}>
                {archived
                  ? 'Put it back in the larder and the deck.'
                  : 'Hide it from the larder and the deck. Nothing that mentions it is changed.'}
              </p>
            </div>
            <button className="btn small secondary" onClick={toggleArchive} disabled={!!busy}>
              {busy === 'archive' ? <span className="spinner" /> : (archived ? 'Restore' : 'Archive')}
            </button>
          </div>

          <div className="ing-danger-row">
            <div style={{ flex: 1 }}>
              <strong>Merge into another</strong>
              <p className="ing-panel-hint" style={{ margin: 0 }}>
                For a duplicate. Everything recorded against this one moves across.
              </p>
              <select value={mergeId} onChange={e => setMergeId(e.target.value)} style={{ marginTop: '.3rem' }}>
                <option value="">Choose the one to keep…</option>
                {others.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>
            <button className="btn small secondary" onClick={doMerge} disabled={!!busy || !mergeId}>
              {busy === 'merge' ? <span className="spinner" /> : 'Merge'}
            </button>
          </div>

          <div className="ing-danger-row">
            <div>
              <strong>Delete</strong>
              <p className="ing-panel-hint" style={{ margin: 0 }}>
                {usage === null ? 'Counting what references it…'
                  : usage.total === 0 ? 'Nothing references this — safe to remove.'
                  : `Takes ${usage.prices} price(s), ${usage.recipes} recipe line(s), ` +
                    `${usage.purchases} shopping line(s), ${usage.targets} deck target(s) and ` +
                    `${usage.cookLines} cook line(s) with it.`}
              </p>
            </div>
            <button className="btn small danger" onClick={doDelete} disabled={!!busy}>
              {busy === 'delete' ? <span className="spinner" /> : 'Delete'}
            </button>
          </div>

          {err && <p className="msg err" style={{ marginTop: '.4rem' }}>{err}</p>}
          <button className="btn ghost small" onClick={() => setOpen(false)}>Close</button>
        </>
      )}
    </div>
  )
}

// ── Ingredient detail panel ───────────────────────────────────────────────────
export default function IngredientPanel({
  ing, houseId, categories, ingredients = [], onClose, onUpdated,
  onCategoriesChanged, onCategoryDeleted, onRemoved,
}) {
  const [canonRateUnit, setCanonRateUnit] = useState(ing.canonical_rate_unit || '')
  const [catIds, setCatIds] = useState(ing.categoryIds ?? [])
  const [prices, setPrices] = useState(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [units, setUnits] = useState([])
  const [nameDraft, setNameDraft] = useState(ing.name)
  const [nameErr, setNameErr] = useState('')
  const [clash, setClash] = useState(null)   // the ingredient a rename ran into

  /**
   * Rename. A name that's already taken isn't reported as a failure — the two
   * rows are almost always the same thing typed twice, so the collision offers
   * the merge directly.
   */
  async function saveName() {
    const clean = nameDraft.trim()
    if (!clean || clean === ing.name) { setNameDraft(ing.name); setNameErr(''); setClash(null); return }
    try {
      const updated = await renameIngredient(ing, clean)
      setNameErr(''); setClash(null)
      onUpdated({ ...ing, ...updated })
    } catch (e) {
      setNameErr(e.message)
      setClash(e.collidesWith ?? null)
    }
  }

  async function mergeIntoClash() {
    if (!clash) return
    if (!window.confirm(`Fold “${ing.name}” into “${clash.name}”? Its prices, recipes and history move across.`)) return
    try {
      await mergeIngredients(ing.id, clash.id)
      onRemoved?.(ing, { reason: 'merged', into: clash })
    } catch (e) { setNameErr(e.message) }
  }

  /** Name the product a price was for, so the comparison can tell them apart. */
  async function relabel(price, label) {
    const next = (label ?? '').trim() || null
    if (next === (price.label ?? null)) return
    await supabase.from('ingredient_prices').update({ label: next }).eq('id', price.id)
    setPrices(ps => ps.map(p => p.id === price.id ? { ...p, label: next } : p))
  }

  async function fetchPrices() {
    const { data } = await supabase
      .from('ingredient_prices')
      .select('id, store_id, price, label, unit_size_unit, canonical_rate, canonical_rate_unit, noted_at, stores(name)')
      .eq('ingredient_id', ing.id)
      .order('noted_at', { ascending: false })
    setPrices(data ?? [])
  }

  async function removePrice(price) {
    try {
      await deletePrice(price.id)
      setPrices(ps => ps.filter(p => p.id !== price.id))
    } catch (e) { setMsg('Error: ' + e.message) }
  }

  const fetchUnits = async () => setUnits(await loadIngredientUnits(ing.id))

  useEffect(() => {
    setCanonRateUnit(ing.canonical_rate_unit || '')
    setCatIds(ing.categoryIds ?? [])
    setNameDraft(ing.name)
    setNameErr(''); setClash(null)
    fetchPrices()
    fetchUnits()
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
          <input
            className="ing-panel-name"
            value={nameDraft}
            onChange={e => setNameDraft(e.target.value)}
            onBlur={saveName}
            onKeyDown={e => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') { setNameDraft(ing.name); setNameErr(''); setClash(null) }
            }}
            aria-label="Ingredient name"
          />
          {ing.archived && <span className="badge">archived</span>}
          <button className="btn ghost small" onClick={onClose}>✕</button>
        </div>
        {nameErr && (
          <p className="msg err" style={{ margin: '0 0 .5rem' }}>
            {nameErr}
            {clash && (
              <button className="btn small secondary" style={{ marginLeft: '.5rem' }} onClick={mergeIntoClash}>
                Merge into “{clash.name}”
              </button>
            )}
          </p>
        )}

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

        {/* Prices first — it's the question this panel is usually opened to answer */}
        {prices === null && (
          <div className="ing-panel-section"><p className="empty">Loading…</p></div>
        )}
        {prices?.length === 0 && (
          <div className="ing-panel-section"><p className="empty">No prices recorded yet.</p></div>
        )}
        {prices?.length > 0 && <PriceComparison prices={prices} onRelabel={relabel} onDelete={removePrice} />}

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

        <Measures ing={ing} units={units} onChanged={fetchUnits} />

        <DangerZone
          ing={ing}
          ingredients={ingredients}
          onArchived={updated => onUpdated(updated)}
          onRemoved={(gone, info) => { onRemoved?.(gone, info); onClose() }}
        />
      </div>
    </div>
  )
}
