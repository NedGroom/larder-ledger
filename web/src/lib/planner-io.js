import { supabase } from './supabase.js'
import { scaleRecipe, todayStr } from './planner.js'

/**
 * planner-io.js — reading and writing the planner's rows.
 *
 * Kept apart from planner.js so the arithmetic there stays a pure function of
 * its inputs, testable without a database.
 */

/** Everything the planner needs for one house, in as few round trips as possible. */
export async function loadPlan(houseId) {
  const [{ data: periods }, { data: cooks }, { data: components }, { data: allocations }, { data: targets }] =
    await Promise.all([
      supabase.from('periods').select('*').eq('house_id', houseId).order('starts_on', { ascending: false }),
      supabase.from('cooks').select('*').eq('house_id', houseId).order('cook_date', { ascending: false }),
      supabase.from('cook_components')
        .select('*, cooks(period_id, cook_date), cook_component_ingredients(*)')
        .eq('house_id', houseId).order('created_at'),
      supabase.from('allocations').select('*').eq('house_id', houseId).order('on_date'),
      supabase.from('ingredient_targets').select('*'),
    ])

  return {
    periods: periods ?? [],
    cooks: cooks ?? [],
    components: components ?? [],
    allocations: allocations ?? [],
    targets: targets ?? [],
  }
}

// ── Writing ──────────────────────────────────────────────────────────────────

/** Create a component on a cook, snapshotting its scaled quantities. */
export async function addComponent({ houseId, cookId, meal, ingredient, servings, mealIngredients, perServing }) {
  const name = meal?.name ?? ingredient?.name ?? 'Component'
  const { data: comp, error } = await supabase
    .from('cook_components')
    .insert({
      house_id: houseId,
      cook_id: cookId,
      meal_id: meal?.id ?? null,
      ingredient_id: ingredient?.id ?? null,
      name,
      servings_planned: servings,
    })
    .select('*, cooks(period_id, cook_date)')
    .single()
  if (error) throw new Error(error.message)

  const lines = meal
    ? scaleRecipe(mealIngredients ?? [], meal.servings, servings)
    // A bare ingredient: the amount per serving the user just gave us, falling
    // back to one card's worth.
    : [{
        ingredient_id: ingredient.id,
        qty_total: (Number(perServing) || Number(ingredient.card_weight) || 80) * Number(servings),
        qty_text: null,
      }]

  const usable = lines.filter(l => l.ingredient_id)
  if (usable.length) {
    const { error: e2 } = await supabase
      .from('cook_component_ingredients')
      .insert(usable.map(l => ({ ...l, component_id: comp.id })))
    if (e2) throw new Error(e2.message)
  }

  const { data: full } = await supabase
    .from('cook_components')
    .select('*, cooks(period_id, cook_date), cook_component_ingredients(*)')
    .eq('id', comp.id).single()
  return full ?? comp
}

/** Place one serving (or part of one) on a day. */
export async function allocate({ houseId, component, periodId, onDate, slot, servings = 1, forUserId = null }) {
  const { data, error } = await supabase
    .from('allocations')
    .insert({
      house_id: houseId,
      component_id: component.id,
      period_id: periodId ?? null,
      on_date: onDate,
      slot,
      servings,
      for_user_id: forUserId,
    })
    .select('*').single()
  if (error) throw new Error(error.message)
  return data
}

export async function unallocate(allocationId) {
  const { error } = await supabase.from('allocations').delete().eq('id', allocationId)
  if (error) throw new Error(error.message)
}

/**
 * Reducing a component below what's already placed would silently orphan
 * servings, so it's blocked — the user takes them off the calendar first.
 */
export async function setComponentServings(component, servings, allocations) {
  const placed = allocations
    .filter(a => a.component_id === component.id)
    .reduce((t, a) => t + Number(a.servings || 0), 0)
  if (servings < placed) {
    throw new Error(`${placed} serving${placed === 1 ? '' : 's'} already placed — remove some from the calendar first.`)
  }

  // Quantities are stored for the whole batch, so they rescale with the count.
  const factor = servings / (Number(component.servings_planned) || 1)
  const { error } = await supabase
    .from('cook_components').update({ servings_planned: servings }).eq('id', component.id)
  if (error) throw new Error(error.message)

  for (const line of component.cook_component_ingredients ?? []) {
    if (line.qty_total == null) continue
    await supabase.from('cook_component_ingredients')
      .update({ qty_total: Number(line.qty_total) * factor }).eq('id', line.id)
  }
}
