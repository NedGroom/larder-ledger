-- RLS / policies for larder_ledger
-- WARNING: These policies are intentionally permissive to make initial testing easy.
-- For production you should tighten policies to enforce ownership/house membership
-- and map your auth.uid() (typically a UUID) to the integer users.id in this DB.

-- Enable RLS on all app tables
ALTER TABLE IF EXISTS houses              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS house_users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ingredients         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ingredient_prices   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS meals               ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS meal_ingredients    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS stores              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS shopping_list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS receipts            ENABLE ROW LEVEL SECURITY;

-- Example permissive policies for testing with an 'authenticated' role
-- Adjust these to implement proper checks (uploaded_by, house membership, etc.)

DROP POLICY IF EXISTS "Allow authenticated select on receipts" ON receipts;
CREATE POLICY "Allow authenticated select on receipts"
  ON receipts FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Allow authenticated insert on receipts" ON receipts;
CREATE POLICY "Allow authenticated insert on receipts"
  ON receipts FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated update on receipts" ON receipts;
CREATE POLICY "Allow authenticated update on receipts"
  ON receipts FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Similarly for ingredients and prices (permissive for testing)
DROP POLICY IF EXISTS "Allow authenticated select on ingredients" ON ingredients;
CREATE POLICY "Allow authenticated select on ingredients"
  ON ingredients FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Allow authenticated insert on ingredients" ON ingredients;
CREATE POLICY "Allow authenticated insert on ingredients"
  ON ingredients FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated select on ingredient_prices" ON ingredient_prices;
CREATE POLICY "Allow authenticated select on ingredient_prices"
  ON ingredient_prices FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Allow authenticated insert on ingredient_prices" ON ingredient_prices;
CREATE POLICY "Allow authenticated insert on ingredient_prices"
  ON ingredient_prices FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Grant execute on RPC functions to authenticated users
GRANT EXECUTE ON FUNCTION auto_generate_shopping_list(INTEGER)  TO authenticated;
GRANT EXECUTE ON FUNCTION meal_ingredient_fractions(INTEGER)    TO authenticated;

-- ── Permissive policies for all tables (testing — tighten for production) ─────
-- houses
DROP POLICY IF EXISTS "auth select houses"  ON houses;
DROP POLICY IF EXISTS "auth insert houses"  ON houses;
CREATE POLICY "auth select houses" ON houses FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert houses" ON houses FOR INSERT TO authenticated WITH CHECK (true);

-- meals
DROP POLICY IF EXISTS "auth select meals"  ON meals;
DROP POLICY IF EXISTS "auth insert meals"  ON meals;
CREATE POLICY "auth select meals" ON meals FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert meals" ON meals FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update meals" ON meals FOR UPDATE TO authenticated USING (true);

-- meal_ingredients
DROP POLICY IF EXISTS "auth select meal_ingredients"  ON meal_ingredients;
DROP POLICY IF EXISTS "auth insert meal_ingredients"  ON meal_ingredients;
CREATE POLICY "auth select meal_ingredients" ON meal_ingredients FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert meal_ingredients" ON meal_ingredients FOR INSERT TO authenticated WITH CHECK (true);

-- stores
DROP POLICY IF EXISTS "auth select stores"  ON stores;
DROP POLICY IF EXISTS "auth insert stores"  ON stores;
CREATE POLICY "auth select stores" ON stores FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert stores" ON stores FOR INSERT TO authenticated WITH CHECK (true);

-- shopping_list_items
DROP POLICY IF EXISTS "auth select shopping_list_items"  ON shopping_list_items;
DROP POLICY IF EXISTS "auth insert shopping_list_items"  ON shopping_list_items;
DROP POLICY IF EXISTS "auth update shopping_list_items"  ON shopping_list_items;
DROP POLICY IF EXISTS "auth delete shopping_list_items"  ON shopping_list_items;
CREATE POLICY "auth select shopping_list_items" ON shopping_list_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert shopping_list_items" ON shopping_list_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update shopping_list_items" ON shopping_list_items FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth delete shopping_list_items" ON shopping_list_items FOR DELETE TO authenticated USING (true);

-- NOTE: For proper security, replace the USING/WITH CHECK expressions above with
-- checks such as: uploaded_by = (select id from users where auth.uid() = users.auth_uid)
-- or: house_id IN (SELECT house_id FROM house_users WHERE user_id = <mapped user id>)
-- Supabase provides auth.uid() (UUID) and request.jwt.claims; adapt accordingly.

