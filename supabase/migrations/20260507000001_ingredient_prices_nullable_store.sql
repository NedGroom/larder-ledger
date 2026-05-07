-- Make store_id nullable on ingredient_prices so a price can be recorded
-- without knowing the store (e.g. from a receipt with no store selected).
ALTER TABLE ingredient_prices ALTER COLUMN store_id DROP NOT NULL;

