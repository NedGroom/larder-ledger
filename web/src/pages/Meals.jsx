import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import { useApp } from '../App.jsx'

// A "dish" is the primary object; a "variant" is a child dish with the same
// shape but no children of its own (two levels). Stored in the `meals` table
// with parent_id (NULL = dish). Instructions/photos/links/backstory are just
// attributes — there is no separate "recipe" object.

const linesToArray = s => (s ?? '').split('\n').map(x => x.trim()).filter(Boolean)
const arrayToLines = a => (a ?? []).join('\n')

// ── New ingredient inline form (used inside the recipe modal) ─────────────────
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
      keep: false, // recipe-only ingredients don't clog shopping defaults
    }).select().single()
    if (error) { setErr(error.message); setSaving(false); return }
    setName(''); setUnit(''); setErr(''); setSaving(false)
    onAdded(data)
  }

  return (
    <form onSubmit={save} style={{ padding: '.5rem .75rem', background: 'var(--color-surface2)', borderTop: '1px solid var(--color-border)' }}>
      <p style={{ fontSize: '.8rem', color: 'var(--color-accent)', fontWeight: 600, marginBottom: '.3rem' }}>+ New ingredient</p>
      <div className="field-row">
        <label>Name
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Garlic" required />
        </label>
        <label style={{ maxWidth: 90 }}>Unit
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

// ── Create / edit a dish or a variant ─────────────────────────────────────────
function RecipeModal({ houseId, editing, parent, onClose, onSaved }) {
  const isVariant = !!parent || !!editing?.parent_id
  const [allIngredients, setAllIngredients] = useState([])
  const [name, setName] = useState(editing?.name ?? '')
  const [dishType, setDishType] = useState(editing?.dish_type ?? '')
  const [prepTime, setPrepTime] = useState(editing?.prep_time_min ?? '')
  const [servings, setServings] = useState(editing?.servings ?? '')
  const [instructions, setInstructions] = useState(editing?.instructions ?? '')
  const [backstory, setBackstory] = useState(editing?.backstory ?? '')
  const [sourceLinks, setSourceLinks] = useState(arrayToLines(editing?.source_links))
  const [photoUrls, setPhotoUrls] = useState(arrayToLines(editing?.photo_urls))
  const [selected, setSelected] = useState({}) // ingredient_id → { checked, quantity, unit }
  const [search, setSearch] = useState('')
  const [showQuickAdd, setShowQuickAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    supabase.from('ingredients').select('*').eq('house_id', houseId).order('name')
      .then(({ data }) => setAllIngredients(data ?? []))
    if (editing) {
      supabase.from('meal_ingredients').select('ingredient_id, required_quantity, required_unit').eq('meal_id', editing.id)
        .then(({ data }) => {
          const sel = {}
          for (const r of (data ?? [])) sel[r.ingredient_id] = { checked: true, quantity: r.required_quantity ?? '', unit: r.required_unit ?? '' }
          setSelected(sel)
        })
    }
  }, [houseId, editing])

  function toggleIngredient(id) {
    setSelected(prev => ({ ...prev, [id]: prev[id] ? { ...prev[id], checked: !prev[id].checked } : { checked: true, quantity: '', unit: '' } }))
  }
  const setQty = (id, qty) => setSelected(prev => ({ ...prev, [id]: { ...prev[id], quantity: qty } }))

  function handleIngAdded(ing) {
    setAllIngredients(prev => [...prev, ing].sort((a, b) => a.name.localeCompare(b.name)))
    setSelected(prev => ({ ...prev, [ing.id]: { checked: true, quantity: '', unit: ing.canonical_unit ?? '' } }))
    setShowQuickAdd(false)
  }

  async function save(e) {
    e.preventDefault()
    if (!name.trim()) { setErr('Enter a name'); return }
    setSaving(true)
    const fields = {
      house_id: houseId,
      parent_id: editing?.parent_id ?? parent?.id ?? null,
      name: name.trim(),
      dish_type: dishType.trim() || null,
      prep_time_min: prepTime ? +prepTime : null,
      servings: servings ? +servings : null,
      instructions: instructions.trim() || null,
      backstory: backstory.trim() || null,
      source_links: linesToArray(sourceLinks),
      photo_urls: linesToArray(photoUrls),
    }

    let mealId = editing?.id
    if (editing) {
      const { error } = await supabase.from('meals').update(fields).eq('id', editing.id)
      if (error) { setErr(error.message); setSaving(false); return }
      await supabase.from('meal_ingredients').delete().eq('meal_id', editing.id)
    } else {
      const { data, error } = await supabase.from('meals').insert(fields).select().single()
      if (error) { setErr(error.message); setSaving(false); return }
      mealId = data.id
    }

    const links = Object.entries(selected).filter(([, v]) => v.checked).map(([id, v]) => ({
      meal_id: mealId, ingredient_id: +id,
      required_quantity: v.quantity ? +v.quantity : null,
      required_unit: v.unit || null,
    }))
    if (links.length) {
      const { error: linkErr } = await supabase.from('meal_ingredients').insert(links)
      if (linkErr) { setErr(linkErr.message); setSaving(false); return }
    }
    setSaving(false)
    onSaved()
  }

  const filtered = allIngredients.filter(i => i.name.toLowerCase().includes(search.toLowerCase()))
  const checkedCount = Object.values(selected).filter(v => v.checked).length
  const title = editing ? `Edit ${isVariant ? 'variant' : 'dish'}` : isVariant ? `New variant of ${parent?.name ?? editing?.name ?? ''}` : 'New dish'

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={save}>
          <label>Name *
            <input value={name} onChange={e => setName(e.target.value)} placeholder={isVariant ? 'e.g. Ned’s Bolognese' : 'e.g. Bolognese'} required autoFocus />
          </label>
          <div className="field-row" style={{ marginTop: '.4rem' }}>
            <label>Type
              <input value={dishType} onChange={e => setDishType(e.target.value)} placeholder="pasta, soup…" />
            </label>
            <label style={{ maxWidth: 100 }}>Prep (min)
              <input type="number" value={prepTime} onChange={e => setPrepTime(e.target.value)} placeholder="30" min="0" />
            </label>
            <label style={{ maxWidth: 90 }}>Servings
              <input type="number" value={servings} onChange={e => setServings(e.target.value)} placeholder="4" min="1" />
            </label>
          </div>

          <h3 style={{ marginTop: '.9rem' }}>
            Ingredients {checkedCount > 0 && <span className="pill blue">{checkedCount} selected</span>}
          </h3>
          <input type="search" placeholder="Search ingredients…" value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: '.3rem' }} />
          <div className="ing-picker">
            {filtered.map(ing => {
              const sel = selected[ing.id] ?? {}
              return (
                <div key={ing.id} className="ing-picker-row">
                  <input type="checkbox" checked={!!sel.checked} onChange={() => toggleIngredient(ing.id)} />
                  <span className="ing-name">{ing.name}</span>
                  {sel.checked && (
                    <>
                      <input type="number" placeholder="qty" value={sel.quantity ?? ''} onChange={e => setQty(ing.id, e.target.value)} min="0" step="any" />
                      <span className="ing-unit">{ing.canonical_unit ?? ''}</span>
                    </>
                  )}
                </div>
              )
            })}
            {filtered.length === 0 && <p style={{ padding: '.5rem .75rem', fontSize: '.85rem', color: 'var(--color-text-muted)' }}>No ingredients match.</p>}
          </div>
          <button type="button" className="btn ghost small" style={{ marginTop: '.5rem' }} onClick={() => setShowQuickAdd(v => !v)}>
            {showQuickAdd ? '− Cancel new ingredient' : '+ New ingredient'}
          </button>
          {showQuickAdd && <QuickAddIngredient houseId={houseId} onAdded={handleIngAdded} />}

          <h3 style={{ marginTop: '.9rem' }}>Method</h3>
          <textarea value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="Step-by-step instructions…" rows={5} />

          <h3 style={{ marginTop: '.6rem' }}>Backstory <span className="meta">(optional)</span></h3>
          <textarea value={backstory} onChange={e => setBackstory(e.target.value)} placeholder="Where it came from, notes, who taught you…" rows={2} />

          <h3 style={{ marginTop: '.6rem' }}>Source links <span className="meta">(one per line)</span></h3>
          <textarea value={sourceLinks} onChange={e => setSourceLinks(e.target.value)} placeholder="https://…" rows={2} />

          <h3 style={{ marginTop: '.6rem' }}>Photo URLs <span className="meta">(one per line)</span></h3>
          <textarea value={photoUrls} onChange={e => setPhotoUrls(e.target.value)} placeholder="https://…/photo.jpg" rows={2} />

          {err && <p className="msg err" style={{ marginTop: '.5rem' }}>{err}</p>}
          <div className="btn-row" style={{ marginTop: '.9rem' }}>
            <button className="btn" type="submit" disabled={saving}>{saving ? <span className="spinner" /> : 'Save'}</button>
            <button className="btn secondary" type="button" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Plan a dish/variant onto a date (adds ingredients to the shopping list) ────
