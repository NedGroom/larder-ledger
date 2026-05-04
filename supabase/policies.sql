-- LarderLedger RLS Policies
-- Run this in the Supabase SQL editor (NOT via supabase db push).
-- auth.uid() only works correctly in the dashboard SQL editor context.
--
-- This replaces the old permissive test policies with proper house-membership checks.
-- A user can only see/write data belonging to houses they are a member of (house_users).

-- ─────────────────────────────────────────────────────────────────────────────
-- ENABLE RLS (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE IF EXISTS houses              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS house_users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ingredients         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ingredient_prices   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS meals               ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS meal_ingredients    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS stores              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS shopping_list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS receipts            ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- HELPER FUNCTION: is the logged-in user a member of a given house?
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION is_house_member(p_house_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM house_users
    WHERE house_id = p_house_id
      AND user_id  = auth.uid()::TEXT
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- AUTO-REGISTER trigger: mirror new Supabase auth users into public.users
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email)
  VALUES (NEW.id::TEXT, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- GRANT RPC functions to authenticated users
-- ─────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION auto_generate_shopping_list(INTEGER)  TO authenticated;
GRANT EXECUTE ON FUNCTION meal_ingredient_fractions(INTEGER)    TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- POLICIES: houses
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth select houses"        ON houses;
DROP POLICY IF EXISTS "auth insert houses"        ON houses;
DROP POLICY IF EXISTS "houses: members can read"  ON houses;
DROP POLICY IF EXISTS "houses: any authed user can create" ON houses;
DROP POLICY IF EXISTS "houses: members can update" ON houses;

CREATE POLICY "houses: members can read"
  ON houses FOR SELECT
  USING (is_house_member(id));

CREATE POLICY "houses: any authed user can create"
  ON houses FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "houses: members can update"
  ON houses FOR UPDATE
  USING (is_house_member(id));

-- ─────────────────────────────────────────────────────────────────────────────
-- POLICIES: users
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "users: read own row"   ON users;
DROP POLICY IF EXISTS "users: insert own row" ON users;
DROP POLICY IF EXISTS "users: update own row" ON users;

CREATE POLICY "users: read own row"
  ON users FOR SELECT
  USING (id = auth.uid()::TEXT);

CREATE POLICY "users: insert own row"
  ON users FOR INSERT
  WITH CHECK (id = auth.uid()::TEXT);

CREATE POLICY "users: update own row"
  ON users FOR UPDATE
  USING (id = auth.uid()::TEXT);

-- ─────────────────────────────────────────────────────────────────────────────
-- POLICIES: house_users
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "house_users: members can read"              ON house_users;
DROP POLICY IF EXISTS "house_users: user can insert own membership" ON house_users;
DROP POLICY IF EXISTS "house_users: user can delete own membership" ON house_users;

CREATE POLICY "house_users: members can read"
  ON house_users FOR SELECT
  USING (is_house_member(house_id));

CREATE POLICY "house_users: user can insert own membership"
  ON house_users FOR INSERT
  WITH CHECK (user_id = auth.uid()::TEXT);

CREATE POLICY "house_users: user can delete own membership"
  ON house_users FOR DELETE
  USING (user_id = auth.uid()::TEXT);

-- ─────────────────────────────────────────────────────────────────────────────
-- POLICIES: ingredients
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow authenticated select on ingredients" ON ingredients;
DROP POLICY IF EXISTS "Allow authenticated insert on ingredients" ON ingredients;
DROP POLICY IF EXISTS "ingredients: house members full access"    ON ingredients;

CREATE POLICY "ingredients: house members full access"
  ON ingredients FOR ALL
  USING (is_house_member(house_id))
  WITH CHECK (is_house_member(house_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- POLICIES: meals
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth select meals"              ON meals;
DROP POLICY IF EXISTS "auth insert meals"              ON meals;
DROP POLICY IF EXISTS "auth update meals"              ON meals;
DROP POLICY IF EXISTS "meals: house members full access" ON meals;

CREATE POLICY "meals: house members full access"
  ON meals FOR ALL
  USING (is_house_member(house_id))
  WITH CHECK (is_house_member(house_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- POLICIES: meal_ingredients (access via parent meal)
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth select meal_ingredients"              ON meal_ingredients;
DROP POLICY IF EXISTS "auth insert meal_ingredients"              ON meal_ingredients;
DROP POLICY IF EXISTS "meal_ingredients: house members full access" ON meal_ingredients;

CREATE POLICY "meal_ingredients: house members full access"
  ON meal_ingredients FOR ALL
  USING (is_house_member((SELECT house_id FROM meals WHERE id = meal_id)))
  WITH CHECK (is_house_member((SELECT house_id FROM meals WHERE id = meal_id)));

-- ─────────────────────────────────────────────────────────────────────────────
-- POLICIES: stores
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth select stores"            ON stores;
DROP POLICY IF EXISTS "auth insert stores"            ON stores;
DROP POLICY IF EXISTS "stores: house members full access" ON stores;

CREATE POLICY "stores: house members full access"
  ON stores FOR ALL
  USING (is_house_member(house_id))
  WITH CHECK (is_house_member(house_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- POLICIES: ingredient_prices (access via parent ingredient's house)
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow authenticated select on ingredient_prices" ON ingredient_prices;
DROP POLICY IF EXISTS "Allow authenticated insert on ingredient_prices" ON ingredient_prices;
DROP POLICY IF EXISTS "ingredient_prices: house members full access"    ON ingredient_prices;

CREATE POLICY "ingredient_prices: house members full access"
  ON ingredient_prices FOR ALL
  USING (is_house_member((SELECT house_id FROM ingredients WHERE id = ingredient_id)))
  WITH CHECK (is_house_member((SELECT house_id FROM ingredients WHERE id = ingredient_id)));

-- ─────────────────────────────────────────────────────────────────────────────
-- POLICIES: shopping_list_items
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth select shopping_list_items" ON shopping_list_items;
DROP POLICY IF EXISTS "auth insert shopping_list_items" ON shopping_list_items;
DROP POLICY IF EXISTS "auth update shopping_list_items" ON shopping_list_items;
DROP POLICY IF EXISTS "auth delete shopping_list_items" ON shopping_list_items;
DROP POLICY IF EXISTS "shopping_list_items: house members full access" ON shopping_list_items;

CREATE POLICY "shopping_list_items: house members full access"
  ON shopping_list_items FOR ALL
  USING (is_house_member(house_id))
  WITH CHECK (is_house_member(house_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- POLICIES: receipts
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow authenticated select on receipts" ON receipts;
DROP POLICY IF EXISTS "Allow authenticated insert on receipts" ON receipts;
DROP POLICY IF EXISTS "Allow authenticated update on receipts" ON receipts;
DROP POLICY IF EXISTS "receipts: house members full access"    ON receipts;

CREATE POLICY "receipts: house members full access"
  ON receipts FOR ALL
  USING (is_house_member(house_id))
  WITH CHECK (is_house_member(house_id));
