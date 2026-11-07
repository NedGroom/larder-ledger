// GENERATED from web/src/lib by scripts/sync-mcp-lib.mjs - edit the original, then re-run.
/**
 * nutrition.js — sanity for numbers read off a packet.
 *
 * Reading a nutrition panel from a photograph goes wrong in a specific way: a
 * digit or a decimal point, not the whole table. "3.1g fat" becomes "31g",
 * "310 kcal" becomes "3100". The value still looks like a nutrition figure, so
 * nothing downstream objects, and a plan's calorie total is quietly wrong for
 * as long as that ingredient exists.
 *
 * Food has physics, though, and a misread digit breaks it immediately:
 *
 *   - Energy is the sum of what provides it. The Atwater factors (4 kcal/g for
 *     protein and carbohydrate, 9 for fat, 2 for fibre) reconstruct the calorie
 *     figure from the macros to within rounding. A tenfold slip in any one of
 *     them puts the sum nowhere near the printed number.
 *   - 100 g of food cannot contain more than 100 g of anything.
 *   - Nothing is denser in energy than pure fat, at 900 kcal per 100 g.
 *
 * These are deterministic, instant, free, and provider-independent — they run
 * whether or not the model could search the web. The web check is the second
 * line, for a figure that is internally consistent but read off the wrong
 * column or the wrong product entirely.
 */

/** kcal per gram, EU/UK convention. Fibre is 2, not 4. */
const ATWATER = { protein: 4, carbs: 4, fat: 9, fibre: 2 }

const num = v => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v))

/**
 * Check a per-100g reading for physical impossibility and internal
 * inconsistency.
 *
 * @param {{kcal?, protein?, carbs?, fat?, fibre?}} v — per 100 g/ml
 * @returns {{ ok: boolean, severity: 'ok'|'warn'|'error', issues: string[], expectedKcal: number|null }}
 */
export function checkNutrition(v = {}) {
  const kcal    = num(v.kcal)
  const protein = num(v.protein)
  const carbs   = num(v.carbs)
  const fat     = num(v.fat)
  const fibre   = num(v.fibre)

  const issues = []
  let severity = 'ok'
  const raise = (level, msg) => {
    issues.push(msg)
    if (level === 'error' || severity === 'error') severity = 'error'
    else severity = 'warn'
  }

  for (const [name, value] of Object.entries({ kcal, protein, carbs, fat, fibre })) {
    if (value != null && value < 0) raise('error', `${name} can't be negative`)
  }

  if (kcal != null && kcal > 900) {
    raise('error', `${kcal} kcal per 100g is above pure fat (900) — a digit has probably been misread`)
  }

  const mass = [protein, carbs, fat, fibre].filter(x => x != null).reduce((a, b) => a + b, 0)
  if (mass > 100.5) {
    raise('error', `protein, carbs, fat and fibre add up to ${round(mass)}g in 100g of food`)
  }
  for (const [name, value] of Object.entries({ protein, carbs, fat, fibre })) {
    if (value != null && value > 100) raise('error', `${name} can't be ${value}g per 100g`)
  }

  // The Atwater reconstruction only means anything when we have the macros.
  let expectedKcal = null
  const haveMacros = [protein, carbs, fat].every(x => x != null)
  if (haveMacros) {
    expectedKcal = round(
      protein * ATWATER.protein + carbs * ATWATER.carbs + fat * ATWATER.fat +
      (fibre ?? 0) * ATWATER.fibre)

    if (kcal != null) {
      // Generous: labels round, some list fibre inside carbohydrate, and a few
      // foods carry sugar alcohols. Only a real misreading should trip this.
      const slack = Math.max(35, expectedKcal * 0.28)
      if (Math.abs(kcal - expectedKcal) > slack) {
        raise('error',
          `the macros come to about ${expectedKcal} kcal but the label says ${kcal} — one of these has been misread`)
      }
    }
  }

  return { ok: severity === 'ok', severity, issues, expectedKcal }
}

/**
 * A coarse per-category expectation, used to phrase what to ask the web about.
 * Deliberately wide — it exists to catch "this is the wrong product entirely",
 * not to second-guess a real label.
 */
export function looksExtreme(v = {}) {
  const kcal = num(v.kcal)
  const protein = num(v.protein)
  if (kcal == null) return false
  return kcal < 5 || kcal > 750 || (protein != null && protein > 60)
}

function round(n) { return Math.round(Number(n)) }

/** Merge a reading into an ingredient patch, ready for the database. */
export function nutritionPatch(reading, source = 'label') {
  const p = {
    kcal_per_100:    num(reading.kcal),
    protein_per_100: num(reading.protein),
    fibre_per_100:   num(reading.fibre),
    carbs_per_100:   num(reading.carbs),
    fat_per_100:     num(reading.fat),
    nutrition_source: source,
    nutrition_noted_at: new Date().toISOString(),
  }
  if (num(reading.pack_grams) != null) p.pack_grams = num(reading.pack_grams)
  return p
}
