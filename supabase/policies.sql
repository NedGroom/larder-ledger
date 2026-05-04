-- LarderLedger RLS Policies
-- Run this in the Supabase SQL editor (NOT via supabase db push).
--
-- CURRENT STATE: Phase 1 — authenticated-only access.
-- All tables are restricted to signed-in users only.
-- Phase 2 (per-house isolation) requires migrating user_id columns from INTEGER to TEXT first.

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

-- PHASE 1: any signed-in user can access all data
-- This blocks unauthenticated (anon) access while the DB schema is fixed for house isolation.
CREATE POLICY "authenticated full access" ON houses              FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated full access" ON users               FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated full access" ON house_users         FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated full access" ON ingredients         FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated full access" ON ingredient_prices   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated full access" ON meals               FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated full access" ON meal_ingredients    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated full access" ON stores              FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated full access" ON shopping_list_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated full access" ON receipts            FOR ALL TO authenticated USING (true) WITH CHECK (true);
