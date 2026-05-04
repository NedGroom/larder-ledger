-- Migration: simplify units and prices
-- - Remove unit_aliases, quantity_value, quantity_unit from ingredients
-- - Add canonical_quantity to ingredients
-- - Remove price_unit from ingredient_prices
-- - Rename price_per_base_unit -> price_per_canonical in ingredient_prices

ALTER TABLE ingredients
  DROP COLUMN IF EXISTS unit_aliases,
  DROP COLUMN IF EXISTS quantity_value,
  DROP COLUMN IF EXISTS quantity_unit,
  ADD COLUMN IF NOT EXISTS canonical_quantity NUMERIC;

ALTER TABLE ingredient_prices
  DROP COLUMN IF EXISTS price_unit,
  RENAME COLUMN price_per_base_unit TO price_per_canonical;

