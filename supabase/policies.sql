-- LarderLedger RLS Policies
-- Run this in the Supabase SQL editor OR via: supabase db query --linked -f supabase/policies.sql
--
-- Uses users.auth_uid (UUID) to bridge Supabase auth.uid() to integer user IDs.
-- House isolation: a user can only access data for houses they are in via house_users.

-- ENABLE RLS (idempotent)
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

-- GRANT RPC functions to authenticated users
GRANT EXECUTE ON FUNCTION auto_generate_shopping_list(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION meal_ingredient_fractions(INTEGER)   TO authenticated;

-- HELPER: returns true if the logged-in user is a member of the given house
-- Joins house_users -> users via integer id, then checks auth_uid = auth.uid()
CREATE OR REPLACE FUNCTION is_house_member(p_house_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM house_users hu
    JOIN users u ON u.id = hu.user_id
    WHERE hu.house_id = p_house_id
      AND u.auth_uid = auth.uid()
  );
$$;

-- Drop all existing policies before recreating
DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN (
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'public'
  ) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- POLICIES: houses
CREATE POLICY "houses: read public or member"    ON houses FOR SELECT USING (is_public = true OR is_house_member(id));
CREATE POLICY "houses: authenticated can create" ON houses FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "houses: members can update"       ON houses FOR UPDATE USING (is_house_member(id));

-- POLICIES: users — own row only
CREATE POLICY "users: read own"   ON users FOR SELECT USING    (auth_uid = auth.uid());
CREATE POLICY "users: insert own" ON users FOR INSERT WITH CHECK (auth_uid = auth.uid());
CREATE POLICY "users: update own" ON users FOR UPDATE USING    (auth_uid = auth.uid());

-- POLICIES: house_users
CREATE POLICY "house_users: members can read" ON house_users FOR SELECT USING (is_house_member(house_id));
CREATE POLICY "house_users: insert own"       ON house_users FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = user_id AND auth_uid = auth.uid()));
CREATE POLICY "house_users: delete own"       ON house_users FOR DELETE
  USING (EXISTS (SELECT 1 FROM users WHERE id = user_id AND auth_uid = auth.uid()));

-- POLICIES: ingredients, meals, stores, shopping_list_items, receipts
CREATE POLICY "ingredients: house members"         ON ingredients         FOR ALL USING (is_house_member(house_id)) WITH CHECK (is_house_member(house_id));
CREATE POLICY "meals: house members"               ON meals               FOR ALL USING (is_house_member(house_id)) WITH CHECK (is_house_member(house_id));
CREATE POLICY "stores: house members"              ON stores              FOR ALL USING (is_house_member(house_id)) WITH CHECK (is_house_member(house_id));
CREATE POLICY "shopping_list_items: house members" ON shopping_list_items FOR ALL USING (is_house_member(house_id)) WITH CHECK (is_house_member(house_id));
CREATE POLICY "receipts: house members"            ON receipts            FOR ALL USING (is_house_member(house_id)) WITH CHECK (is_house_member(house_id));

-- POLICIES: meal_ingredients, ingredient_prices — via parent table
CREATE POLICY "meal_ingredients: house members"
  ON meal_ingredients FOR ALL
  USING (is_house_member((SELECT house_id FROM meals WHERE id = meal_id)))
  WITH CHECK (is_house_member((SELECT house_id FROM meals WHERE id = meal_id)));

CREATE POLICY "ingredient_prices: house members"
  ON ingredient_prices FOR ALL
  USING (is_house_member((SELECT house_id FROM ingredients WHERE id = ingredient_id)))
  WITH CHECK (is_house_member((SELECT house_id FROM ingredients WHERE id = ingredient_id)));
