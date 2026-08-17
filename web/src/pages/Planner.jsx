import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase.js'
import { useApp } from '../App.jsx'
import { loadLarder, groupByCategory } from '../lib/larder.js'
import {
  deckState, formatCards, toHalves, unallocatedServings, sumNutrition,
  defaultPeriod, withinPeriod, periodsCovering, dealFromDeck, todayStr, addDays,
  requirementsForPeriod, NUTRIENTS,
} from '../lib/planner.js'
import { loadPlan, addComponent, allocate, unallocate, setComponentServings } from '../lib/planner-io.js'
import {
  AddToCookModal, TargetsModal, PeriodsModal, AnalyseModal, AllocateModal,
} from '../components/PlannerModals.jsx'

/**
 * Planner — the Calendar tab, with planning folded into it.
 *
 * With no period chosen it is just a calendar: every planned serving, all equally
 * prominent. Choose a period and the planning panels appear, that period's
 * servings come forward and the rest recede.
 *
 * Placing is tap-then-tap rather than drag: pick a card up, tap where it goes.
 * Drag is fiddly on a phone and worse with a rail of forty small targets.
 */

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

const fmtDay = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const dayOfWeek = d => (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7   // Mon = 0

function daysBetween(startsOn, endsOn) {
  const out = []
  for (let d = startsOn; d <= endsOn; d = addDays(d, 1)) out.push(d)
  return out
}

// ── Deck rail ────────────────────────────────────────────────────────────────
function DeckStack({ ing, state, onPick }) {
  const remaining = state?.remaining ?? 0
  const pending = state?.pending ?? 0
  const over = remaining < 0
  return (
    <button
      className={`deck-stack ${over ? 'deck-stack--over' : ''} ${toHalves(remaining) === 0 && !over ? 'deck-stack--spent' : ''}`}
      onClick={() => onPick(ing)}
      title={`${ing.name} — target ${formatCards(state?.target ?? 0)}, spent ${formatCards(state?.spent ?? 0)}` +
             (pending > 0 ? `, ${formatCards(pending)} cooked but not placed` : '') +
             (ing.card_weight ? ` · 1 card = ${ing.card_weight}g` : ' · no card weight set')}
    >
      <span className="deck-stack-name">{ing.name}</span>
      <span className="deck-stack-count">{formatCards(remaining)}</span>
      {pending > 0 && <span className="deck-stack-pending">+{formatCards(pending)} cooked</span>}
    </button>
  )
}

// ── Calendar ─────────────────────────────────────────────────────────────────
function DayCell({ date, allocations, components, ingredients, userRow, isToday, dim, held, onPlace, onRemove }) {
  const byId = new Map(components.map(c => [c.id, c]))
  const mine = allocations.filter(a => !a.for_user_id || a.for_user_id === userRow?.id)
  const { totals } = sumNutrition(mine, components, ingredients)
  const target = userRow?.target_protein_g ? Number(userRow.target_protein_g) : null
  const pct = target ? Math.min(100, (totals.protein / target) * 100) : 0

  return (
    <div className={`plan-day ${isToday ? 'plan-day--today' : ''} ${dim ? 'plan-day--dim' : ''} ${held ? 'plan-day--target' : ''}`}>
      <div className="plan-day-head">
        <span className="plan-day-date">{fmtDay(date)}</span>
        {target != null && (
          <span className="plan-day-bar" title={`${Math.round(totals.protein)}g of ${target}g protein`}>
            <span className="plan-day-bar-fill" style={{ width: `${pct}%` }} />
          </span>
        )}
      </div>
      {allocations.map(a => {
        const comp = byId.get(a.component_id)
        return (
          <button key={a.id} className="plan-alloc" onClick={() => onRemove(a)}
            title={`${comp?.name ?? '—'} · ${a.slot} · ${a.servings} serving(s) — click to take it off`}>
            <span className="plan-alloc-slot">{a.slot[0].toUpperCase()}</span>
            <span className="plan-alloc-name">{comp?.name ?? '—'}</span>
            {Number(a.servings) !== 1 && <span className="plan-alloc-qty">×{a.servings}</span>}
          </button>
        )
      })}
      {held && (
        <button className="plan-day-drop" onClick={() => onPlace(date)}>+ place here</button>
      )}
    </div>
  )
}

/**
 * A batch. The card is also the tray: pick it up, then tap the days its servings
 * go on, and watch the remaining count fall to zero.
 */
function ComponentRow({ component, allocations, held, onHold, onServings, onMark, onDelete }) {
  const left = unallocatedServings(component, allocations)
  const isHeld = held?.id === component.id
  const planned = Number(component.servings_planned)
  return (
    <div className={`cook-comp ${isHeld ? 'cook-comp--held' : ''} ${left <= 0 ? 'cook-comp--done' : ''}`}>
      <span className="name">{component.name}</span>
      {component.frozen && <span className="pill blue" style={{ fontSize: '.68rem' }}>❄ freezer</span>}
      {component.eaten && <span className="pill gray" style={{ fontSize: '.68rem' }}>eaten</span>}
      {component.gone && <span className="pill gray" style={{ fontSize: '.68rem' }}>gone</span>}
      <span className="meta">{formatCards(left)} of {formatCards(planned)} left</span>
      <span className="qty-step">
        <button type="button" disabled={planned <= 0.5} onClick={() => onServings(component, planned - 1)}>−</button>
        <span>{formatCards(planned)}</span>
        <button type="button" onClick={() => onServings(component, planned + 1)}>+</button>
      </span>
      <button className={`btn small ${isHeld ? '' : 'secondary'}`} disabled={left <= 0}
        onClick={() => onHold(isHeld ? null : component)}>
        {isHeld ? 'Holding' : 'Place'}
      </button>
      <details className="cook-comp-more">
        <summary>⋯</summary>
        <div className="cook-comp-menu">
          <button className="btn ghost small" onClick={() => onMark(component, { frozen: !component.frozen })}>
            {component.frozen ? 'Move to fridge' : '❄ To freezer'}
          </button>
          <button className="btn ghost small" onClick={() => onMark(component, { eaten: !component.eaten })}>
            {component.eaten ? 'Not eaten' : '✓ Eaten'}
          </button>
          <button className="btn ghost small" onClick={() => onMark(component, { gone: !component.gone })}>
            {component.gone ? 'Not gone' : 'Gone'}
          </button>
          <button className="btn ghost small" onClick={() => onDelete(component)}>Delete</button>
        </div>
      </details>
    </div>
  )
}

export default function Planner() {
  const { house, userRow } = useApp()

  const [loading, setLoading] = useState(true)
  const [ingredients, setIngredients] = useState([])
  const [categories, setCategories] = useState([])
  const [dishes, setDishes] = useState([])
  const [houseMembers, setHouseMembers] = useState([])
  const [plan, setPlan] = useState({ periods: [], cooks: [], components: [], allocations: [], targets: [] })

  const [periodId, setPeriodId] = useState('')
  const [activeCookId, setActiveCookId] = useState(null)
  const [held, setHeld] = useState(null)          // a component picked up, awaiting a day
  const [showPanels, setShowPanels] = useState(true)
  const [modal, setModal] = useState(null)
  const [msg, setMsg] = useState('')
  const [dealt, setDealt] = useState([])
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))

  const load = useCallback(async () => {
    setLoading(true)
    const [{ ingredients: ings, categories: cats }, p, { data: ds }, { data: hu }] = await Promise.all([
      loadLarder(house.id),
      loadPlan(house.id),
      supabase.from('meals').select('*').eq('house_id', house.id).order('name'),
      supabase.from('house_users').select('users(id, name, email, target_kcal, target_protein_g, target_fibre_g)').eq('house_id', house.id),
    ])
    setIngredients(ings); setCategories(cats); setPlan(p); setDishes(ds ?? [])
    setHouseMembers((hu ?? []).map(r => r.users).filter(Boolean))
    setPeriodId(id => id || String(defaultPeriod(p.periods)?.id ?? ''))
    setLoading(false)
  }, [house.id])

  useEffect(() => { load() }, [load])

  const period = plan.periods.find(p => String(p.id) === periodId) ?? null
  const planning = !!period

  const deck = useMemo(
    () => deckState({ period, ingredients, targets: plan.targets, components: plan.components, allocations: plan.allocations }),
    [period, ingredients, plan])

  // Only stacks the period actually has a target for belong in the rail.
  const deckIngredients = useMemo(
    () => ingredients.filter(i => deck[i.id]?.target > 0),
    [ingredients, deck])

  const sections = useMemo(() => groupByCategory(deckIngredients, categories), [deckIngredients, categories])

  const periodCooks = useMemo(
    () => plan.cooks.filter(c => !period || c.period_id === period.id),
    [plan.cooks, period])

  const activeCook = periodCooks.find(c => c.id === activeCookId) ?? periodCooks[0] ?? null

  // Carried-over food: cooked under another period, still waiting to be eaten.
  const carriedOver = useMemo(() => plan.components.filter(c =>
    !c.eaten && !c.gone &&
    c.cooks?.period_id !== period?.id &&
    unallocatedServings(c, plan.allocations) > 0), [plan, period])

  const days = period ? daysBetween(period.starts_on, period.ends_on) : []

  function say(m) { setMsg(m); if (m) setTimeout(() => setMsg(''), 4000) }

  // ── Cooks ─────────────────────────────────────────────────────────────────
  async function newCook(date = todayStr()) {
    const { data, error } = await supabase.from('cooks')
      .insert({ house_id: house.id, period_id: period?.id ?? null, cook_date: date })
      .select('*').single()
    if (error) { say(error.message); return null }
    setPlan(p => ({ ...p, cooks: [data, ...p.cooks] }))
    setActiveCookId(data.id)
    return data
  }

  async function ensureCook() {
    return activeCook ?? await newCook()
  }

  async function confirmAdd({ meal, ingredient, servings, perServing }) {
    const cook = await ensureCook()
    if (!cook) throw new Error('Could not start a cook session')

    let mealIngredients = []
    if (meal) {
      const { data } = await supabase.from('meal_ingredients')
        .select('ingredient_id, required_quantity, required_unit, qty_normalised').eq('meal_id', meal.id)
      mealIngredients = data ?? []
    }

    const comp = await addComponent({
      houseId: house.id,
      cookId: cook.id,
      meal: meal ?? null,
      ingredient: ingredient ?? null,
      perServing,
      servings,
      mealIngredients,
    })
    setPlan(p => ({ ...p, components: [...p.components, comp] }))
  }

  async function changeServings(component, next) {
    if (next < 0.5) { say('A batch has to make at least half a serving.'); return }
    try {
      await setComponentServings(component, next, plan.allocations)
      await load()
    } catch (e) { say(e.message) }
  }

  async function markComponent(component, patch) {
    await supabase.from('cook_components').update(patch).eq('id', component.id)
    setPlan(p => ({ ...p, components: p.components.map(c => c.id === component.id ? { ...c, ...patch } : c) }))
  }

  async function deleteComponent(component) {
    const placed = plan.allocations.filter(a => a.component_id === component.id).length
    if (placed && !window.confirm(`${placed} serving${placed === 1 ? '' : 's'} of ${component.name} are on the calendar. Remove it and them?`)) return
    await supabase.from('cook_components').delete().eq('id', component.id)
    setPlan(p => ({
      ...p,
      components: p.components.filter(c => c.id !== component.id),
      allocations: p.allocations.filter(a => a.component_id !== component.id),
    }))
  }

  // ── Placing servings ──────────────────────────────────────────────────────
  function placeOn(date) {
    const remaining = unallocatedServings(held, plan.allocations)
    if (remaining <= 0) { say('No servings left in that batch.'); setHeld(null); return }
    setModal({
      kind: 'allocate', component: held, date, remaining,
    })
  }

  async function confirmAllocate({ slot, servings, forUserId }) {
    const row = await allocate({
      houseId: house.id,
      component: modal.component,
      // Ownership follows the period being planned; the deck counts by date.
      periodId: period?.id ?? null,
      onDate: modal.date,
      slot, servings, forUserId,
    })
    setPlan(p => ({ ...p, allocations: [...p.allocations, row] }))
    const left = unallocatedServings(modal.component, [...plan.allocations, row])
    if (left <= 0) setHeld(null)
  }

  async function removeAllocation(a) {
    if (!window.confirm('Take this serving off the calendar?')) return
    await unallocate(a.id)
    setPlan(p => ({ ...p, allocations: p.allocations.filter(x => x.id !== a.id) }))
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) return <p className="empty">Loading…</p>

  const periodBar = (
    <div className="plan-bar">
      <label className="plan-bar-period">
        <span className="meta">Planning</span>
        <select value={periodId} onChange={e => { setPeriodId(e.target.value); setHeld(null) }}>
          <option value="">None — just the calendar</option>
          {plan.periods.map(p => (
            <option key={p.id} value={p.id}>
              {p.name || `${fmtDay(p.starts_on)} → ${fmtDay(p.ends_on)}`}
            </option>
          ))}
        </select>
      </label>
      <button className="btn small secondary" onClick={() => setModal({ kind: 'periods' })}>Edit periods</button>
      {planning && (
        <>
          <button className="btn small secondary" onClick={() => setShowPanels(v => !v)}>
            {showPanels ? 'Hide planning' : 'Show planning'}
          </button>
          <button className="btn small secondary" onClick={() => setModal({ kind: 'analyse' })}>Analyse plan</button>
          <button className="btn small" onClick={() => setModal({ kind: 'shop' })}>Done for now →</button>
        </>
      )}
    </div>
  )

  const deckRail = (
    <section className="plan-panel">
      <div className="plan-panel-head">
        <h3>Deck</h3>
        <span className="meta">
          {Object.values(deck).filter(s => s.target > 0 && s.remaining > 0).length} stacks left
        </span>
        <button className="btn small secondary" onClick={() => {
          setDealt(dealFromDeck(deck, deckIngredients, 6))
        }}>🎲 Deal</button>
        <button className="btn small secondary" onClick={() => setModal({ kind: 'targets' })}>Edit targets</button>
      </div>

      {dealt.length > 0 && (
        <div className="plan-dealt">
          <span className="meta">Dealt:</span>
          {dealt.map(i => (
            <button key={i.id} className="deck-stack deck-stack--dealt"
              onClick={() => setModal({ kind: 'add', target: { kind: 'ingredient', ingredient: i } })}>
              {i.name}
            </button>
          ))}
          <button className="btn small secondary" onClick={() => setDealt(dealFromDeck(deck, deckIngredients, 6))}>Again</button>
          <button className="btn small secondary" onClick={() => setDealt([])}>Clear</button>
        </div>
      )}

      {deckIngredients.length === 0 && (
        <p className="empty">No targets set for this period yet — “Edit targets” builds the deck.</p>
      )}

      {sections.map(sec => (
        <div key={sec.key} className="deck-group">
          <div className="deck-group-name">{sec.name}</div>
          <div className="deck-row">
            {sec.items.map(ing => (
              <DeckStack key={`${sec.key}-${ing.id}`} ing={ing} state={deck[ing.id]}
                onPick={i => setModal({ kind: 'add', target: { kind: 'ingredient', ingredient: i } })} />
            ))}
          </div>
        </div>
      ))}
    </section>
  )

  const dishShelf = (
    <section className="plan-panel">
      <div className="plan-panel-head"><h3>Dishes</h3></div>
      {dishes.filter(d => !d.parent_id).length === 0 && <p className="empty">No dishes yet.</p>}
      <div className="dish-shelf">
        {dishes.filter(d => !d.parent_id).map(d => (
          <button key={d.id} className="dish-chip"
            onClick={() => setModal({ kind: 'add', target: { kind: 'dish', meal: d } })}>
            <span className="dish-chip-name">{d.name}</span>
            {d.dish_type && <span className="meta">{d.dish_type}</span>}
            {d.servings && <span className="meta">makes {d.servings}</span>}
          </button>
        ))}
      </div>
    </section>
  )

  const cookPanel = (
    <section className="plan-panel">
      <div className="plan-panel-head">
        <h3>Cook sessions</h3>
        <button className="btn small secondary" onClick={() => newCook()}>+ New session</button>
      </div>

      {periodCooks.length === 0 && <p className="empty">No cook sessions yet. Add a dish or an ingredient to start one.</p>}

      {periodCooks.map(cook => {
        const comps = plan.components.filter(c => c.cook_id === cook.id)
        const unplaced = comps.reduce((t, c) => t + unallocatedServings(c, plan.allocations), 0)
        const isActive = activeCook?.id === cook.id
        return (
          <div key={cook.id} className={`cook-session ${isActive ? 'cook-session--active' : ''}`}>
            <button className="cook-session-head" onClick={() => setActiveCookId(cook.id)}>
              <input type="date" value={cook.cook_date} onClick={e => e.stopPropagation()}
                onChange={async e => {
                  await supabase.from('cooks').update({ cook_date: e.target.value }).eq('id', cook.id)
                  setPlan(p => ({ ...p, cooks: p.cooks.map(c => c.id === cook.id ? { ...c, cook_date: e.target.value } : c) }))
                }} />
              {isActive && <span className="pill blue" style={{ fontSize: '.68rem' }}>adding here</span>}
              {unplaced > 0 && <span className="pill orange" style={{ fontSize: '.68rem' }}>{formatCards(unplaced)} unplaced</span>}
            </button>
            {comps.map(c => <ComponentRow key={c.id} component={c} allocations={plan.allocations} held={held} onHold={setHeld} onServings={changeServings} onMark={markComponent} onDelete={deleteComponent} />)}
            {comps.length === 0 && <p className="empty" style={{ margin: '.3rem 0' }}>Empty session.</p>}
          </div>
        )
      })}

      {carriedOver.length > 0 && (
        <div className="cook-session cook-session--carried">
          <div className="cook-session-head"><strong>From another period</strong></div>
          {carriedOver.map(c => <ComponentRow key={c.id} component={c} allocations={plan.allocations} held={held} onHold={setHeld} onServings={changeServings} onMark={markComponent} onDelete={deleteComponent} />)}
        </div>
      )}
    </section>
  )

  // Calendar: the period's days when planning, otherwise a plain month.
  const calendar = planning ? (
    <section className="plan-panel">
      <div className="plan-panel-head">
        <h3>{period.name || `${fmtDay(period.starts_on)} → ${fmtDay(period.ends_on)}`}</h3>
        {held && <span className="pill blue">Holding {held.name} — tap a day</span>}
        {held && <button className="btn small secondary" onClick={() => setHeld(null)}>Cancel</button>}
      </div>
      <div className="plan-week-grid">
        {days.map(d => (
          <DayCell key={d} date={d}
            allocations={plan.allocations.filter(a => a.on_date === d)}
            components={plan.components} ingredients={ingredients} userRow={userRow}
            isToday={d === todayStr()}
            dim={false}
            held={held} onPlace={placeOn} onRemove={removeAllocation} />
        ))}
      </div>
    </section>
  ) : (
    <MonthCalendar month={month} setMonth={setMonth} plan={plan} ingredients={ingredients}
      userRow={userRow} onRemove={removeAllocation} />
  )

  return (
    <>
      {periodBar}
      {msg && <p className="msg err">{msg}</p>}

      {!planning && plan.periods.length === 0 && (
        <p className="muted-note">
          No periods yet. <strong>Edit periods</strong> creates one — a fortnight from today by
          default — and the planning panels appear once you select it.
        </p>
      )}

      {planning && showPanels && (
        <>
          {deckRail}
          <div className="plan-two-col">
            {dishShelf}
            {cookPanel}
          </div>
        </>
      )}

      {calendar}

      {modal?.kind === 'add' && (
        <AddToCookModal target={modal.target} dishes={dishes}
          onClose={() => setModal(null)} onConfirm={confirmAdd} />
      )}
      {modal?.kind === 'allocate' && (
        <AllocateModal component={modal.component} date={modal.date} remaining={modal.remaining}
          houseMembers={houseMembers} defaultUserId={userRow?.id}
          onClose={() => setModal(null)} onConfirm={confirmAllocate} />
      )}
      {modal?.kind === 'targets' && period && (
        <TargetsModal period={period} ingredients={ingredients} targets={plan.targets}
          onClose={() => setModal(null)} onSaved={load} />
      )}
      {modal?.kind === 'periods' && (
        <PeriodsModal houseId={house.id} periods={plan.periods} allocations={plan.allocations}
          onClose={() => setModal(null)} onSaved={load} />
      )}
      {modal?.kind === 'analyse' && (
        <AnalyseModal days={days} allocations={plan.allocations} components={plan.components}
          ingredients={ingredients} userRow={userRow} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'shop' && (
        <ShopHandoff period={period} plan={plan} ingredients={ingredients} houseId={house.id}
          onClose={() => setModal(null)} onDone={load} />
      )}
    </>
  )
}

