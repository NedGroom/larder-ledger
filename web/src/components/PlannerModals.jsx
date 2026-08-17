import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import {
  NUTRIENTS, SLOTS, formatCards, toHalves, sumNutrition,
  newPeriodDates, allocationsStranded, todayStr, addDays,
} from '../lib/planner.js'

/**
 * The planner's dialogs, kept out of Planner.jsx so that file stays about
 * layout and flow rather than forms.
 */

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { maxWidth: 760 } : undefined}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ── Adding something to a cook ───────────────────────────────────────────────
/**
 * The highest-friction moment in the whole flow, so it stays one screen.
 *
 * A dish already knows its proportions, so it only asks how many servings (and
 * which variant). A bare ingredient has to ask both how much per serving and
 * how many servings — those two numbers are exactly what the debit needs.
 */
export function AddToCookModal({ target, dishes, onClose, onConfirm }) {
  const isDish = target.kind === 'dish'
  const variants = isDish ? dishes.filter(d => d.parent_id === target.meal.id) : []

  const [mealId, setMealId] = useState(target.meal?.id ?? null)
  const [servings, setServings] = useState(isDish ? (target.meal.servings || 4) : 4)
  const [perServing, setPerServing] = useState(target.ingredient?.card_weight || 80)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const chosen = isDish ? (dishes.find(d => d.id === mealId) ?? target.meal) : null
  const scale = chosen?.servings ? Number(servings) / Number(chosen.servings) : null

  async function confirm() {
    setBusy(true); setErr('')
    try {
      await onConfirm({
        meal: chosen,
        ingredient: target.ingredient ?? null,
        servings: Number(servings),
        perServing: Number(perServing),
      })
      onClose()
    } catch (e) { setErr(e.message); setBusy(false) }
  }

  return (
    <Modal title={`Add ${target.meal?.name ?? target.ingredient?.name} to the cook`} onClose={onClose}>
      {isDish && variants.length > 0 && (
        <label>Which version
          <select value={mealId ?? ''} onChange={e => setMealId(Number(e.target.value))}>
            <option value={target.meal.id}>{target.meal.name} (as saved)</option>
            {variants.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
      )}

      <div className="field-row">
        <label style={{ maxWidth: 140 }}>Servings to make
          <input type="number" min="0.5" step="0.5" value={servings} onChange={e => setServings(e.target.value)} />
        </label>
        {!isDish && (
          <label style={{ maxWidth: 170 }}>Amount per serving (g/ml)
            <input type="number" min="1" step="1" value={perServing} onChange={e => setPerServing(e.target.value)} />
          </label>
        )}
      </div>

      {isDish && chosen?.servings > 0 && Number(servings) !== Number(chosen.servings) && (
        <p className="muted-note">
          The recipe makes {chosen.servings}. Every ingredient is scaled ×{scale.toFixed(2)} for this cook.
        </p>
      )}
      {!isDish && target.ingredient && (
        <p className="muted-note">
          {formatCards((Number(perServing) * Number(servings)) / (Number(target.ingredient.card_weight) || 80))} card
          {' '}will be spent as these servings are placed on days.
        </p>
      )}

      {err && <p className="msg err">{err}</p>}
      <div className="btn-row">
        <button className="btn" onClick={confirm} disabled={busy || !(Number(servings) > 0)}>
          {busy ? <span className="spinner" /> : 'Add to cook'}
        </button>
        <button className="btn secondary" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  )
}

// ── Editing the period's targets ─────────────────────────────────────────────
/**
 * Where the shape of a period is defined — how many cards of each thing you're
 * aiming for, and what one card is worth. Deliberately reachable from the end
 * of the deck rail rather than buried in settings: it should feel like editing
 * the deck.
 */
export function TargetsModal({ period, ingredients, targets, onClose, onSaved }) {
  const [rows, setRows] = useState(() =>
    ingredients.map(i => ({
      id: i.id,
      name: i.name,
      card_weight: i.card_weight ?? '',
      target_cards: targets.find(t => t.period_id === period.id && t.ingredient_id === i.id)?.target_cards ?? '',
    })))
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const set = (id, field, value) => setRows(rs => rs.map(r => r.id === id ? { ...r, [field]: value } : r))
  const visible = rows.filter(r => !q || r.name.toLowerCase().includes(q.toLowerCase()))

  async function save() {
    setSaving(true); setErr('')
    try {
      for (const r of rows) {
        const before = ingredients.find(i => i.id === r.id)
        const weight = r.card_weight === '' ? null : Number(r.card_weight)
        if ((before.card_weight ?? null) !== weight) {
          await supabase.from('ingredients').update({ card_weight: weight }).eq('id', r.id)
        }

        const existing = targets.find(t => t.period_id === period.id && t.ingredient_id === r.id)
        const wanted = r.target_cards === '' ? null : Number(r.target_cards)
        if (wanted == null && existing) {
          await supabase.from('ingredient_targets').delete().eq('id', existing.id)
        } else if (wanted != null && !existing) {
          await supabase.from('ingredient_targets')
            .insert({ period_id: period.id, ingredient_id: r.id, target_cards: wanted })
        } else if (wanted != null && existing && Number(existing.target_cards) !== wanted) {
          await supabase.from('ingredient_targets').update({ target_cards: wanted }).eq('id', existing.id)
        }
      }
      await onSaved()
      onClose()
    } catch (e) { setErr(e.message); setSaving(false) }
  }

  return (
    <Modal title={`Targets for ${period.name || 'this period'}`} onClose={onClose} wide>
      <p className="muted-note">
        How many cards of each thing this period is aiming for, and what one card weighs.
        Leave a target blank to keep something out of the deck entirely.
      </p>
      <input type="search" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} />
      <div className="targets-grid-head">
        <span>Ingredient</span><span>Cards</span><span>1 card = (g/ml)</span>
      </div>
      <div className="targets-scroll">
        {visible.map(r => (
          <div key={r.id} className="targets-row">
            <span className="name">{r.name}</span>
            <input type="number" min="0" step="0.5" value={r.target_cards}
              onChange={e => set(r.id, 'target_cards', e.target.value)} placeholder="—" />
            <input type="number" min="1" step="1" value={r.card_weight}
              onChange={e => set(r.id, 'card_weight', e.target.value)} placeholder="80" />
          </div>
        ))}
      </div>
      {err && <p className="msg err">{err}</p>}
      <div className="btn-row">
        <button className="btn" onClick={save} disabled={saving}>
          {saving ? <span className="spinner" /> : 'Save targets'}
        </button>
        <button className="btn secondary" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  )
}

