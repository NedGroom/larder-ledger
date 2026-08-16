-- LarderLedger Supabase schema (Postgres)
-- Run this in Supabase SQL editor or psql connected to your Supabase Postgres

-- NOTE: user_id fields are TEXT to store Supabase auth.uid() values

CREATE TABLE houses (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  auth_uid UUID UNIQUE,          -- Supabase auth.uid() — used for RLS
  email TEXT,
  name TEXT,
  hashed_password TEXT,
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
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX ux_ingredients_house_name_normalized ON ingredients(house_id, name_normalized);
CREATE INDEX idx_ingredients_house ON ingredients(house_id);

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
  chef_user_id TEXT REFERENCES users(id),
  planned_date DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_meals_house ON meals(house_id);
CREATE INDEX idx_meals_parent ON meals(parent_id);

CREATE TABLE meal_ingredients (
  id BIGSERIAL PRIMARY KEY,
  meal_id BIGINT NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  ingredient_id BIGINT NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  required_quantity NUMERIC,
  required_unit TEXT
);

CREATE TABLE stores (
  id BIGSERIAL PRIMARY KEY,
  house_id BIGINT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_stores_house ON stores(house_id);

CREATE TABLE ingredient_prices (
  id BIGSERIAL PRIMARY KEY,
  ingredient_id BIGINT NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  store_id BIGINT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  price NUMERIC NOT NULL,
  unit_size NUMERIC,
  unit_size_unit TEXT,
  price_per_canonical NUMERIC,
  currency TEXT DEFAULT 'GBP',
  source TEXT,
  noted_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT REFERENCES users(id)
);

CREATE INDEX idx_prices_ingredient ON ingredient_prices(ingredient_id);
CREATE INDEX idx_prices_store ON ingredient_prices(store_id);

-- A "made" shopping list with a lifecycle; done lists are the shop history.
CREATE TABLE shopping_lists (
  id BIGSERIAL PRIMARY KEY,
  house_id BIGINT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  store_id BIGINT REFERENCES stores(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'building',   -- building | shopping | done
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  total_paid NUMERIC
);

CREATE INDEX idx_shopping_lists_house ON shopping_lists(house_id, status);

CREATE TABLE shopping_list_items (
  id BIGSERIAL PRIMARY KEY,
  house_id BIGINT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  list_id BIGINT REFERENCES shopping_lists(id) ON DELETE CASCADE,
  ingredient_id BIGINT REFERENCES ingredients(id) ON DELETE CASCADE,  -- nullable: one-off items
  custom_name TEXT,                          -- name for one-off (non-Larder) items
  quantity INTEGER NOT NULL DEFAULT 1,
  bought BOOLEAN NOT NULL DEFAULT FALSE,
  bought_at TIMESTAMPTZ,
  price_paid NUMERIC,                         -- per unit
  added_by TEXT REFERENCES users(id),
  auto_generated BOOLEAN DEFAULT TRUE,        -- legacy, superseded by list_id/bought
  completed BOOLEAN DEFAULT FALSE,            -- legacy, superseded by bought
  meal_id BIGINT REFERENCES meals(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_shopping_list ON shopping_list_items(list_id);

CREATE TABLE receipts (
  id BIGSERIAL PRIMARY KEY,
  house_id BIGINT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  uploaded_by TEXT REFERENCES users(id),
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

