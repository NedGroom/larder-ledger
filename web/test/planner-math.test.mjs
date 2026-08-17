// Unit tests for the planner's arithmetic. Pure functions, no browser, no DB:
//   node test/planner-math.test.mjs
import assert from 'node:assert/strict'
import {
  scaleRecipe, deckState, unallocatedServings, perServingQty,
  allocationNutrition, sumNutrition, suggestNormalised, formatCards,
  withinPeriod, periodsCovering, allocationsStranded, requirementsForPeriod,
  addDays, newPeriodDates, defaultPeriod, dealFromDeck,
} from '../src/lib/planner.js'

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); passed++ }
  catch (e) { console.log(` FAIL  ${name}\n         ${e.message}`); failed++ }
}
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: got ${a}, want ${b}`)

// ── Fixtures ─────────────────────────────────────────────────────────────────
const SPINACH = { id: 1, name: 'Spinach', card_weight: 80, protein_per_100: 2.9, fibre_per_100: 2.2, kcal_per_100: 23 }
const LENTILS = { id: 2, name: 'Lentils', card_weight: 100, protein_per_100: 9, fibre_per_100: 8, kcal_per_100: 116 }
const MYSTERY = { id: 3, name: 'Mystery spice', card_weight: 10 } // no nutrients recorded
const ingredients = [SPINACH, LENTILS, MYSTERY]

const periodA = { id: 1, starts_on: '2026-08-10', ends_on: '2026-08-23' }
const periodB = { id: 2, starts_on: '2026-08-20', ends_on: '2026-09-02' } // overlaps A on 20–23

// A dahl cooked under period A: 6 servings, 480g spinach (= 6 cards), 600g lentils (= 6 cards)
const dahl = {
  id: 10, servings_planned: 6, gone: false,
  cooks: { period_id: 1 },
  cook_component_ingredients: [
    { id: 1, ingredient_id: 1, qty_total: 480 },
    { id: 2, ingredient_id: 2, qty_total: 600 },
  ],
}

// ── Scaling ──────────────────────────────────────────────────────────────────
test('a recipe scales to the servings actually being cooked', () => {
  const lines = scaleRecipe(
    [{ ingredient_id: 1, qty_normalised: 300, required_quantity: 2, required_unit: 'handfuls' }],
    6, 10)
  near(lines[0].qty_total, 500, '300g at 6 servings, cooked as 10')
  assert.equal(lines[0].qty_text, '2 handfuls', 'keeps the human phrasing')
})

test('a recipe line with no normalised quantity stays unknown, not zero', () => {
  const lines = scaleRecipe([{ ingredient_id: 1, qty_normalised: null, required_quantity: 1, required_unit: 'tin' }], 4, 8)
  assert.equal(lines[0].qty_total, null)
})

test('a dish with no recorded yield is treated as one serving', () => {
  const lines = scaleRecipe([{ ingredient_id: 1, qty_normalised: 100 }], null, 3)
  near(lines[0].qty_total, 300, 'unknown yield')
})

// ── The deck ─────────────────────────────────────────────────────────────────
test('an allocation on a shared day counts against BOTH overlapping periods', () => {
  const allocations = [
    { id: 1, component_id: 10, period_id: 1, on_date: '2026-08-12', servings: 1 }, // A only
    { id: 2, component_id: 10, period_id: 1, on_date: '2026-08-21', servings: 1 }, // both
    { id: 3, component_id: 10, period_id: 2, on_date: '2026-08-25', servings: 1 }, // B only
  ]
  const targets = [
    { period_id: 1, ingredient_id: 1, target_cards: 6 },
    { period_id: 2, ingredient_id: 1, target_cards: 6 },
  ]
  const a = deckState({ period: periodA, ingredients, targets, components: [dahl], allocations })
  const b = deckState({ period: periodB, ingredients, targets, components: [dahl], allocations })
  near(a[1].spent, 2, 'period A spends the 12th and the 21st')
  near(b[1].spent, 2, 'period B spends the 21st and the 25th')
  near(a[1].remaining, 4, 'A remaining')
  near(b[1].remaining, 4, 'B remaining')
})

test('ownership does not affect the deck — only the date does', () => {
  // An allocation owned by period B but dated inside A still spends A's cards.
  const allocations = [{ id: 1, component_id: 10, period_id: 2, on_date: '2026-08-12', servings: 1 }]
  const targets = [{ period_id: 1, ingredient_id: 1, target_cards: 6 }]
  const a = deckState({ period: periodA, ingredients, targets, components: [dahl], allocations })
  near(a[1].spent, 1, 'counted despite belonging to B')
})

test('cooking spends nothing until a serving is placed', () => {
  const targets = [{ period_id: 1, ingredient_id: 1, target_cards: 6 }]
  const d = deckState({ period: periodA, ingredients, targets, components: [dahl], allocations: [] })
  near(d[1].spent, 0, 'nothing spent')
  near(d[1].pending, 6, 'but all six servings are pending')
  near(d[1].remaining, 6, 'remaining untouched')
})

test('a batch cooked into the freezer costs no cards', () => {
  const frozen = { ...dahl, frozen: true }
  const targets = [{ period_id: 1, ingredient_id: 1, target_cards: 6 }]
  const d = deckState({ period: periodA, ingredients, targets, components: [frozen], allocations: [] })
  near(d[1].spent, 0, 'freezer spends nothing')
})

test('placing part of a batch spends only that part', () => {
  const allocations = [{ id: 1, component_id: 10, period_id: 1, on_date: '2026-08-12', servings: 2 }]
  const targets = [{ period_id: 1, ingredient_id: 1, target_cards: 6 }]
  const d = deckState({ period: periodA, ingredients, targets, components: [dahl], allocations })
  near(d[1].spent, 2, 'two servings = two cards')
  near(d[1].pending, 4, 'four still unplaced')
})

test('fractional servings give fractional cards', () => {
  const allocations = [{ id: 1, component_id: 10, period_id: 1, on_date: '2026-08-12', servings: 0.5 }]
  const targets = [{ period_id: 1, ingredient_id: 1, target_cards: 6 }]
  const d = deckState({ period: periodA, ingredients, targets, components: [dahl], allocations })
  near(d[1].spent, 0.5, 'half a serving')
})

test('a stack can go negative — targets are not limits', () => {
  const allocations = [{ id: 1, component_id: 10, period_id: 1, on_date: '2026-08-12', servings: 6 }]
  const targets = [{ period_id: 1, ingredient_id: 1, target_cards: 4 }]
  const d = deckState({ period: periodA, ingredients, targets, components: [dahl], allocations })
  near(d[1].remaining, -2, 'overspent by two')
})

test('an ingredient with no card weight is not in the deck', () => {
  const noWeight = [{ ...SPINACH, card_weight: null }, LENTILS, MYSTERY]
  const allocations = [{ id: 1, component_id: 10, period_id: 1, on_date: '2026-08-12', servings: 1 }]
  const targets = [{ period_id: 1, ingredient_id: 1, target_cards: 6 }]
  const d = deckState({ period: periodA, ingredients: noWeight, targets, components: [dahl], allocations })
  near(d[1].spent, 0, 'no weight, no debit')
})

test('a component written off as gone stops being pending', () => {
  const targets = [{ period_id: 1, ingredient_id: 1, target_cards: 6 }]
  const d = deckState({ period: periodA, ingredients, targets, components: [{ ...dahl, gone: true }], allocations: [] })
  near(d[1].pending, 0, 'gone food is not waiting to be eaten')
})

// ── Servings bookkeeping ─────────────────────────────────────────────────────
test('unallocated servings account for fractions', () => {
  const allocations = [
    { component_id: 10, servings: 1 },
    { component_id: 10, servings: 0.5 },
    { component_id: 99, servings: 3 },   // a different component
  ]
  near(unallocatedServings(dahl, allocations), 4.5, 'six minus one and a half')
})

test('per-serving quantity divides the batch', () => {
  near(perServingQty(dahl, 1), 80, 'spinach per serving')
  near(perServingQty(dahl, 999), 0, 'ingredient not in the component')
})

// ── Nutrition ────────────────────────────────────────────────────────────────
test('nutrition is computed at the serving, from the batch total', () => {
  const { totals } = allocationNutrition({ component_id: 10, servings: 1 }, dahl, ingredients)
  near(totals.protein, (80 / 100) * 2.9 + (100 / 100) * 9, 'protein for one serving')
})

test('an ingredient with no nutrient data is reported missing, never counted as zero', () => {
  const withMystery = {
    ...dahl,
    cook_component_ingredients: [...dahl.cook_component_ingredients, { id: 3, ingredient_id: 3, qty_total: 60 }],
  }
  const { missing } = allocationNutrition({ component_id: 10, servings: 1 }, withMystery, ingredients)
  assert.ok(missing.has('Mystery spice'), 'flagged as unknown')
})

test('a day sums its allocations', () => {
  const allocations = [
    { component_id: 10, servings: 1 },
    { component_id: 10, servings: 2 },
  ]
  const { totals } = sumNutrition(allocations, [dahl], ingredients)
  const one = allocationNutrition({ component_id: 10, servings: 1 }, dahl, ingredients).totals
  near(totals.protein, one.protein * 3, 'three servings')
})

// ── Periods ──────────────────────────────────────────────────────────────────
test('period membership is inclusive of both ends', () => {
  assert.ok(withinPeriod('2026-08-10', periodA))
  assert.ok(withinPeriod('2026-08-23', periodA))
  assert.ok(!withinPeriod('2026-08-24', periodA))
})

test('overlapping periods both cover a shared day', () => {
  assert.equal(periodsCovering([periodA, periodB], '2026-08-21').length, 2)
  assert.equal(periodsCovering([periodA, periodB], '2026-08-12').length, 1)
})

test('shrinking a period reports the allocations it would strand', () => {
  const allocations = [
    { id: 1, period_id: 1, on_date: '2026-08-12' },
    { id: 2, period_id: 1, on_date: '2026-08-22' },
    { id: 3, period_id: 2, on_date: '2026-08-22' },  // belongs to B, unaffected
  ]
  const stranded = allocationsStranded(periodA, { starts_on: '2026-08-10', ends_on: '2026-08-20' }, allocations)
  assert.deepEqual(stranded.map(a => a.id), [2], 'only A-owned allocations outside the new range')
})

test('a new period defaults to a fortnight', () => {
  const { starts_on, ends_on } = newPeriodDates('2026-08-17')
  assert.equal(starts_on, '2026-08-17')
  assert.equal(ends_on, '2026-08-30', '14 days inclusive')
})

test('planning opens on the first unfinished period', () => {
  const past = { id: 9, starts_on: '2026-07-01', ends_on: '2026-07-14' }
  assert.equal(defaultPeriod([past, periodB, periodA], '2026-08-17').id, periodA.id)
  assert.equal(defaultPeriod([past], '2026-08-17').id, past.id, 'falls back to the most recent')
  assert.equal(defaultPeriod([], '2026-08-17'), null)
})

test('addDays crosses month ends', () => {
  assert.equal(addDays('2026-08-30', 3), '2026-09-02')
})

// ── Shopping requirements ────────────────────────────────────────────────────
test('a period requires the sum of what its cooks need', () => {
  const other = { ...dahl, id: 11, cooks: { period_id: 2 } }
  const need = requirementsForPeriod(periodA, [dahl, other])
  near(need[1], 480, 'only period A\'s cooks count')
})

// ── Display ──────────────────────────────────────────────────────────────────
test('cards display rounded to halves', () => {
  assert.equal(formatCards(0), '0')
  assert.equal(formatCards(3), '3')
  assert.equal(formatCards(2.5), '2½')
  assert.equal(formatCards(2.4), '2½', 'rounds to the nearest half')
  assert.equal(formatCards(0.5), '½')
  assert.equal(formatCards(-0.5), '−½')
  assert.equal(formatCards(-2), '-2')
})

test('convertible units normalise, awkward ones stay blank for the user', () => {
  near(suggestNormalised(2, 'kg'), 2000, 'kg to g')
  near(suggestNormalised(500, 'ml'), 500, 'ml')
  near(suggestNormalised(1.5, 'l'), 1500, 'litres')
  assert.equal(suggestNormalised(2, 'tins'), null, 'no idea how big a tin is')
  assert.equal(suggestNormalised(null, 'g'), null, 'no quantity')
})

// ── Dealing ──────────────────────────────────────────────────────────────────
test('dealing only offers stacks with cards left, and never more than asked', () => {
  const deck = { 1: { remaining: 3 }, 2: { remaining: 0 }, 3: { remaining: 5 } }
  const hand = dealFromDeck(deck, ingredients, 6)
  assert.deepEqual(hand.map(i => i.id).sort(), [1, 3], 'skips the spent stack')
  assert.equal(dealFromDeck(deck, ingredients, 1).length, 1, 'respects the count')
})

console.log(`\n${passed}/${passed + failed} checks passed`)
process.exit(failed ? 1 : 0)