// ── Managing periods ─────────────────────────────────────────────────────────
export function PeriodsModal({ houseId, periods, allocations, onClose, onSaved }) {
  const [rows, setRows] = useState(() => periods.map(p => ({ ...p })))
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  const set = (id, field, value) => setRows(rs => rs.map(r => r.id === id ? { ...r, [field]: value } : r))

  function addRow() {
    const { starts_on, ends_on } = newPeriodDates()
    setRows(rs => [{ id: `new-${Date.now()}`, _new: true, name: '', starts_on, ends_on }, ...rs])
  }

  async function save() {
    setSaving(true); setErr('')
    try {
      for (const r of rows) {
        if (r.ends_on < r.starts_on) throw new Error(`"${r.name || 'Period'}" ends before it starts.`)

        if (r._new) {
          const { error } = await supabase.from('periods').insert({
            house_id: houseId, name: r.name || null, starts_on: r.starts_on, ends_on: r.ends_on,
          })
          if (error) throw new Error(error.message)
          continue
        }

        const original = periods.find(p => p.id === r.id)
        if (original.starts_on === r.starts_on && original.ends_on === r.ends_on && original.name === r.name) continue

        // Shrinking a period must not orphan servings that are already placed.
        const stranded = allocationsStranded(original, r, allocations)
        if (stranded.length) {
          throw new Error(
            `"${r.name || 'Period'}" would leave ${stranded.length} planned serving${stranded.length === 1 ? '' : 's'} ` +
            `outside it (${stranded.map(a => a.on_date).slice(0, 3).join(', ')}). Move them first.`)
        }
        const { error } = await supabase.from('periods')
          .update({ name: r.name || null, starts_on: r.starts_on, ends_on: r.ends_on }).eq('id', r.id)
        if (error) throw new Error(error.message)
      }
      await onSaved()
      onClose()
    } catch (e) { setErr(e.message); setSaving(false) }
  }

  async function remove(row) {
    if (row._new) { setRows(rs => rs.filter(r => r.id !== row.id)); return }
    const mine = allocations.filter(a => a.period_id === row.id).length
    const ok = window.confirm(
      mine
        ? `Delete "${row.name || 'this period'}"? ${mine} planned serving${mine === 1 ? '' : 's'} will stay on the calendar but belong to no period.`
        : `Delete "${row.name || 'this period'}"?`)
    if (!ok) return
    await supabase.from('periods').delete().eq('id', row.id)
    setRows(rs => rs.filter(r => r.id !== row.id))
    await onSaved()
  }

  return (
    <Modal title="Periods" onClose={onClose} wide>
      <p className="muted-note">
        Periods are yours to shape and may overlap — a day covered by two of them counts toward both.
      </p>
      <button className="btn small" onClick={addRow}>+ New period</button>
      <div className="targets-scroll" style={{ marginTop: '.5rem' }}>
        {rows.length === 0 && <p className="empty">No periods yet.</p>}
        {rows.map(r => (
          <div key={r.id} className="period-row">
            <input value={r.name ?? ''} onChange={e => set(r.id, 'name', e.target.value)} placeholder="Name (optional)" />
            <input type="date" value={r.starts_on} onChange={e => set(r.id, 'starts_on', e.target.value)} />
            <input type="date" value={r.ends_on} onChange={e => set(r.id, 'ends_on', e.target.value)} />
            <button className="btn small secondary" onClick={() => remove(r)}>✕</button>
          </div>
        ))}
      </div>
      {err && <p className="msg err">{err}</p>}
      <div className="btn-row">
        <button className="btn" onClick={save} disabled={saving}>
          {saving ? <span className="spinner" /> : 'Save periods'}
        </button>
        <button className="btn secondary" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  )
}

