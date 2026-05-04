-- Migration: meal planning
-- - Add planned_date to meals
-- - Add meal_id to shopping_list_items

ALTER TABLE meals
  ADD COLUMN IF NOT EXISTS planned_date DATE;

ALTER TABLE shopping_list_items
  ADD COLUMN IF NOT EXISTS meal_id BIGINT REFERENCES meals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_meals_planned_date ON meals(house_id, planned_date);
CREATE INDEX IF NOT EXISTS idx_shopping_meal ON shopping_list_items(meal_id);

