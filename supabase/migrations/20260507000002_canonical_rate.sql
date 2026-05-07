-- Rename price_per_canonical → canonical_rate and add canonical_rate_unit
-- on ingredient_prices. Also add canonical_rate_unit to ingredients so each
-- ingredient has a preferred unit for rate comparisons.

ALTER TABLE ingredient_prices
  RENAME COLUMN price_per_canonical TO canonical_rate;

ALTER TABLE ingredient_prices
  ADD COLUMN canonical_rate_unit TEXT;

ALTER TABLE ingredients
  ADD COLUMN canonical_rate_unit TEXT;

