-- Shopping loop: the Larder becomes a source you "make" persistent shopping
-- lists from, shop, and keep as history.
--
--   * ingredients.keep   — "generally want this"; drives the default tick state
--                          when building a list. (out + keep → ticked)
--   * shopping_lists      — a made list with a lifecycle: building → shopping →
--                          done. Done lists ARE the shop history.
--   * shopping_list_items — grow up: grouped into a list, with quantity, a
--                          bought flag + timestamp, the price paid, and support
--                          for one-off items that aren't Larder ingredients.

ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS keep BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS shopping_lists (
  id           BIGSERIAL PRIMARY KEY,
  house_id     BIGINT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  store_id     BIGINT REFERENCES stores(id) ON DELETE SET NULL,  -- intended shop (nullable)
  status       TEXT NOT NULL DEFAULT 'building',                 -- building | shopping | done
  created_at   TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  total_paid   NUMERIC
);

CREATE INDEX IF NOT EXISTS idx_shopping_lists_house ON shopping_lists(house_id, status);

ALTER TABLE shopping_list_items
  ADD COLUMN IF NOT EXISTS list_id     BIGINT REFERENCES shopping_lists(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS quantity    INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS bought      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bought_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS price_paid  NUMERIC,           -- per unit
  ADD COLUMN IF NOT EXISTS custom_name TEXT;              -- for one-off (non-Larder) items

-- one-off items have no ingredient, so ingredient_id must be nullable
ALTER TABLE shopping_list_items ALTER COLUMN ingredient_id DROP NOT NULL;

-- Legacy note: pre-existing shopping_list_items keep their old completed /
-- auto_generated flags and have list_id = NULL. They simply won't appear under
-- any list. The columns are superseded by `bought` / `list_id` and can be
-- dropped in a later cleanup migration once nothing references them.
