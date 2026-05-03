-- Supabase Row Level Security (RLS) policies for LarderLedger
-- Run after creating the tables. These are example policies and should be reviewed.

-- Enable RLS on tables
ALTER TABLE ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE houses ENABLE ROW LEVEL SECURITY;
ALTER TABLE house_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE meals ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredient_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopping_list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;

-- Helper function: check membership
CREATE OR REPLACE FUNCTION is_house_member(hid BIGINT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM house_users hu WHERE hu.house_id = hid AND hu.user_id = auth.uid());
$$;

-- Houses: allow insert for authenticated users; select if member; update/delete if member (owners may add extra rules)
CREATE POLICY "houses_select_members" ON houses FOR SELECT USING (EXISTS(SELECT 1 FROM house_users hu WHERE hu.house_id = houses.id AND hu.user_id = auth.uid()));
CREATE POLICY "houses_insert_auth" ON houses FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "houses_update_members" ON houses FOR UPDATE USING (EXISTS(SELECT 1 FROM house_users hu WHERE hu.house_id = houses.id AND hu.user_id = auth.uid()));
CREATE POLICY "houses_delete_members" ON houses FOR DELETE USING (EXISTS(SELECT 1 FROM house_users hu WHERE hu.house_id = houses.id AND hu.user_id = auth.uid()));

-- House_users: allow insert if user is same as auth.uid (join a house) OR existing member can invite
CREATE POLICY "house_users_insert_self" ON house_users FOR INSERT WITH CHECK (new.user_id = auth.uid());
CREATE POLICY "house_users_select_member" ON house_users FOR SELECT USING (house_users.user_id = auth.uid() OR EXISTS(SELECT 1 FROM house_users hu WHERE hu.house_id = house_users.house_id AND hu.user_id = auth.uid()));

-- Ingredients: only members of the house can select/insert/update/delete
CREATE POLICY "ingredients_select" ON ingredients FOR SELECT USING (is_house_member(house_id));
CREATE POLICY "ingredients_insert" ON ingredients FOR INSERT WITH CHECK (is_house_member(new.house_id));
CREATE POLICY "ingredients_update" ON ingredients FOR UPDATE USING (is_house_member(house_id));
CREATE POLICY "ingredients_delete" ON ingredients FOR DELETE USING (is_house_member(house_id));

-- Meals
CREATE POLICY "meals_select" ON meals FOR SELECT USING (is_house_member(house_id));
CREATE POLICY "meals_insert" ON meals FOR INSERT WITH CHECK (is_house_member(new.house_id));
CREATE POLICY "meals_update" ON meals FOR UPDATE USING (is_house_member(house_id));
CREATE POLICY "meals_delete" ON meals FOR DELETE USING (is_house_member(house_id));

-- Meal ingredients
CREATE POLICY "meal_ingredients_select" ON meal_ingredients FOR SELECT USING (EXISTS (SELECT 1 FROM meals m WHERE m.id = meal_ingredients.meal_id AND is_house_member(m.house_id)));
CREATE POLICY "meal_ingredients_insert" ON meal_ingredients FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM meals m WHERE m.id = new.meal_id AND is_house_member(m.house_id)));
CREATE POLICY "meal_ingredients_update" ON meal_ingredients FOR UPDATE USING (EXISTS (SELECT 1 FROM meals m WHERE m.id = meal_ingredients.meal_id AND is_house_member(m.house_id)));
CREATE POLICY "meal_ingredients_delete" ON meal_ingredients FOR DELETE USING (EXISTS (SELECT 1 FROM meals m WHERE m.id = meal_ingredients.meal_id AND is_house_member(m.house_id)));

-- Stores
CREATE POLICY "stores_select" ON stores FOR SELECT USING (is_house_member(house_id));
CREATE POLICY "stores_insert" ON stores FOR INSERT WITH CHECK (is_house_member(new.house_id));
CREATE POLICY "stores_update" ON stores FOR UPDATE USING (is_house_member(house_id));
CREATE POLICY "stores_delete" ON stores FOR DELETE USING (is_house_member(house_id));

-- Ingredient prices
CREATE POLICY "prices_select" ON ingredient_prices FOR SELECT USING (EXISTS (SELECT 1 FROM ingredients i WHERE i.id = ingredient_prices.ingredient_id AND is_house_member(i.house_id)));
CREATE POLICY "prices_insert" ON ingredient_prices FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM ingredients i WHERE i.id = new.ingredient_id AND is_house_member(i.house_id)));
CREATE POLICY "prices_update" ON ingredient_prices FOR UPDATE USING (EXISTS (SELECT 1 FROM ingredients i WHERE i.id = ingredient_prices.ingredient_id AND is_house_member(i.house_id)));
CREATE POLICY "prices_delete" ON ingredient_prices FOR DELETE USING (EXISTS (SELECT 1 FROM ingredients i WHERE i.id = ingredient_prices.ingredient_id AND is_house_member(i.house_id)));

-- Shopping list
CREATE POLICY "shopping_select" ON shopping_list_items FOR SELECT USING (is_house_member(house_id));
CREATE POLICY "shopping_insert" ON shopping_list_items FOR INSERT WITH CHECK (is_house_member(new.house_id));
CREATE POLICY "shopping_update" ON shopping_list_items FOR UPDATE USING (is_house_member(house_id));
CREATE POLICY "shopping_delete" ON shopping_list_items FOR DELETE USING (is_house_member(house_id));

-- Receipts
CREATE POLICY "receipts_select" ON receipts FOR SELECT USING (is_house_member(house_id));
CREATE POLICY "receipts_insert" ON receipts FOR INSERT WITH CHECK (is_house_member(new.house_id));
CREATE POLICY "receipts_update" ON receipts FOR UPDATE USING (is_house_member(house_id));
CREATE POLICY "receipts_delete" ON receipts FOR DELETE USING (is_house_member(house_id));

-- Allow authenticated users to read their own user record
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_select_self" ON users FOR SELECT USING (users.id = auth.uid());
CREATE POLICY "users_insert" ON users FOR INSERT WITH CHECK (new.id = auth.uid());
CREATE POLICY "users_update_self" ON users FOR UPDATE USING (users.id = auth.uid());

-- IMPORTANT: After applying policies, consider testing thoroughly with a test user to ensure RLS behaves as expected.

