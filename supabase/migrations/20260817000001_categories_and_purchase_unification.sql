-- Two changes that go together:
--
-- 1. Ingredients gain many-to-many categories, so the Larder can be browsed as
--    grouped sections. An ingredient may sit in several categories and is shown
--    under each of them.
--
-- 2. A shopping-list item and a receipt line become the same thing: a purchase
--    of a known ingredient. Every line now points at a real `ingredients` row —
--    the old `custom_name` one-offs were never remembered between shops, which
--    is exactly the bug this removes.

-- ── Categories ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id BIGSERIAL PRIMARY KEY,
  house_id BIGINT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_categories_house_name ON categories(house_id, name_normalized);
CREATE INDEX IF NOT EXISTS idx_categories_house ON categories(house_id);

CREATE TABLE IF NOT EXISTS ingredient_categories (
  ingredient_id BIGINT NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  category_id   BIGINT NOT NULL REFERENCES categories(id)  ON DELETE CASCADE,
  PRIMARY KEY (ingredient_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_ingredient_categories_category ON ingredient_categories(category_id);

-- ── A shopping-list item IS a purchase line ──────────────────────────────────
-- Drop the one-off rows before tightening the FK: they carry only a name, so
-- there is nothing to migrate them to.
DELETE FROM shopping_list_items WHERE ingredient_id IS NULL;

ALTER TABLE shopping_list_items DROP COLUMN IF EXISTS custom_name;
ALTER TABLE shopping_list_items ALTER COLUMN ingredient_id SET NOT NULL;

-- Fields a receipt line carries that a hand-built line previously didn't
ALTER TABLE shopping_list_items ADD COLUMN IF NOT EXISTS unit_size_unit TEXT;
ALTER TABLE shopping_list_items ADD COLUMN IF NOT EXISTS for_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE shopping_list_items ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

-- The price row this purchase created, so un-marking a buy can retract exactly
-- the price it logged instead of leaving a phantom behind.
ALTER TABLE shopping_list_items ADD COLUMN IF NOT EXISTS price_id BIGINT REFERENCES ingredient_prices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_shopping_list_items_ingredient ON shopping_list_items(ingredient_id);

-- ── Shopping lists gain receipt provenance ───────────────────────────────────
-- A receipt scanned from the Shops tab becomes a completed list, so past shops
-- and scanned receipts share one history.
ALTER TABLE shopping_lists ADD COLUMN IF NOT EXISTS purchased_on DATE;
ALTER TABLE shopping_lists ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE shopping_lists ADD COLUMN IF NOT EXISTS receipt_total NUMERIC;

UPDATE shopping_lists
   SET purchased_on = completed_at::date
 WHERE purchased_on IS NULL AND completed_at IS NOT NULL;
