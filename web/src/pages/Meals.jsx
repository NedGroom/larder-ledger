import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import { useApp } from '../App.jsx'

// ── New ingredient inline form (used inside the meal modal) ───────────────────
function QuickAddIngredient({ houseId, onAdded }) {
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function save(e) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    const { data, error } = await supabase.from('ingredients').insert({
      house_id: houseId,
      name: name.trim(),
      name_normalized: name.trim().toLowerCase(),
      canonical_unit: unit.trim() || null,
      has_any: false,
    }).select().single()
    if (error) { setErr(error.message); setSaving(false); return }
    setName(''); setUnit(''); setErr('')
    setSaving(false)
    onAdded(data)
  }

  return (
    <form onSubmit={save} style={{ padding: '.5rem .75rem', background: '#f9fdf9', borderTop: '1px solid #e0e0e0' }}>
      <p style={{ fontSize: '.8rem', color: '#2d6a4f', fontWeight: 600, marginBottom: '.3rem' }}>+ New ingredient</p>
      <div className="field-row">
        <label>
          Name
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Garlic" required />
        </label>
        <label style={{ maxWidth: 90 }}>
          Unit
          <input value={unit} onChange={e => setUnit(e.target.value)} placeholder="g / unit" />
        </label>
        <button className="btn small" type="submit" disabled={saving} style={{ marginTop: 22 }}>
          {saving ? <span className="spinner" /> : 'Add'}
        </button>
      </div>
      {err && <p className="msg err">{err}</p>}
    </form>
  )
}

// ── Meal creation modal ───────────────────────────────────────────────────────
function MealModal({ houseId, onClose, onSaved }) {
  const [allIngredients, setAllIngredients] = useState([])
  const [mealName, setMealName] = useState('')
  const [dishType, setDishType] = useState('')
  const [prepTime, setPrepTime] = useState('')
  const [servings, setServings] = useState('')
  // selected: { [ingredient_id]: { checked, quantity, unit } }
  const [selected, setSelected] = useState({})
  const [search, setSearch] = useState('')
  const [showQuickAdd, setShowQuickAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    supabase.from('ingredients').select('*').eq('house_id', houseId).order('name')
      .then(({ data }) => setAllIngredients(data ?? []))
  }, [houseId])

  function toggleIngredient(id) {
    setSelected(prev => ({
      ...prev,
      [id]: prev[id]
        ? { ...prev[id], checked: !prev[id].checked }
        : { checked: true, quantity: '', unit: '' }
    }))
  }

  function setQty(id, qty) {
    setSelected(prev => ({ ...prev, [id]: { ...prev[id], quantity: qty } }))
  }

  function handleIngAdded(ing) {
    setAllIngredients(prev => [...prev, ing].sort((a, b) => a.name.localeCompare(b.name)))
    setSelected(prev => ({ ...prev, [ing.id]: { checked: true, quantity: '', unit: ing.canonical_unit ?? '' } }))
    setShowQuickAdd(false)
  }

  async function save(e) {
    e.preventDefault()
    if (!mealName.trim()) { setErr('Enter a meal name'); return }
    setSaving(true)
    // 1. Create meal
    const { data: meal, error: mealErr } = await supabase.from('meals').insert({
      house_id: houseId,
      name: mealName.trim(),
      dish_type: dishType.trim() || null,
      prep_time_min: prepTime ? +prepTime : null,
      servings: servings ? +servings : null,
    }).select().single()

    if (mealErr) { setErr(mealErr.message); setSaving(false); return }

    // 2. Link selected ingredients
    const links = Object.entries(selected)
      .filter(([, v]) => v.checked)
      .map(([id, v]) => ({
        meal_id: meal.id,
        ingredient_id: +id,
        required_quantity: v.quantity ? +v.quantity : null,
        required_unit: v.unit || null,
      }))

    if (links.length) {
      const { error: linkErr } = await supabase.from('meal_ingredients').insert(links)
      if (linkErr) { setErr(linkErr.message); setSaving(false); return }
    }

    setSaving(false)
    onSaved(meal)
  }

  const filtered = allIngredients.filter(i =>
    i.name.toLowerCase().includes(search.toLowerCase())
  )
  const checkedCount = Object.values(selected).filter(v => v.checked).length

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2>New meal</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={save}>
          <label>
            Meal name *
            <input value={mealName} onChange={e => setMealName(e.target.value)} placeholder="e.g. Spaghetti Bolognese" required autoFocus />
          </label>
          <div className="field-row" style={{ marginTop: '.4rem' }}>
            <label>
              Dish type
              <input value={dishType} onChange={e => setDishType(e.target.value)} placeholder="pasta, soup…" />
            </label>
            <label style={{ maxWidth: 100 }}>
              Prep (min)
              <input type="number" value={prepTime} onChange={e => setPrepTime(e.target.value)} placeholder="30" min="0" />
            </label>
            <label style={{ maxWidth: 90 }}>
              Servings
              <input type="number" value={servings} onChange={e => setServings(e.target.value)} placeholder="4" min="1" />
            </label>
          </div>

          <h3 style={{ marginTop: '.9rem' }}>
            Ingredients {checkedCount > 0 && <span className="pill blue">{checkedCount} selected</span>}
          </h3>
          <input
            type="search" placeholder="Search ingredients…"
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ marginBottom: '.3rem' }}
          />
          <div className="ing-picker">
            {filtered.map(ing => {
              const sel = selected[ing.id] ?? {}
              return (
                <div key={ing.id} className="ing-picker-row">
                  <input
                    type="checkbox"
                    checked={!!sel.checked}
                    onChange={() => toggleIngredient(ing.id)}
                  />
                  <span className="ing-name">{ing.name}</span>
                  {sel.checked && (
                    <>
                      <input
                        type="number"
                        placeholder="qty"
                        value={sel.quantity ?? ''}
                        onChange={e => setQty(ing.id, e.target.value)}
                        min="0" step="any"
                      />
                      <span className="ing-unit">{ing.canonical_unit ?? ''}</span>
                    </>
                  )}
                </div>
              )
            })}
            {filtered.length === 0 && (
              <p style={{ padding: '.5rem .75rem', fontSize: '.85rem', color: '#999' }}>No ingredients match.</p>
            )}
          </div>

          <button
            type="button"
            className="btn ghost small"
            style={{ marginTop: '.5rem' }}
            onClick={() => setShowQuickAdd(v => !v)}
          >
            {showQuickAdd ? '− Cancel new ingredient' : '+ New ingredient'}
          </button>
          {showQuickAdd && <QuickAddIngredient houseId={houseId} onAdded={handleIngAdded} />}

          {err && <p className="msg err" style={{ marginTop: '.5rem' }}>{err}</p>}
          <div className="btn-row" style={{ marginTop: '.9rem' }}>
            <button className="btn" type="submit" disabled={saving}>
              {saving ? <span className="spinner" /> : 'Save meal'}
            </button>
            <button className="btn secondary" type="button" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Plan meal modal ───────────────────────────────────────────────────────────
