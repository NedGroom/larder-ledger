-- LarderLedger Supabase schema (Postgres)
-- Run this in Supabase SQL editor or psql connected to your Supabase Postgres

-- NOTE: user references are integer users.id. Supabase's auth.uid() is bridged
-- to them through users.auth_uid (see policies.sql).

CREATE TABLE houses (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  is_public BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  auth_uid UUID UNIQUE,          -- Supabase auth.uid() — used for RLS
  email TEXT,
  name TEXT,
  hashed_password TEXT,
  -- Personal daily targets: per person, unrelated to ingredient card targets.
  target_kcal NUMERIC,
  target_protein_g NUMERIC,
  target_fibre_g NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE house_users (
  house_id BIGINT REFERENCES houses(id) ON DELETE CASCADE,
  user_id  BIGINT REFERENCES users(id)  ON DELETE CASCADE,
  role TEXT DEFAULT 'member',
  PRIMARY KEY (house_id, user_id)
);

CREATE TABLE ingredients (
  id BIGSERIAL PRIMARY KEY,
  house_id BIGINT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  canonical_unit TEXT,
  canonical_quantity NUMERIC,
  has_any BOOLEAN DEFAULT FALSE,
  keep BOOLEAN NOT NULL DEFAULT TRUE,   -- "generally want this"; drives shopping-list build defaults
  stock_qty NUMERIC,                    -- optional detail beside has_any
  stock_unit TEXT,
  card_weight NUMERIC,                  -- g/ml one deck card of this is worth
  qualitative_note TEXT,                -- "1 handful ~ 30g", the user's own reference
  -- Nutrients per 100g/ml. NULL means "not looked up", never zero.
  kcal_per_100 NUMERIC,
  protein_per_100 NUMERIC,
  fibre_per_100 NUMERIC,
  carbs_per_100 NUMERIC,
  fat_per_100 NUMERIC,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX ux_ingredients_house_name_normalized ON ingredients(house_id, name_normalized);
CREATE INDEX idx_ingredients_house ON ingredients(house_id);

-- Free-form, per-house. An ingredient may belong to several; the Larder shows
-- it under each one.
CREATE TABLE categories (
  id BIGSERIAL PRIMARY KEY,
  house_id BIGINT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX ux_categories_house_name ON categories(house_id, name_normalized);
CREATE INDEX idx_categories_house ON categories(house_id);

CREATE TABLE ingredient_categories (
  ingredient_id BIGINT NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  category_id   BIGINT NOT NULL REFERENCES categories(id)  ON DELETE CASCADE,
  PRIMARY KEY (ingredient_id, category_id)
);

CREATE INDEX idx_ingredient_categories_category ON ingredient_categories(category_id);

-- Stores dishes and their variants (see parent_id). UI calls them Dishes/Variants.
CREATE TABLE meals (
  id BIGSERIAL PRIMARY KEY,
  house_id BIGINT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  parent_id BIGINT REFERENCES meals(id) ON DELETE CASCADE,  -- NULL = dish; set = variant of that dish (two levels only)
  name TEXT NOT NULL,
  dish_type TEXT,
  prep_time_min INTEGER,
  servings INTEGER,
  price_per_portion NUMERIC,
  instructions TEXT,
  backstory TEXT,
  photo_urls TEXT[],
  source_links TEXT[],
  chef_user_id BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_meals_house ON meals(house_id);
CREATE INDEX idx_meals_parent ON meals(parent_id);

CREATE TABLE meal_ingredients (
  id BIGSERIAL PRIMARY KEY,
  meal_id BIGINT NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  ingredient_id BIGINT NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  required_quantity NUMERIC,   -- as the recipe is written: 2 …
  required_unit TEXT,          -- … "handfuls"
  qty_normalised NUMERIC       -- the same amount in g/ml, for the WHOLE dish
);

-- Cuisine and similar, on dishes. A different axis from meals.dish_type.
CREATE TABLE meal_categories (
  meal_id     BIGINT NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  category_id BIGINT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (meal_id, category_id)
);

CREATE TABLE stores (
  id BIGSERIAL PRIMARY KEY,
  house_id BIGINT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_stores_house ON stores(house_id);

CREATE TABLE ingredient_prices (
  id BIGSERIAL PRIMARY KEY,
  ingredient_id BIGINT NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  store_id BIGINT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  price NUMERIC NOT NULL,          -- per pack, as paid
  label TEXT,                      -- which product: "large, free range", "5% fat"
  unit_size NUMERIC,               -- legacy, unused
  unit_size_unit TEXT,             -- pack as written: "500g", "6pk"
  canonical_rate NUMERIC,          -- price per canonical_rate_unit, for comparing
  canonical_rate_unit TEXT,
  currency TEXT DEFAULT 'GBP',
  source TEXT,
  noted_at TIMESTAMPTZ DEFAULT now(),
  created_by BIGINT REFERENCES users(id)
);

CREATE INDEX idx_prices_ingredient ON ingredient_prices(ingredient_id);
CREATE INDEX idx_prices_store ON ingredient_prices(store_id);

-- ── The fortnight planner ────────────────────────────────────────────────────
-- Cards are spent by ALLOCATION, not by cooking: a period's deck is its targets
-- minus every allocation dated inside its range, whoever cooked it. That is what
-- lets overlapping periods both count a shared day, and what lets a batch cooked
-- into the freezer cost nothing until a day is chosen for it.

CREATE TABLE periods (
  id BIGSERIAL PRIMARY KEY,
  house_id BIGINT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  name TEXT,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,          -- periods may overlap each other
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT periods_dates_ordered CHECK (ends_on >= starts_on)
);

CREATE INDEX idx_periods_house ON periods(house_id, starts_on);

CREATE TABLE ingredient_targets (
  id BIGSERIAL PRIMARY KEY,
  period_id BIGINT NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
  ingredient_id BIGINT NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  target_cards NUMERIC NOT NULL DEFAULT 0,
  UNIQUE (period_id, ingredient_id)
);

CREATE INDEX idx_ingredient_targets_period ON ingredient_targets(period_id);

CREATE TABLE cooks (
  id BIGSERIAL PRIMARY KEY,
  house_id BIGINT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  period_id BIGINT REFERENCES periods(id) ON DELETE SET NULL,
  cook_date DATE NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_cooks_house ON cooks(house_id, cook_date);
CREATE INDEX idx_cooks_period ON cooks(period_id);

-- One batch. Also the fridge record: not eaten and not gone = it still exists.
CREATE TABLE cook_components (
  id BIGSERIAL PRIMARY KEY,
  house_id BIGINT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  cook_id BIGINT NOT NULL REFERENCES cooks(id) ON DELETE CASCADE,
  meal_id BIGINT REFERENCES meals(id) ON DELETE SET NULL,
  ingredient_id BIGINT REFERENCES ingredients(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  servings_planned NUMERIC NOT NULL DEFAULT 1,
  cooked_date DATE,                     -- may differ from the session's date
  frozen BOOLEAN NOT NULL DEFAULT FALSE,
  eaten BOOLEAN NOT NULL DEFAULT FALSE,
  gone BOOLEAN NOT NULL DEFAULT FALSE,  -- neutral: wasted, given away, taken out
  gone_note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT cook_components_servings_positive CHECK (servings_planned > 0)
);

CREATE INDEX idx_cook_components_cook ON cook_components(cook_id);
CREATE INDEX idx_cook_components_house ON cook_components(house_id);

-- Copied from the dish, never referenced, so editing a recipe cannot rewrite a
-- cook that already happened.
CREATE TABLE cook_component_ingredients (
  id BIGSERIAL PRIMARY KEY,
  component_id BIGINT NOT NULL REFERENCES cook_components(id) ON DELETE CASCADE,
  ingredient_id BIGINT NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  qty_total NUMERIC,     -- g/ml across all planned servings
  qty_text TEXT          -- as originally typed
);

CREATE INDEX idx_cci_component ON cook_component_ingredients(component_id);

CREATE TABLE allocations (
  id BIGSERIAL PRIMARY KEY,
  house_id BIGINT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  component_id BIGINT NOT NULL REFERENCES cook_components(id) ON DELETE CASCADE,
  period_id BIGINT REFERENCES periods(id) ON DELETE SET NULL,  -- ownership only
  on_date DATE NOT NULL,                                        -- what the deck counts
  slot TEXT NOT NULL DEFAULT 'dinner',
  servings NUMERIC NOT NULL DEFAULT 1,                          -- fractional allowed
  for_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT allocations_slot_valid CHECK (slot IN ('breakfast', 'lunch', 'dinner')),
  CONSTRAINT allocations_servings_positive CHECK (servings > 0)
);

CREATE INDEX idx_allocations_date ON allocations(house_id, on_date);
CREATE INDEX idx_allocations_component ON allocations(component_id);
CREATE INDEX idx_allocations_period ON allocations(period_id);

-- A "made" shopping list with a lifecycle; done lists are the shop history.
-- A receipt scanned in the Shops tab also lands here, born 'done'.
CREATE TABLE shopping_lists (
  id BIGSERIAL PRIMARY KEY,
  house_id BIGINT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  store_id BIGINT REFERENCES stores(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'building',   -- building | shopping | done
  source TEXT NOT NULL DEFAULT 'manual',     -- manual | receipt
  period_id BIGINT REFERENCES periods(id) ON DELETE SET NULL,  -- the plan it shops for
  purchased_on DATE,                          -- when the shop happened (may predate completed_at)
  receipt_total NUMERIC,                      -- total printed on the receipt, if scanned
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  total_paid NUMERIC                          -- sum of our line items
);

CREATE INDEX idx_shopping_lists_house ON shopping_lists(house_id, status);

-- A line here is a purchase: the same shape whether it was ticked off in the
-- shop or read off a receipt. Always a real ingredient — no loose names.
CREATE TABLE shopping_list_items (
  id BIGSERIAL PRIMARY KEY,
  house_id BIGINT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  list_id BIGINT REFERENCES shopping_lists(id) ON DELETE CASCADE,
  ingredient_id BIGINT NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1,
  bought BOOLEAN NOT NULL DEFAULT FALSE,
  bought_at TIMESTAMPTZ,
  price_paid NUMERIC,                         -- per unit
  unit_size_unit TEXT,                        -- pack size, e.g. "500g"
  for_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,  -- whose item, for settlement
  source TEXT NOT NULL DEFAULT 'manual',      -- manual | receipt-ai
  price_id BIGINT REFERENCES ingredient_prices(id) ON DELETE SET NULL,  -- the price this buy logged
  added_by BIGINT REFERENCES users(id),
  auto_generated BOOLEAN DEFAULT TRUE,        -- legacy, superseded by list_id/bought
  completed BOOLEAN DEFAULT FALSE,            -- legacy, superseded by bought
  meal_id BIGINT REFERENCES meals(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_shopping_list ON shopping_list_items(list_id);
CREATE INDEX idx_shopping_list_items_ingredient ON shopping_list_items(ingredient_id);

CREATE TABLE receipts (
  id BIGSERIAL PRIMARY KEY,
  house_id BIGINT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  uploaded_by BIGINT REFERENCES users(id),
  path TEXT,
  raw_text TEXT,
  parsed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);


-- Optionally: a small function/trigger to update updated_at on change
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to tables that have updated_at
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_ingredients') THEN
    CREATE TRIGGER set_updated_at_ingredients BEFORE UPDATE ON ingredients
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_meals') THEN
    CREATE TRIGGER set_updated_at_meals BEFORE UPDATE ON meals
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_shopping') THEN
    CREATE TRIGGER set_updated_at_shopping BEFORE UPDATE ON shopping_list_items
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
  END IF;
END;
$$;