// ── Plain month view (no period selected) ────────────────────────────────────
function MonthCalendar({ month, setMonth, plan, ingredients, userRow, onRemove }) {
  const [y, m] = month.split('-').map(Number)
  const first = `${month}-01`
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const pad = dayOfWeek(first)
  const cells = [...Array(pad).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)]
  while (cells.length % 7) cells.push(null)

  const shift = delta => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1))
    setMonth(d.toISOString().slice(0, 7))
  }

  const byId = new Map(plan.components.map(c => [c.id, c]))

  return (
    <section className="plan-panel">
      <div className="plan-panel-head">
        <button className="btn small secondary" onClick={() => shift(-1)}>‹</button>
        <h3 style={{ flex: 1, textAlign: 'center' }}>{MONTHS[m - 1]} {y}</h3>
        <button className="btn small secondary" onClick={() => shift(1)}>›</button>
      </div>
      <div className="month-grid">
        {DAY_NAMES.map(d => <div key={d} className="month-dow">{d}</div>)}
        {cells.map((date, i) => {
          if (!date) return <div key={`pad${i}`} className="month-cell month-cell--pad" />
          const allocs = plan.allocations.filter(a => a.on_date === date)
          return (
            <div key={date} className={`month-cell ${date === todayStr() ? 'month-cell--today' : ''}`}>
              <div className="month-cell-date">{Number(date.slice(-2))}</div>
              {allocs.map(a => (
                <button key={a.id} className="plan-alloc" onClick={() => onRemove(a)}
                  title={`${byId.get(a.component_id)?.name ?? ''} · ${a.slot}`}>
                  <span className="plan-alloc-name">{byId.get(a.component_id)?.name ?? '—'}</span>
                </button>
              ))}
            </div>
          )
        })}
      </div>
      {plan.allocations.length === 0 && (
        <p className="empty">Nothing planned yet. Choose a period above to start planning.</p>
      )}
    </section>
  )
}

