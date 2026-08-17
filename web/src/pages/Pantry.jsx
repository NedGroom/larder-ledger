import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import { useApp } from '../App.jsx'
import IngredientBrowser from '../components/IngredientBrowser.jsx'
import IngredientPanel, { CategoryPicker } from '../components/IngredientPanel.jsx'
import { loadLarder, loadPrices, priceFor, setIngredientCategories } from '../lib/larder.js'

export default function Pantry() {
  const { house } = useApp()
  const [ingredients, setIngredients] = useState([])
  const [categories, setCategories] = useState([])
  const [pricesByIng, setPricesByIng] = useState({})
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)   // ingredient panel

  // add form
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('')
  const [canonicalQty, setCanonicalQty] = useState('')
  const [hasAny, setHasAny] = useState(false)
  const [keep, setKeep] = useState(true)
  const [newCatIds, setNewCatIds] = useState([])
  const [msg, setMsg] = useState({ text: '', ok: true })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { ingredients: ings, categories: cats } = await loadLarder(house.id)
    setIngredients(ings)
    setCategories(cats)
    setPricesByIng(await loadPrices(ings.map(i => i.id)))
    setLoading(false)
  }, [house.id])

  useEffect(() => { load() }, [load])

  async function addIngredient(e) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    const { data, error } = await supabase.from('ingredients').insert({
      house_id: house.id,
      name: name.trim(),
      name_normalized: name.trim().toLowerCase(),
      canonical_unit: unit.trim() || null,
      canonical_quantity: canonicalQty ? +canonicalQty : null,
      has_any: hasAny,
      keep,
    }).select('*').single()

    if (error) {
      setMsg({ text: error.message, ok: false })
    } else {
      if (newCatIds.length) await setIngredientCategories(data.id, newCatIds)
      setIngredients(prev => [...prev, { ...data, categoryIds: newCatIds }].sort((a, b) => a.name.localeCompare(b.name)))
      setMsg({ text: `"${name.trim()}" added`, ok: true })
      setName(''); setUnit(''); setCanonicalQty(''); setHasAny(false); setKeep(true); setNewCatIds([])
    }
    setSaving(false)
  }

  async function toggleHasAny(ing) {
    const next = !ing.has_any
    setIngredients(prev => prev.map(i => i.id === ing.id ? { ...i, has_any: next } : i))
    const { error } = await supabase.from('ingredients').update({ has_any: next }).eq('id', ing.id)
    if (error) setIngredients(prev => prev.map(i => i.id === ing.id ? { ...i, has_any: ing.has_any } : i))
  }

  async function toggleKeep(ing) {
    const next = !(ing.keep ?? true)
    setIngredients(prev => prev.map(i => i.id === ing.id ? { ...i, keep: next } : i))
    const { error } = await supabase.from('ingredients').update({ keep: next }).eq('id', ing.id)
    if (error) setIngredients(prev => prev.map(i => i.id === ing.id ? { ...i, keep: ing.keep } : i))
  }

  const inStock = ingredients.filter(i => i.has_any).length

  function noteCategory(cat) {
    setCategories(prev => prev.some(c => c.id === cat.id) ? prev : [...prev, cat].sort((a, b) => a.name.localeCompare(b.name)))
  }

  // A deleted category unfiles its ingredients rather than removing them.
  function dropCategory(cat) {
    setCategories(prev => prev.filter(c => c.id !== cat.id))
    setNewCatIds(prev => prev.filter(x => x !== cat.id))
    setIngredients(prev => prev.map(i => ({ ...i, categoryIds: (i.categoryIds ?? []).filter(x => x !== cat.id) })))
  }

  return (
    <>
      <div className="section-title">
        <h2>Larder ({ingredients.length})</h2>
        <span className="pill green">{inStock} in stock</span>
        <button className="btn small" onClick={() => setShowAdd(v => !v)}>
          {showAdd ? 'Close' : '+ Add ingredient'}
        </button>
      </div>

      {showAdd && (
        <form onSubmit={addIngredient} className="larder-add-form">
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

          <label style={{ display: 'block', marginTop: '.5rem' }}>Categories</label>
          <CategoryPicker
            houseId={house.id}
            categories={categories}
            selectedIds={newCatIds}
            onChange={setNewCatIds}
            onCategoriesChanged={noteCategory}
            onCategoryDeleted={dropCategory}
          />

          <div className="toggle-wrap" style={{ marginTop: '.5rem', gap: '1.2rem' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem' }}>
              <label className="toggle">
                <input type="checkbox" checked={hasAny} onChange={e => setHasAny(e.target.checked)} />
                <span className="toggle-slider" />
              </label>
              <span>In stock</span>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem' }}>
              <label className="toggle">
                <input type="checkbox" checked={keep} onChange={e => setKeep(e.target.checked)} />
                <span className="toggle-slider" />
              </label>
              <span title="Should this show up when building a shopping list?">Keep stocked</span>
            </span>
          </div>
          <button className="btn" type="submit" disabled={saving}>
            {saving ? <span className="spinner" /> : '+ Add'}
          </button>
          {msg.text && <p className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</p>}
        </form>
      )}

      <hr className="divider" />

      {loading ? <p className="empty">Loading…</p> : (
        <IngredientBrowser
          houseId={house.id}
          ingredients={ingredients}
          categories={categories}
          priceOf={id => priceFor(pricesByIng, id, null)}
          mode="browse"
          onToggleStock={toggleHasAny}
          onToggleKeep={toggleKeep}
          onSelect={setSelected}
          onCreated={ing => setIngredients(prev =>
            prev.some(i => i.id === ing.id) ? prev : [...prev, ing].sort((a, b) => a.name.localeCompare(b.name))
          )}
        />
      )}

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
          onCategoriesChanged={noteCategory}
          onCategoryDeleted={dropCategory}
        />
      )}
    </>
  )
}