function PlanModal({ meal, houseId, onClose, onSaved }) {
  const [date, setDate] = useState(meal.planned_date ?? '')
  const [ingredients, setIngredients] = useState([])
  const [checked, setChecked] = useState({}) // { [ingredient_id]: bool }
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    // Load this meal's ingredients
    supabase.from('meal_ingredients')
      .select('ingredient_id, required_quantity, required_unit, ingredients(name, has_any)')
      .eq('meal_id', meal.id)
      .then(({ data }) => setIngredients(data ?? []))
  }, [meal.id])

  async function save(e) {
    e.preventDefault()
    setSaving(true)

    // 1. Set planned_date on the meal
    const { error: planErr } = await supabase.from('meals')
      .update({ planned_date: date || null })
      .eq('id', meal.id)
    if (planErr) { setErr(planErr.message); setSaving(false); return }

    // 2. Add checked ingredients to shopping list tagged with meal_id
    const toAdd = ingredients.filter(i => checked[i.ingredient_id])
    if (toAdd.length) {
      const rows = toAdd.map(i => ({
        house_id: houseId,
        ingredient_id: i.ingredient_id,
        auto_generated: false,
        meal_id: meal.id,
        completed: false,
      }))
      const { error: shopErr } = await supabase.from('shopping_list_items').insert(rows)
      if (shopErr) { setErr(shopErr.message); setSaving(false); return }
    }

    setSaving(false)
    onSaved()
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2>Plan: {meal.name}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={save}>
          <label>
            Date
            <input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </label>

          {ingredients.length > 0 && (
            <>
              <h3 style={{ marginTop: '.8rem' }}>Add to shopping list</h3>
              <p style={{ fontSize: '.8rem', color: '#888', margin: '-.2rem 0 .5rem' }}>
                Tick ingredients you need to buy. They'll be tagged with this meal.
              </p>
              {ingredients.map(i => (
                <div key={i.ingredient_id} className="ing-picker-row">
                  <input
                    type="checkbox"
                    checked={!!checked[i.ingredient_id]}
                    onChange={() => setChecked(prev => ({ ...prev, [i.ingredient_id]: !prev[i.ingredient_id] }))}
                  />
                  <span className="ing-name">{i.ingredients?.name}</span>
                  {i.required_quantity && (
                    <span className="meta">{i.required_quantity} {i.required_unit ?? ''}</span>
                  )}
                  {i.ingredients?.has_any
                    ? <span className="pill green" style={{ fontSize: '.7rem' }}>in stock</span>
                    : <span className="pill red" style={{ fontSize: '.7rem' }}>missing</span>
                  }
                </div>
              ))}
            </>
          )}

          {err && <p className="msg err">{err}</p>}
          <div className="btn-row" style={{ marginTop: '.9rem' }}>
            <button className="btn" type="submit" disabled={saving}>
              {saving ? <span className="spinner" /> : 'Save plan'}
            </button>
            <button className="btn secondary" type="button" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main Meals page ───────────────────────────────────────────────────────────
export default function Meals() {
  const { house } = useApp()
  const [meals, setMeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [planMeal, setPlanMeal] = useState(null)
  const [fractions, setFractions] = useState(null)
  const [loadingFrac, setLoadingFrac] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('meals')
      .select('*, meal_ingredients(count)')
      .eq('house_id', house.id)
      .order('name')
    setMeals(data ?? [])
    setLoading(false)
  }, [house.id])

  useEffect(() => { load() }, [load])

  async function loadFractions() {
    setLoadingFrac(true)
    const { data, error } = await supabase.rpc('meal_ingredient_fractions', { p_house_id: house.id })
    if (!error) setFractions(data ?? [])
    setLoadingFrac(false)
  }

  function handleSaved(meal) {
    setShowModal(false)
    load()
    setFractions(null) // reset so user refreshes fractions after save
  }

  const fracMap = fractions ? Object.fromEntries(fractions.map(f => [f.meal_id, f])) : {}

  return (
    <>
      <div className="section-title">
        <h2>Meals ({meals.length})</h2>
        <button className="btn small" onClick={() => setShowModal(true)}>+ New meal</button>
      </div>

      {loading && <p className="empty">Loading…</p>}
      {!loading && meals.length === 0 && <p className="empty">No meals yet. Add one above.</p>}

      {meals.map(meal => {
        const frac = fracMap[meal.id]
        const pct = frac?.fraction != null ? Math.round(frac.fraction * 100) : null
        return (
          <div key={meal.id} className="card">
            <span className="name">{meal.name}</span>
            {meal.dish_type && <span className="pill gray">{meal.dish_type}</span>}
            {meal.prep_time_min && <span className="meta">{meal.prep_time_min}m</span>}
            {meal.servings && <span className="meta">{meal.servings} srv</span>}
            {meal.planned_date && <span className="pill blue">📅 {meal.planned_date}</span>}
            {frac != null && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                <span className="fbar"><span className="fbar-fill" style={{ width: `${pct}%` }} /></span>
                <span className="meta">{frac.ingredients_present}/{frac.total_ingredients}</span>
              </span>
            )}
            <button className="btn small" onClick={() => setPlanMeal(meal)}>Plan</button>
          </div>
        )
      })}

      {meals.length > 0 && (
        <button
          className="btn ghost small"
          style={{ marginTop: '.5rem' }}
          onClick={loadFractions}
          disabled={loadingFrac}
        >
          {loadingFrac ? <><span className="spinner" /> Checking…</> : '↻ Check ingredient availability'}
        </button>
      )}

      {showModal && (
        <MealModal houseId={house.id} onClose={() => setShowModal(false)} onSaved={handleSaved} />
      )}
      {planMeal && (
        <PlanModal
          meal={planMeal}
          houseId={house.id}
          onClose={() => setPlanMeal(null)}
          onSaved={() => { setPlanMeal(null); load() }}
        />
      )}
    </>
  )
}

