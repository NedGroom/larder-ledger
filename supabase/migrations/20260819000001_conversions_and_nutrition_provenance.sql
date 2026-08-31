-- Making the planner's inputs enterable.
--
-- Three gaps, all of which made the planner quietly report zero rather than
-- admit it didn't know:
--   1. Recipe units the app can't convert ("1 tin") normalised to null, and a
--      null quantity contributes nothing to either the deck or nutrition.
--      `qualitative_note` held exactly the fact needed to fix that — as free
--      text nothing could read.
--   2. Nutrition had no provenance, so a rough guess and a figure read off the
--      packet were indistinguishable.
--   3. Stock quantity was write-only.

-- ── Per-ingredient unit conversions ──────────────────────────────────────────
-- "1 tin = 400 g", "1 handful = 30 g". Scoped to the ingredient because a tin
-- of tomatoes and a tin of anchovies are not the same weight.
CREATE TABLE IF NOT EXISTS ingredient_units (
  id            BIGSERIAL PRIMARY KEY,
  ingredient_id BIGINT NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  label         TEXT   NOT NULL,          -- 'tin', 'handful', 'clove'
  grams         NUMERIC NOT NULL CHECK (grams > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One weight per name per ingredient. Case-insensitive: "Tin" and "tin" are
-- the same measure typed twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ingredient_units_unique
  ON ingredient_units (ingredient_id, LOWER(label));

-- ── Where a nutrition figure came from ───────────────────────────────────────
-- 'label'     — read off a photographed packet
-- 'estimated' — guessed by the model from the name, never verified
-- 'manual'    — typed in by hand
-- NULL        — pre-dates this column; treat as manual
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS nutrition_source TEXT
  CHECK (nutrition_source IN ('label', 'estimated', 'manual'));
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS nutrition_noted_at TIMESTAMPTZ;

-- What the packet said it weighed, when a label was photographed — the honest
-- basis for a card-weight suggestion.
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS pack_grams NUMERIC;

-- Anything already carrying nutrition was typed by hand.
UPDATE ingredients SET nutrition_source = 'manual'
 WHERE nutrition_source IS NULL
   AND (kcal_per_100 IS NOT NULL OR protein_per_100 IS NOT NULL OR fibre_per_100 IS NOT NULL
        OR carbs_per_100 IS NOT NULL OR fat_per_100 IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_ingredient_units_ingredient ON ingredient_units(ingredient_id);