// ── Analyse ──────────────────────────────────────────────────────────────────
/**
 * What the plan adds up to. Targets are personal, so this reads the logged-in
 * user's and counts only what's allocated to them; anything with no nutrient
 * data recorded is called out rather than quietly treated as zero.
 */
export function AnalyseModal({ days, allocations, components, ingredients, userRow, onClose }) {
  const [scope, setScope] = useState('day')
  const mine = allocations.filter(a => !a.for_user_id || a.for_user_id === userRow?.id)

  const groups = scope === 'day'
    ? days.map(d => ({ key: d, label: d, rows: mine.filter(a => a.on_date === d) }))
    : (() => {
        const weeks = []
        for (let i = 0; i < days.length; i += 7) {
          const slice = days.slice(i, i + 7)
          weeks.push({
            key: slice[0],
            label: `${slice[0]} → ${slice[slice.length - 1]}`,
            rows: mine.filter(a => slice.includes(a.on_date)),
            span: slice.length,
          })
        }
        return weeks
      })()

  return (
    <Modal title="Analyse plan" onClose={onClose} wide>
      <div className="btn-row" style={{ marginTop: 0 }}>
        <button className={`btn small ${scope === 'day' ? '' : 'secondary'}`} onClick={() => setScope('day')}>Per day</button>
        <button className={`btn small ${scope === 'week' ? '' : 'secondary'}`} onClick={() => setScope('week')}>Per week</button>
      </div>
      <p className="muted-note">
        Counting what's allocated to {userRow?.name || 'you'} (plus anything unassigned), against your own targets.
      </p>

      <div className="targets-scroll">
        <div className="analyse-head">
          <span>{scope === 'day' ? 'Day' : 'Week'}</span>
          {NUTRIENTS.map(n => <span key={n.key}>{n.label}</span>)}
        </div>
        {groups.map(g => {
          const { totals, missing } = sumNutrition(g.rows, components, ingredients)
          const multiplier = scope === 'week' ? (g.span ?? 7) : 1
          return (
            <div key={g.key} className="analyse-row">
              <span className="name">
                {g.label}
                {missing.length > 0 && (
                  <span className="meta" title={`No nutrient data: ${missing.join(', ')}`}> · {missing.length} unknown</span>
                )}
              </span>
              {NUTRIENTS.map(n => {
                const target = n.target && userRow?.[n.target] ? Number(userRow[n.target]) * multiplier : null
                const value = totals[n.key]
                const short = target != null && value < target
                return (
                  <span key={n.key} className={`analyse-val ${target != null ? (short ? 'analyse-val--under' : 'analyse-val--ok') : ''}`}>
                    {Math.round(value)}{target != null ? ` / ${Math.round(target)}` : ''}
                  </span>
                )
              })}
            </div>
          )
        })}
      </div>

      {!NUTRIENTS.some(n => n.target && userRow?.[n.target]) && (
        <p className="muted-note">
          No personal targets set yet — add them in Settings and the figures above get something to measure against.
        </p>
      )}
    </Modal>
  )
}

// ── Placing a serving ────────────────────────────────────────────────────────
export function AllocateModal({ component, date, remaining, houseMembers, defaultUserId, onClose, onConfirm }) {
  const [slot, setSlot] = useState('dinner')
  const [servings, setServings] = useState(Math.min(1, remaining))
  const [forUserId, setForUserId] = useState(defaultUserId ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function confirm() {
    setBusy(true); setErr('')
    try {
      await onConfirm({ slot, servings: Number(servings), forUserId: forUserId || null })
      onClose()
    } catch (e) { setErr(e.message); setBusy(false) }
  }

  return (
    <Modal title={`${component.name} on ${date}`} onClose={onClose}>
      <div className="field-row">
        <label>Slot
          <select value={slot} onChange={e => setSlot(e.target.value)}>
            {SLOTS.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
        </label>
        <label style={{ maxWidth: 120 }}>Servings
          <input type="number" min="0.5" step="0.5" max={remaining} value={servings}
            onChange={e => setServings(e.target.value)} />
        </label>
        <label>For
          <select value={forUserId} onChange={e => setForUserId(e.target.value)}>
            <option value="">— anyone —</option>
            {houseMembers.map(m => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
          </select>
        </label>
      </div>
      <p className="muted-note">{formatCards(remaining)} serving{toHalves(remaining) === 1 ? '' : 's'} left in this batch.</p>
      {err && <p className="msg err">{err}</p>}
      <div className="btn-row">
        <button className="btn" onClick={confirm} disabled={busy || !(Number(servings) > 0)}>
          {busy ? <span className="spinner" /> : 'Place it'}
        </button>
        <button className="btn secondary" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  )
}
