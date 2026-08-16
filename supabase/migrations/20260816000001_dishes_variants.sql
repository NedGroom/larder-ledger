-- Dishes & variants.
--
-- A "dish" is the primary object (Bolognese). A "variant" is a child of a dish
-- (Ned's Bolognese) with exactly the same shape, EXCEPT a variant may not have
-- variants of its own — two levels only, enforced in the app. Both are stored
-- in the existing `meals` table; the UI presents them as Dishes / Variants.
-- (Renaming the table to `dishes` was deliberately avoided — it would break
--  meal_ingredients, the meal_ingredient_fractions RPC, and the meal_id refs on
--  the calendar and shopping items. Left as an optional later cleanup.)

ALTER TABLE meals
  ADD COLUMN IF NOT EXISTS parent_id    BIGINT REFERENCES meals(id) ON DELETE CASCADE, -- NULL = a dish; set = a variant of that dish
  ADD COLUMN IF NOT EXISTS instructions TEXT,
  ADD COLUMN IF NOT EXISTS backstory    TEXT,
  ADD COLUMN IF NOT EXISTS photo_urls   TEXT[],
  ADD COLUMN IF NOT EXISTS source_links TEXT[];

CREATE INDEX IF NOT EXISTS idx_meals_parent ON meals(parent_id);