// ── Done for now → the shop ──────────────────────────────────────────────────
/**
 * What this period's cooks need, ready to be ticked onto a shop. A period
 * always ends up with at least one shop, and can gain more later — it never
 * closes.
 */
function ShopHandoff({ period, plan, ingredients, houseId, onClose, onDone }) {
  const need = useMemo(() => requirementsForPeriod(period, plan.components), [period, plan.components])
  const rows = Object.entries(need)
    .map(([id, grams]) => ({ ing: ingredients.find(i => i.id === Number(id)), grams }))
    .filter(r => r.ing)
    .sort((a, b) => a.ing.name.localeCompare(b.ing.name))

  // Default to the things the house hasn't got in.
  const [picked, setPicked] = useState(() =>
    Object.fromEntries(rows.filter(r => !r.ing.has_any).map(r => [r.ing.id, true])))
  const [lists, setLists] = useState([])
  const [listId, setListId] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    supabase.from('shopping_lists')
      .select('id, status, purchased_on, period_id, stores(name)')
      .eq('house_id', houseId).in('status', ['building', 'shopping'])
      .then(({ data }) => setLists(data ?? []))
  }, [houseId])

  async function go() {
    setBusy(true); setErr('')
    try {
      let targetId = listId
      if (!targetId) {
        const { data, error } = await supabase.from('shopping_lists').insert({
          house_id: houseId, status: 'shopping', source: 'manual',
          purchased_on: new Date().toISOString().slice(0, 10), period_id: period.id,
        }).select('id').single()
        if (error) throw new Error(error.message)
        targetId = data.id
      } else {
        await supabase.from('shopping_lists').update({ period_id: period.id }).eq('id', targetId)
      }

      const chosen = rows.filter(r => picked[r.ing.id])
      if (chosen.length) {
        const { data: existing } = await supabase.from('shopping_list_items')
          .select('ingredient_id').eq('list_id', targetId).eq('bought', false)
        const already = new Set((existing ?? []).map(r => r.ingredient_id))
        const fresh = chosen.filter(r => !already.has(r.ing.id))
        if (fresh.length) {
          const { error } = await supabase.from('shopping_list_items').insert(fresh.map(r => ({
            house_id: houseId, list_id: targetId, ingredient_id: r.ing.id,
            quantity: 1, auto_generated: false, bought: false, source: 'manual',
          })))
          if (error) throw new Error(error.message)
        }
      }
      await onDone()
      onClose()
    } catch (e) { setErr(e.message); setBusy(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 620 }}>
        <div className="modal-header">
          <h2>What this period needs</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <p className="muted-note">
          Everything your planned cooks call for. Things already in the house start unticked.
          Nothing here freezes the plan — you can come back and add another shop any time.
        </p>

        <label>Add to
          <select value={listId} onChange={e => setListId(e.target.value)}>
            <option value="">— a new shop —</option>
            {lists.map(l => (
              <option key={l.id} value={l.id}>
                {l.stores?.name ?? 'Shop'} · {l.purchased_on ?? 'in progress'}{l.period_id ? ' (already on a period)' : ''}
              </option>
            ))}
          </select>
        </label>

        <div className="targets-scroll" style={{ marginTop: '.5rem' }}>
          {rows.length === 0 && <p className="empty">This period's cooks don't need anything yet.</p>}
          {rows.map(r => (
            <label key={r.ing.id} className="shop-need-row">
              <input type="checkbox" checked={!!picked[r.ing.id]}
                onChange={() => setPicked(p => ({ ...p, [r.ing.id]: !p[r.ing.id] }))} />
              <span className="name">{r.ing.name}</span>
              <span className="meta">{Math.round(r.grams)}g planned</span>
              {r.ing.has_any && <span className="pill green" style={{ fontSize: '.68rem' }}>in the house</span>}
            </label>
          ))}
        </div>

        {err && <p className="msg err">{err}</p>}
        <div className="btn-row">
          <button className="btn" onClick={go} disabled={busy}>
            {busy ? <span className="spinner" /> : 'Add to shop'}
          </button>
          <button className="btn secondary" onClick={onClose}>Not now</button>
        </div>
      </div>
    </div>
  )
}
