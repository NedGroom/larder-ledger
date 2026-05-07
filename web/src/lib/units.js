/**
 * units.js — Unit parsing and canonical rate calculation.
 *
 * canonical_rate = price per canonical_rate_unit
 * e.g.  price=£1.25, unit_size_unit="500g", canonical_rate_unit="g"
 *       → canonical_rate = 1.25 / 500 = £0.0025 per g
 *
 *       price=£1.25, unit_size_unit="500g", canonical_rate_unit="100g"
 *       → canonical_rate = 1.25 / 500 * 100 = £0.25 per 100g
 */

// ── Unit conversion to base units ────────────────────────────────────────────
// base unit for mass → g, volume → ml, everything else → "unit"
const CONVERSIONS = {
  g:    { base: 'g',    factor: 1       },
  kg:   { base: 'g',    factor: 1000    },
  mg:   { base: 'g',    factor: 0.001   },
  ml:   { base: 'ml',   factor: 1       },
  l:    { base: 'ml',   factor: 1000    },
  cl:   { base: 'ml',   factor: 10      },
  fl:   { base: 'ml',   factor: 28.41   }, // fl oz (UK)
}

/**
 * Parse a unit string like "500g", "2L", "6pk", "1.5kg" into { qty, unit }.
 * Returns null if it doesn't match.
 */
export function parseUnitStr(str) {
  const m = String(str ?? '').trim().match(/^([\d.]+)\s*([a-zA-Z]+)$/)
  if (!m) return null
  return { qty: Number(m[1]), unit: m[2].toLowerCase() }
}

/**
 * Convert qty+unit to a base { baseQty, baseUnit }.
 * e.g. (500, "g") → { baseQty: 500, baseUnit: "g" }
 *      (1, "kg")  → { baseQty: 1000, baseUnit: "g" }
 *      (6, "pk")  → { baseQty: 6, baseUnit: "unit" }
 */
export function toBase(qty, unit) {
  const conv = CONVERSIONS[unit?.toLowerCase()]
  if (!conv) return { baseQty: qty, baseUnit: 'unit' }
  return { baseQty: qty * conv.factor, baseUnit: conv.base }
}

/**
 * Derive the default canonical_rate_unit for a new ingredient from its
 * unit_size_unit string: "500g" → "g", "2L" → "ml", "6pk" → "unit".
 */
export function defaultCanonicalRateUnit(unitSizeUnit) {
  const parsed = parseUnitStr(unitSizeUnit)
  if (!parsed) return 'unit'
  const { baseUnit } = toBase(parsed.qty, parsed.unit)
  return baseUnit
}

/**
 * Calculate canonical_rate: price per canonical_rate_unit.
 *
 * @param {number} price             - per-unit price (already discounted)
 * @param {string} unitSizeUnit      - e.g. "500g", "2L", "6pk"
 * @param {string} canonicalRateUnit - e.g. "g", "100g", "ml", "unit"
 * @returns {number|null}
 */
export function calcCanonicalRate(price, unitSizeUnit, canonicalRateUnit) {
  const product = parseUnitStr(unitSizeUnit)
  if (!product) return null

  const { baseQty: productBase } = toBase(product.qty, product.unit)
  if (!productBase) return null

  // Parse canonical unit — it may have a multiplier like "100g"
  const canon = parseUnitStr(canonicalRateUnit)
  const canonBase = canon
    ? toBase(canon.qty, canon.unit).baseQty
    : 1   // bare unit string like "g", "ml", "unit" — multiplier is 1

  // price is for productBase base-units, canonical_rate is per canonBase base-units
  return (price / productBase) * canonBase
}

/**
 * Format a canonical rate for display.
 * e.g. (0.25, "100g") → "25p / 100g"
 */
export function formatRate(rate, unit) {
  if (rate == null || isNaN(rate)) return ''
  const pence = rate < 0.1
  return `${pence ? (rate * 100).toFixed(1) + 'p' : '£' + rate.toFixed(3)} / ${unit}`
}

