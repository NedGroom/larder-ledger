-- LarderLedger Supabase schema (Postgres)
-- Run this in Supabase SQL editor or psql connected to your Supabase Postgres

-- NOTE: user_id fields are TEXT to store Supabase auth.uid() values

CREATE TABLE houses (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE house_users (
  house_id BIGINT REFERENCES houses(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
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
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX ux_ingredients_house_name_normalized ON ingredients(house_id, name_normalized);
CREATE INDEX idx_ingredients_house ON ingredients(house_id);

CREATE TABLE meals (
  id BIGSERIAL PRIMARY KEY,
  house_id BIGINT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  dish_type TEXT,
  prep_time_min INTEGER,
  servings INTEGER,
  price_per_portion NUMERIC,
  chef_user_id TEXT REFERENCES users(id),
  planned_date DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_meals_house ON meals(house_id);

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

CREATE TABLE shopping_list_items (
  id BIGSERIAL PRIMARY KEY,
  house_id BIGINT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  ingredient_id BIGINT NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  added_by TEXT REFERENCES users(id),
  auto_generated BOOLEAN DEFAULT TRUE,
  completed BOOLEAN DEFAULT FALSE,
  meal_id BIGINT REFERENCES meals(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_shopping_house ON shopping_list_items(house_id, completed);

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

