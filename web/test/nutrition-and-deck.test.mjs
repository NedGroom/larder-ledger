// The arithmetic that keeps the planner honest: the nutrition plausibility
// check, per-ingredient unit conversions, and the deck admitting what it can't
// count instead of reporting zero.
//
// Pure functions, no browser — these are the calculations everything else
// trusts, so they're worth testing directly.
import { checkNutrition, looksExtreme, nutritionPatch } from '../src/lib/nutrition.js'
import { suggestNormalised, findConversion, deckState, deckBlindSpots } from '../src/lib/planner.js'

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail })

// ── Plausibility ─────────────────────────────────────────────────────────────
check('a real label passes', checkNutrition({ kcal: 133, protein: 9, carbs: 5, fat: 9, fibre: 0 }).ok)
check('olive oil at the physical limit passes',
      checkNutrition({ kcal: 824, protein: 0, carbs: 0, fat: 91.6, fibre: 0 }).ok)
check('a rounded label still passes',
      checkNutrition({ kcal: 250, protein: 12, carbs: 30, fat: 8, fibre: 2 }).ok)

check('a decimal slip in fat is caught',
      checkNutrition({ kcal: 120, protein: 9, carbs: 5, fat: 31 }).severity === 'error')
check('a decimal slip in calories is caught',
      checkNutrition({ kcal: 3100, protein: 9, carbs: 5, fat: 9 }).severity === 'error')
check('more than 100g of stuff in 100g of food is caught',
      checkNutrition({ kcal: 400, protein: 50, carbs: 50, fat: 30, fibre: 5 }).severity === 'error')
check('energy above pure fat is caught',
      checkNutrition({ kcal: 1200 }).severity === 'error')
check('a negative is caught', checkNutrition({ kcal: 100, protein: -3 }).severity === 'error')

check('calories alone can\'t be cross-checked, and aren\'t rejected',
      checkNutrition({ kcal: 250 }).ok)
check('nothing at all is not an error', checkNutrition({}).ok)
check('the expected figure is reported for display',
      checkNutrition({ kcal: 133, protein: 9, carbs: 5, fat: 9 }).expectedKcal === 137)

check('fibre is counted at 2 kcal/g, not 4',
      checkNutrition({ protein: 0, carbs: 0, fat: 0, fibre: 10 }).expectedKcal === 20)

check('an implausible food is flagged for a web look-up', looksExtreme({ kcal: 780 }))
check('an ordinary food is not', !looksExtreme({ kcal: 133, protein: 9 }))

const patch = nutritionPatch({ kcal: 133, protein: 9, carbs: 5, fat: 9, fibre: null, pack_grams: 500 })
check('a reading becomes a database patch', patch.kcal_per_100 === 133 && patch.fibre_per_100 === null)
check('and records that it came off a label', patch.nutrition_source === 'label' && !!patch.nutrition_noted_at)
check('an estimate records that it is one',
      nutritionPatch({ kcal: 133 }, 'estimated').nutrition_source === 'estimated')

// ── Unit conversions ─────────────────────────────────────────────────────────
const tins = [{ label: 'tin', grams: 400 }, { label: 'handful', grams: 30 }, { label: 'each', grams: 110 }]

check('grams still convert without any measures', suggestNormalised(500, 'g') === 500)
check('kilos still convert', suggestNormalised(1.5, 'kg') === 1500)
check('an unknown unit with no measures stays unknown', suggestNormalised(2, 'tins') === null)

check('a measure converts an awkward unit', suggestNormalised(2, 'tins', tins) === 800)
check('the singular works too', suggestNormalised(1, 'tin', tins) === 400)
check('case is ignored', suggestNormalised(2, 'Handfuls', tins) === 60)
check('a bare count uses "each"', suggestNormalised(3, '', tins) === 330)
check('a unit with no measure is still honestly unknown', suggestNormalised(2, 'sprigs', tins) === null)
check('grams win over a measure of the same name',
      suggestNormalised(200, 'g', [{ label: 'g', grams: 999 }]) === 200)
check('findConversion returns the row, not just the weight',
      findConversion('tins', tins)?.grams === 400)

// ── The deck admits what it can't count ──────────────────────────────────────
const period = { id: 1, starts_on: '2026-09-01', ends_on: '2026-09-14' }
const ingredients = [
  { id: 1, name: 'Tomatoes', card_weight: 80 },
  { id: 2, name: 'Basil',    card_weight: null },   // never weighed
]
const components = [{
  id: 100, servings_planned: 4, cooks: { period_id: 1 },
  cook_component_ingredients: [
    { ingredient_id: 1, qty_total: 640 },
    { ingredient_id: 2, qty_total: 40 },
  ],
}]
const allocations = [{ component_id: 100, servings: 4, on_date: '2026-09-03' }]
const targets = [
  { period_id: 1, ingredient_id: 1, target_cards: 10 },
  { period_id: 1, ingredient_id: 2, target_cards: 4 },
]

const deck = deckState({ period, ingredients, targets, components, allocations })
check('a weighable ingredient is spent normally', deck[1].spent === 8)
check('and is not marked uncountable', !deck[1].uncountable)
check('an unweighable one is not silently zero', deck[2].uncountable === true)
check('the reason is recorded', deck[2].blind.noCardWeight === true)
check('its spend stays at zero rather than being guessed', deck[2].spent === 0)

const noWeightAtAll = deckState({
  period, targets, components: [], allocations: [],
  ingredients: [{ id: 2, name: 'Basil', card_weight: null }],
})
check('a targeted stack with no weight is flagged before anything is cooked',
      noWeightAtAll[2].uncountable === true)

// A recipe line the app couldn't convert reaches the cook as a null quantity.
const unconvertible = [{
  id: 101, servings_planned: 2, cooks: { period_id: 1 },
  cook_component_ingredients: [{ ingredient_id: 1, qty_total: null }],
}]
const deck2 = deckState({
  period, ingredients, targets,
  components: unconvertible,
  allocations: [{ component_id: 101, servings: 2, on_date: '2026-09-04' }],
})
check('an unconvertible recipe line is counted as a blind spot, not as nothing',
      deck2[1].blind.unconvertedLines === 1 && deck2[1].uncountable === true)

const spots = deckBlindSpots(deck, ingredients)
check('blind spots are reported by name', spots.noWeight.includes('Basil'), JSON.stringify(spots))
check('and a countable one is not listed', !spots.noWeight.includes('Tomatoes'))

let failed = 0
for (const r of results) {
  console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}${r.ok || !r.detail ? '' : `  → ${r.detail}`}`)
  if (!r.ok) failed++
}
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)