function PlanModal({ meal, houseId, onClose, onSaved }) {
  const [date, setDate] = useState(meal.planned_date ?? '')
  const [ingredients, setIngredients] = useState([])
  const [checked, setChecked] = useState({})
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    supabase.from('meal_ingredients')
      .select('ingredient_id, required_quantity, required_unit, ingredients(name, has_any)')
      .eq('meal_id', meal.id)
      .then(({ data }) => setIngredients(data ?? []))
  }, [meal.id])

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    const { error: planErr } = await supabase.from('meals').update({ planned_date: date || null }).eq('id', meal.id)
    if (planErr) { setErr(planErr.message); setSaving(false); return }

    const toAdd = ingredients.filter(i => checked[i.ingredient_id])
    if (toAdd.length) {
      let { data: list } = await supabase.from('shopping_lists')
        .select('id').eq('house_id', houseId).in('status', ['building', 'shopping'])
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (!list) {
        const { data: created, error: listErr } = await supabase.from('shopping_lists')
          .insert({
            house_id: houseId,
            status: 'shopping',
            source: 'manual',
            purchased_on: new Date().toISOString().slice(0, 10),
          }).select('id').single()
        if (listErr) { setErr(listErr.message); setSaving(false); return }
        list = created
      }
      const rows = toAdd.map(i => ({
        house_id: houseId, list_id: list.id, ingredient_id: i.ingredient_id,
        quantity: i.required_quantity ? Math.max(1, Math.round(i.required_quantity)) : 1,
        auto_generated: false, meal_id: meal.id, bought: false,
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
          <label>Date
            <input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </label>
          {ingredients.length > 0 && (
            <>
              <h3 style={{ marginTop: '.8rem' }}>Add to shopping list</h3>
              <p className="meta" style={{ margin: '-.2rem 0 .5rem' }}>Tick ingredients you need to buy — they go on your current shopping list.</p>
              {ingredients.map(i => (
                <div key={i.ingredient_id} className="ing-picker-row">
                  <input type="checkbox" checked={!!checked[i.ingredient_id]} onChange={() => setChecked(prev => ({ ...prev, [i.ingredient_id]: !prev[i.ingredient_id] }))} />
                  <span className="ing-name">{i.ingredients?.name}</span>
                  {i.required_quantity && <span className="meta">{i.required_quantity} {i.required_unit ?? ''}</span>}
                  {i.ingredients?.has_any
                    ? <span className="pill green" style={{ fontSize: '.7rem' }}>in stock</span>
                    : <span className="pill red" style={{ fontSize: '.7rem' }}>missing</span>}
                </div>
              ))}
            </>
          )}
          {err && <p className="msg err">{err}</p>}
          <div className="btn-row" style={{ marginTop: '.9rem' }}>
            <button className="btn" type="submit" disabled={saving}>{saving ? <span className="spinner" /> : 'Save plan'}</button>
            <button className="btn secondary" type="button" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Detail view: attributes + collapsible, non-looping parent/children ─────────
function DishDetail({ meal, dishesById, childrenByParent, onOpen, onEdit, onAddVariant, onPlan, onDelete, onClose }) {
  const [ings, setIngs] = useState([])
  useEffect(() => {
    supabase.from('meal_ingredients').select('required_quantity, required_unit, ingredients(name)').eq('meal_id', meal.id)
      .then(({ data }) => setIngs(data ?? []))
  }, [meal.id])

  const parent = meal.parent_id ? dishesById[meal.parent_id] : null
  const children = childrenByParent[meal.id] ?? []
  const isVariant = !!meal.parent_id

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2>{meal.name}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <p className="meta">
          {isVariant ? 'Variant' : 'Dish'}
          {meal.dish_type ? ` · ${meal.dish_type}` : ''}
          {meal.prep_time_min ? ` · ${meal.prep_time_min}m` : ''}
          {meal.servings ? ` · ${meal.servings} servings` : ''}
          {meal.planned_date ? ` · 📅 ${meal.planned_date}` : ''}
        </p>

        {(meal.photo_urls ?? []).length > 0 && (
          <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', margin: '.5rem 0' }}>
            {meal.photo_urls.map((u, i) => <img key={i} src={u} alt="" style={{ maxWidth: 120, maxHeight: 120, borderRadius: 6, objectFit: 'cover' }} />)}
          </div>
        )}

        <h3>Ingredients</h3>
        {ings.length === 0 && <p className="meta">None listed.</p>}
        {ings.map((i, n) => (
          <div key={n} className="ing-picker-row">
            <span className="ing-name">{i.ingredients?.name ?? '—'}</span>
            {i.required_quantity && <span className="meta">{i.required_quantity} {i.required_unit ?? ''}</span>}
          </div>
        ))}

        {meal.instructions && (<><h3 style={{ marginTop: '.7rem' }}>Method</h3><p style={{ whiteSpace: 'pre-wrap' }}>{meal.instructions}</p></>)}
        {meal.backstory && (<><h3 style={{ marginTop: '.7rem' }}>Backstory</h3><p style={{ whiteSpace: 'pre-wrap' }}>{meal.backstory}</p></>)}
        {(meal.source_links ?? []).length > 0 && (
          <><h3 style={{ marginTop: '.7rem' }}>Sources</h3>
            {meal.source_links.map((u, i) => <div key={i}><a href={u} target="_blank" rel="noreferrer">{u}</a></div>)}
          </>
        )}

        {/* collapsible, flat (no nested parent/child links → no looping) */}
        {isVariant && parent && (
          <details className="receipt-panel" style={{ marginTop: '.8rem' }}>
            <summary>Parent dish: {parent.name}</summary>
            <div style={{ paddingTop: '.4rem' }}>
              <button className="btn ghost small" onClick={() => onOpen(parent)}>Open {parent.name} →</button>
            </div>
          </details>
        )}
        {!isVariant && (
          <details className="receipt-panel" style={{ marginTop: '.8rem' }}>
            <summary>Variants ({children.length})</summary>
            <div style={{ paddingTop: '.4rem' }}>
              {children.length === 0 && <p className="meta">No variants yet.</p>}
              {children.map(c => (
                <div key={c.id} className="ing-picker-row">
                  <span className="ing-name">{c.name}</span>
                  <button className="btn ghost small" onClick={() => onOpen(c)}>Open →</button>
                </div>
              ))}
              <button className="btn small" style={{ marginTop: '.5rem' }} onClick={() => onAddVariant(meal)}>+ Add variant</button>
            </div>
          </details>
        )}

        <div className="btn-row" style={{ marginTop: '1rem' }}>
          <button className="btn small" onClick={() => onPlan(meal)}>Plan</button>
          <button className="btn small secondary" onClick={() => onEdit(meal)}>Edit</button>
          <button className="btn small danger" onClick={() => onDelete(meal)}>Delete</button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Meals() {
  const { house } = useApp()
  const [meals, setMeals] = useState([])   // all meals (dishes + variants)
  const [loading, setLoading] = useState(true)
  const [fractions, setFractions] = useState(null)
  const [loadingFrac, setLoadingFrac] = useState(false)

  const [modal, setModal] = useState(null)   // { editing?, parent? } for RecipeModal
  const [planMeal, setPlanMeal] = useState(null)
  const [detail, setDetail] = useState(null) // meal being viewed

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('meals')
      .select('*, meal_ingredients(count)')
      .eq('house_id', house.id).order('name')
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

  async function deleteMeal(meal) {
    const kids = meals.filter(m => m.parent_id === meal.id).length
    const extra = kids ? ` and its ${kids} variant${kids === 1 ? '' : 's'}` : ''
    if (!window.confirm(`Delete "${meal.name}"${extra}? This can't be undone.`)) return
    await supabase.from('meals').delete().eq('id', meal.id) // cascades variants + meal_ingredients
    setDetail(null)
    load()
  }

  const dishes = meals.filter(m => !m.parent_id)
  const dishesById = Object.fromEntries(meals.map(m => [m.id, m]))
  const childrenByParent = meals.reduce((acc, m) => { if (m.parent_id) (acc[m.parent_id] ??= []).push(m); return acc }, {})
  const fracMap = fractions ? Object.fromEntries(fractions.map(f => [f.meal_id, f])) : {}

  // keep the open detail in sync after edits/reloads
  const detailFresh = detail ? (dishesById[detail.id] ?? null) : null

  return (
    <>
      <div className="section-title">
        <h2>Dishes ({dishes.length})</h2>
        <button className="btn small" onClick={() => setModal({})}>+ New dish</button>
      </div>

      {loading && <p className="empty">Loading…</p>}
      {!loading && dishes.length === 0 && <p className="empty">No dishes yet. Add one above.</p>}

      {dishes.map(dish => {
        const frac = fracMap[dish.id]
        const pct = frac?.fraction != null ? Math.round(frac.fraction * 100) : null
        const variantCount = (childrenByParent[dish.id] ?? []).length
        return (
          <div key={dish.id} className="card card--clickable" onClick={() => setDetail(dish)}>
            <span className="name">{dish.name}</span>
            {dish.dish_type && <span className="pill gray">{dish.dish_type}</span>}
            {variantCount > 0 && <span className="pill blue">{variantCount} variant{variantCount === 1 ? '' : 's'}</span>}
            {dish.planned_date && <span className="pill green" style={{ fontSize: '.7rem' }}>📅 {dish.planned_date}</span>}
            {frac != null && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                <span className="fbar"><span className="fbar-fill" style={{ width: `${pct}%` }} /></span>
                <span className="meta">{frac.ingredients_present}/{frac.total_ingredients}</span>
              </span>
            )}
          </div>
        )
      })}

      {dishes.length > 0 && (
        <button className="btn ghost small" style={{ marginTop: '.5rem' }} onClick={loadFractions} disabled={loadingFrac}>
          {loadingFrac ? <><span className="spinner" /> Checking…</> : '↻ Check ingredient availability'}
        </button>
      )}

      {modal && (
        <RecipeModal
          houseId={house.id}
          editing={modal.editing}
          parent={modal.parent}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
        />
      )}
      {planMeal && (
        <PlanModal meal={planMeal} houseId={house.id} onClose={() => setPlanMeal(null)} onSaved={() => { setPlanMeal(null); load() }} />
      )}
      {detailFresh && (
        <DishDetail
          meal={detailFresh}
          dishesById={dishesById}
          childrenByParent={childrenByParent}
          onOpen={m => setDetail(m)}
          onEdit={m => { setDetail(null); setModal({ editing: m }) }}
          onAddVariant={dish => { setDetail(null); setModal({ parent: dish }) }}
          onPlan={m => { setDetail(null); setPlanMeal(m) }}
          onDelete={deleteMeal}
          onClose={() => setDetail(null)}
        />
      )}
    </>
  )
}
