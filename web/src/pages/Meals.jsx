import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import { suggestNormalised, todayStr, periodsCovering } from '../lib/planner.js'
import { addComponent, allocate } from '../lib/planner-io.js'
import { CategoryPicker } from '../components/IngredientPanel.jsx'
import { findOrCreateCategory } from '../lib/larder.js'
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
  // ingredient_id → { checked, quantity, unit, normalised }
  // `quantity`+`unit` are how the recipe is written; `normalised` is the same
  // amount in g/ml for the whole dish, which is what the deck and the nutrient
  // sums actually run on. Blank normalised simply counts as zero.
  const [selected, setSelected] = useState({})
  const [categories, setCategories] = useState([])
  const [catIds, setCatIds] = useState([])
  const [search, setSearch] = useState('')
  const [showQuickAdd, setShowQuickAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    supabase.from('ingredients').select('*').eq('house_id', houseId).order('name')
      .then(({ data }) => setAllIngredients(data ?? []))
    supabase.from('categories').select('*').eq('house_id', houseId).order('name')
      .then(({ data }) => setCategories(data ?? []))
    if (editing) {
      supabase.from('meal_ingredients').select('ingredient_id, required_quantity, required_unit, qty_normalised').eq('meal_id', editing.id)
        .then(({ data }) => {
          const sel = {}
          for (const r of (data ?? [])) sel[r.ingredient_id] = {
            checked: true,
            quantity: r.required_quantity ?? '',
            unit: r.required_unit ?? '',
            normalised: r.qty_normalised ?? '',
          }
          setSelected(sel)
        })
      supabase.from('meal_categories').select('category_id').eq('meal_id', editing.id)
        .then(({ data }) => setCatIds((data ?? []).map(r => r.category_id)))
    }
  }, [houseId, editing])

  function toggleIngredient(id) {
    setSelected(prev => ({ ...prev, [id]: prev[id] ? { ...prev[id], checked: !prev[id].checked } : { checked: true, quantity: '', unit: '', normalised: '' } }))
  }

  // Typing a quantity re-derives the g/ml figure where the unit allows it, but
  // never overwrites a number the user has set by hand.
  function setQty(id, qty) {
    setSelected(prev => {
      const row = prev[id] ?? { checked: true }
      const unit = row.unit || allIngredients.find(i => i.id === id)?.canonical_unit || ''
      const auto = suggestNormalised(qty, unit)
      const keepManual = row._manualNorm
      return { ...prev, [id]: { ...row, quantity: qty, normalised: keepManual ? row.normalised : (auto ?? row.normalised ?? '') } }
    })
  }
  const setNorm = (id, value) =>
    setSelected(prev => ({ ...prev, [id]: { ...prev[id], normalised: value, _manualNorm: true } }))

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
      qty_normalised: v.normalised === '' || v.normalised == null ? null : +v.normalised,
    }))
    if (links.length) {
      const { error: linkErr } = await supabase.from('meal_ingredients').insert(links)
      if (linkErr) { setErr(linkErr.message); setSaving(false); return }
    }

    await supabase.from('meal_categories').delete().eq('meal_id', mealId)
    if (catIds.length) {
      const { error: catErr } = await supabase.from('meal_categories')
        .insert(catIds.map(category_id => ({ meal_id: mealId, category_id })))
      if (catErr) { setErr(catErr.message); setSaving(false); return }
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
          <p className="muted-note">
            Quantities are for the whole dish. The <strong>g/ml</strong> column is what the planner counts —
            it fills itself in for units it understands, and you can type it for the ones it can't ("2 tins").
          </p>
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
                      <input type="number" className="ing-norm" placeholder="g/ml"
                        title={`Total for the whole dish, in g or ml — this is what the deck and nutrients use.${ing.qualitative_note ? ` (${ing.qualitative_note})` : ''}`}
                        value={sel.normalised ?? ''} onChange={e => setNorm(ing.id, e.target.value)} min="0" step="any" />
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

          <h3 style={{ marginTop: '.9rem' }}>Categories <span className="meta">(cuisine, or however you group dishes)</span></h3>
          <CategoryPicker
            houseId={houseId}
            categories={categories}
            selectedIds={catIds}
            onChange={setCatIds}
            onCategoriesChanged={cat => setCategories(prev => prev.some(c => c.id === cat.id) ? prev : [...prev, cat].sort((a, b) => a.name.localeCompare(b.name)))}
          />

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

// ── Plan a dish onto a date ───────────────────────────────────────────────────
/**
 * The shortcut for "I want this on Thursday", without opening the planner.
 *
 * It does the same thing the planner does, just condensed: a cook session on
 * the chosen day, one serving placed on it, and the rest of the batch left
 * unallocated for you to spread later. The period is inferred from the date —
 * with a choice offered where two of them overlap.
 */
function PlanModal({ meal, houseId, onClose, onSaved }) {
  const [date, setDate] = useState(todayStr())
  const [slot, setSlot] = useState('dinner')
  const [servings, setServings] = useState(meal.servings || 4)
  const [periods, setPeriods] = useState([])
  const [periodId, setPeriodId] = useState('')
  const [ingredients, setIngredients] = useState([])
  const [checked, setChecked] = useState({})
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    supabase.from('meal_ingredients')
      .select('ingredient_id, required_quantity, required_unit, qty_normalised, ingredients(name, has_any)')
      .eq('meal_id', meal.id)
      .then(({ data }) => {
        setIngredients(data ?? [])
        // Default to buying whatever the house hasn't got in.
        setChecked(Object.fromEntries((data ?? []).filter(i => !i.ingredients?.has_any).map(i => [i.ingredient_id, true])))
      })
    supabase.from('periods').select('*').eq('house_id', houseId).order('starts_on', { ascending: false })
      .then(({ data }) => setPeriods(data ?? []))
  }, [meal.id, houseId])

  // Which periods cover the chosen day — usually one, sometimes two.
  const covering = periodsCovering(periods, date)
  useEffect(() => {
    setPeriodId(prev => (covering.some(p => String(p.id) === prev) ? prev : String(covering[0]?.id ?? '')))
  }, [date, periods.length])   // eslint-disable-line react-hooks/exhaustive-deps

  async function save(e) {
    e.preventDefault()
    if (!date) { setErr('Pick a date'); return }
    setSaving(true); setErr('')
    try {
      const period = periods.find(p => String(p.id) === periodId) ?? null

      const { data: cook, error: cookErr } = await supabase.from('cooks')
        .insert({ house_id: houseId, period_id: period?.id ?? null, cook_date: date })
        .select('id').single()
      if (cookErr) throw new Error(cookErr.message)

      const component = await addComponent({
        houseId, cookId: cook.id, meal, servings: Number(servings), mealIngredients: ingredients,
      })

      // One serving lands on the day you picked; the rest wait in the planner.
      await allocate({
        houseId, component, periodId: period?.id ?? null,
        onDate: date, slot, servings: 1,
      })

      const toAdd = ingredients.filter(i => checked[i.ingredient_id])
      if (toAdd.length) {
        let { data: list } = await supabase.from('shopping_lists')
          .select('id').eq('house_id', houseId).in('status', ['building', 'shopping'])
          .order('created_at', { ascending: false }).limit(1).maybeSingle()
        if (!list) {
          const { data: created, error: listErr } = await supabase.from('shopping_lists')
            .insert({
              house_id: houseId, status: 'shopping', source: 'manual',
              purchased_on: todayStr(), period_id: period?.id ?? null,
            }).select('id').single()
          if (listErr) throw new Error(listErr.message)
          list = created
        }
        const { data: existing } = await supabase.from('shopping_list_items')
          .select('ingredient_id').eq('list_id', list.id).eq('bought', false)
        const already = new Set((existing ?? []).map(r => r.ingredient_id))
        const rows = toAdd.filter(i => !already.has(i.ingredient_id)).map(i => ({
          house_id: houseId, list_id: list.id, ingredient_id: i.ingredient_id,
          quantity: 1, auto_generated: false, meal_id: meal.id, bought: false, source: 'manual',
        }))
        if (rows.length) {
          const { error: shopErr } = await supabase.from('shopping_list_items').insert(rows)
          if (shopErr) throw new Error(shopErr.message)
        }
      }
      setSaving(false)
      onSaved()
    } catch (e2) { setErr(e2.message); setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2>Plan: {meal.name}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={save}>
          <div className="field-row">
            <label>Date
              <input type="date" value={date} onChange={e => setDate(e.target.value)} required />
            </label>
            <label style={{ maxWidth: 140 }}>Slot
              <select value={slot} onChange={e => setSlot(e.target.value)}>
                <option value="breakfast">Breakfast</option>
                <option value="lunch">Lunch</option>
                <option value="dinner">Dinner</option>
              </select>
            </label>
            <label style={{ maxWidth: 120 }}>Servings
              <input type="number" min="1" step="1" value={servings} onChange={e => setServings(e.target.value)} />
            </label>
          </div>

          {covering.length > 1 && (
            <label>Which period
              <select value={periodId} onChange={e => setPeriodId(e.target.value)}>
                {covering.map(p => (
                  <option key={p.id} value={p.id}>{p.name || `${p.starts_on} → ${p.ends_on}`}</option>
                ))}
              </select>
            </label>
          )}
          <p className="muted-note">
            {covering.length === 0
              ? 'No period covers that date, so this is planned outside any of them.'
              : `One serving goes on ${date}; the other ${Math.max(0, Number(servings) - 1)} wait in the planner.`}
          </p>

          {ingredients.length > 0 && (
            <>
              <h3 style={{ marginTop: '.8rem' }}>Add to shopping list</h3>
              <p className="meta" style={{ margin: '-.2rem 0 .5rem' }}>Things you already have start unticked.</p>
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
            <button className="btn" type="submit" disabled={saving}>{saving ? <span className="spinner" /> : 'Plan it'}</button>
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
