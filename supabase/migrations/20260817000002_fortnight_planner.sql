-- The fortnight planner: periods, a deck of ingredient cards, cook sessions
-- that produce servings, and allocations that place those servings on days.
--
-- The load-bearing rule: cards are spent by ALLOCATION, not by cooking. A
-- period's deck is its targets minus every allocation dated inside its range,
-- regardless of which period owns the cook. That is what lets two overlapping
-- periods both count a shared day, and what lets a batch cooked into the
-- freezer cost nothing until a day is chosen for it.

-- ── Periods ──────────────────────────────────────────────────────────────────
-- User-defined and allowed to overlap.
CREATE TABLE IF NOT EXISTS periods (
  id BIGSERIAL PRIMARY KEY,
  house_id BIGINT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  name TEXT,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT periods_dates_ordered CHECK (ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS idx_periods_house ON periods(house_id, starts_on);

-- How many cards of an ingredient this period is aiming for. Own rows rather
-- than a column on ingredients, so editing one period never rewrites another.
CREATE TABLE IF NOT EXISTS ingredient_targets (
  id BIGSERIAL PRIMARY KEY,
  period_id BIGINT NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
  ingredient_id BIGINT NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  target_cards NUMERIC NOT NULL DEFAULT 0,
  UNIQUE (period_id, ingredient_id)
);

CREATE INDEX IF NOT EXISTS idx_ingredient_targets_period ON ingredient_targets(period_id);

-- ── Cooks and the servings they produce ──────────────────────────────────────
-- A session is valid even when nothing is actually cooked (salads, yoghurt).
CREATE TABLE IF NOT EXISTS cooks (
  id BIGSERIAL PRIMARY KEY,
  house_id BIGINT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  period_id BIGINT REFERENCES periods(id) ON DELETE SET NULL,
  cook_date DATE NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cooks_house ON cooks(house_id, cook_date);
CREATE INDEX IF NOT EXISTS idx_cooks_period ON cooks(period_id);

-- One batch of one thing. This is also the fridge inventory record: anything
-- not yet eaten or gone is food that physically exists.
CREATE TABLE IF NOT EXISTS cook_components (
  id BIGSERIAL PRIMARY KEY,
  house_id BIGINT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  cook_id BIGINT NOT NULL REFERENCES cooks(id) ON DELETE CASCADE,
  meal_id BIGINT REFERENCES meals(id) ON DELETE SET NULL,        -- dish/variant it came from
  ingredient_id BIGINT REFERENCES ingredients(id) ON DELETE SET NULL, -- set when it's a bare ingredient
  name TEXT NOT NULL,                                            -- snapshot label
  servings_planned NUMERIC NOT NULL DEFAULT 1,
  cooked_date DATE,                    -- may differ from the session's date
  frozen BOOLEAN NOT NULL DEFAULT FALSE,
  eaten BOOLEAN NOT NULL DEFAULT FALSE,
  gone BOOLEAN NOT NULL DEFAULT FALSE, -- neutral: wasted, given away, taken out
  gone_note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT cook_components_servings_positive CHECK (servings_planned > 0)
);

CREATE INDEX IF NOT EXISTS idx_cook_components_cook ON cook_components(cook_id);
CREATE INDEX IF NOT EXISTS idx_cook_components_house ON cook_components(house_id);

-- A frozen copy of what the component actually requires, scaled to its planned
-- servings. Copied, never referenced, so editing a dish cannot rewrite a cook
-- that already happened — and so "what did this batch need" stays answerable.
CREATE TABLE IF NOT EXISTS cook_component_ingredients (
  id BIGSERIAL PRIMARY KEY,
  component_id BIGINT NOT NULL REFERENCES cook_components(id) ON DELETE CASCADE,
  ingredient_id BIGINT NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  qty_total NUMERIC,        -- normalised g/ml across all planned servings
  qty_text TEXT             -- as originally typed, for display
);

CREATE INDEX IF NOT EXISTS idx_cci_component ON cook_component_ingredients(component_id);

-- ── Allocations ──────────────────────────────────────────────────────────────
-- One serving, on a day, in a slot, for someone. period_id records which plan
-- owns it (editability); the deck arithmetic ignores it and works off on_date.
CREATE TABLE IF NOT EXISTS allocations (
  id BIGSERIAL PRIMARY KEY,
  house_id BIGINT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  component_id BIGINT NOT NULL REFERENCES cook_components(id) ON DELETE CASCADE,
  period_id BIGINT REFERENCES periods(id) ON DELETE SET NULL,
  on_date DATE NOT NULL,
  slot TEXT NOT NULL DEFAULT 'dinner',
  servings NUMERIC NOT NULL DEFAULT 1,      -- fractional allowed
  for_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT allocations_slot_valid CHECK (slot IN ('breakfast', 'lunch', 'dinner')),
  CONSTRAINT allocations_servings_positive CHECK (servings > 0)
);

CREATE INDEX IF NOT EXISTS idx_allocations_date ON allocations(house_id, on_date);
CREATE INDEX IF NOT EXISTS idx_allocations_component ON allocations(component_id);
CREATE INDEX IF NOT EXISTS idx_allocations_period ON allocations(period_id);

-- ── Dishes gain cuisine-style categories ─────────────────────────────────────
-- Reuses the ingredient categories table. `meals.dish_type` is a different
-- axis (meal / side / starter) and stays as it is.
CREATE TABLE IF NOT EXISTS meal_categories (
  meal_id     BIGINT NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  category_id BIGINT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (meal_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_meal_categories_category ON meal_categories(category_id);

-- ── Ingredients: deck weight, stock detail, nutrients ────────────────────────
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS card_weight NUMERIC;       -- g/ml one deck card is worth
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS qualitative_note TEXT;     -- "1 handful ≈ 30g", reference only
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS stock_qty NUMERIC;         -- optional detail beside has_any
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS stock_unit TEXT;

-- Nutrients per 100g/ml. NULL means unknown and must stay distinguishable from
-- zero, or the analyse view will confidently report a day as low in something
-- it simply has no data for.
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS kcal_per_100    NUMERIC;
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS protein_per_100 NUMERIC;
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS fibre_per_100   NUMERIC;
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS carbs_per_100   NUMERIC;
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS fat_per_100     NUMERIC;

-- ── Recipe quantities become computable ──────────────────────────────────────
-- required_quantity + required_unit stay as the human phrasing ("2 tins").
-- qty_normalised is the same amount in g/ml for the WHOLE dish; blank counts
-- as zero rather than blocking anything.
ALTER TABLE meal_ingredients ADD COLUMN IF NOT EXISTS qty_normalised NUMERIC;

-- ── Personal nutrition targets ───────────────────────────────────────────────
-- Per person, not per period, and unrelated to ingredient card targets.
ALTER TABLE users ADD COLUMN IF NOT EXISTS target_kcal      NUMERIC;
ALTER TABLE users ADD COLUMN IF NOT EXISTS target_protein_g NUMERIC;
ALTER TABLE users ADD COLUMN IF NOT EXISTS target_fibre_g   NUMERIC;

-- ── Planning is no longer a property of a dish ───────────────────────────────
-- A dish could only ever be planned once; allocations replace it, and the
-- Calendar now reads those.
ALTER TABLE meals DROP COLUMN IF EXISTS planned_date;

-- A shop can be tied to the period it was planned for. A period always ends up
-- with at least one, and may gain more later — it never closes.
ALTER TABLE shopping_lists ADD COLUMN IF NOT EXISTS period_id BIGINT REFERENCES periods(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_shopping_lists_period ON shopping_lists(period_id);
