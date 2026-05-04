-- Supabase RPC functions for larder_ledger
-- Apply via Supabase SQL editor or: psql <connection-url> -f supabase/functions.sql

-- ─────────────────────────────────────────────────────────────────────────────
-- FUNCTION 1: auto_generate_shopping_list(house_id)
-- Inserts a shopping_list_item row for every ingredient in the house where
-- has_any = false, skipping any that already have an open (completed=false)
-- entry. Returns the number of new rows inserted.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION auto_generate_shopping_list(p_house_id INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  inserted_count INTEGER;
BEGIN
  INSERT INTO shopping_list_items (house_id, ingredient_id, auto_generated, completed)
  SELECT
    i.house_id,
    i.id,
    TRUE,   -- auto_generated
    FALSE   -- not yet completed
  FROM ingredients i
  WHERE i.house_id = p_house_id
    AND i.has_any = FALSE
    -- skip if an open auto-generated entry already exists
    AND NOT EXISTS (
      SELECT 1
      FROM shopping_list_items s
      WHERE s.ingredient_id = i.id
        AND s.house_id      = p_house_id
        AND s.completed     = FALSE
    );

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

COMMENT ON FUNCTION auto_generate_shopping_list(INTEGER) IS
  'Inserts shopping_list_items for every ingredient with has_any=false '
  'that does not already have an open entry. Returns count of rows inserted.';


-- ─────────────────────────────────────────────────────────────────────────────
-- FUNCTION 2: meal_ingredient_fractions(house_id)
-- Returns one row per meal in the house containing:
--   meal_id, meal_name, total_ingredients, ingredients_present, fraction (0–1)
-- "present" means has_any = true on the linked ingredient.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION meal_ingredient_fractions(p_house_id INTEGER)
RETURNS TABLE (
  meal_id             INTEGER,
  meal_name           TEXT,
  total_ingredients   BIGINT,
  ingredients_present BIGINT,
  fraction            NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    m.id                                                        AS meal_id,
    m.name                                                      AS meal_name,
    COUNT(mi.id)                                                AS total_ingredients,
    COUNT(CASE WHEN i.has_any = TRUE THEN 1 END)                AS ingredients_present,
    CASE
      WHEN COUNT(mi.id) = 0 THEN NULL
      ELSE ROUND(
        COUNT(CASE WHEN i.has_any = TRUE THEN 1 END)::NUMERIC
        / COUNT(mi.id)::NUMERIC,
        4
      )
    END                                                         AS fraction
  FROM meals m
  LEFT JOIN meal_ingredients mi ON mi.meal_id = m.id
  LEFT JOIN ingredients       i  ON i.id = mi.ingredient_id
  WHERE m.house_id = p_house_id
  GROUP BY m.id, m.name
  ORDER BY fraction DESC NULLS LAST, m.name;
$$;

COMMENT ON FUNCTION meal_ingredient_fractions(INTEGER) IS
  'Returns per-meal ingredient availability fraction based on has_any. '
  'fraction=1.0 means all required ingredients are present.';

