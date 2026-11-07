-- The assistant: Siri / chat / Claude acting on the larder through the larder-mcp
-- edge function (see web/src/lib/assistant.js).
--
-- 1. food_log: food eaten that isn't a planned meal ("had a Pret wrap"). Planned
--    meals already count toward a person's day through allocations, so this
--    holds only the extras. Figures are per portion; null means unknown.
-- 2. users.is_assistant: the assistant signs in as its own member of the house,
--    so RLS applies to it like anyone else and its writes are attributable.
-- 3. house_people(): members' names and daily targets. RLS on `users` only shows
--    a user their own row, which leaves the assistant unable to say whose day
--    it is counting. This exposes names and targets (not emails) to members only.

CREATE TABLE IF NOT EXISTS food_log (
  id          BIGSERIAL PRIMARY KEY,
  house_id    BIGINT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  eaten_on    DATE NOT NULL,
  slot        TEXT,
  description TEXT NOT NULL,
  grams       NUMERIC,
  kcal        NUMERIC,
  protein_g   NUMERIC,
  carbs_g     NUMERIC,
  fat_g       NUMERIC,
  fibre_g     NUMERIC,
  source      TEXT NOT NULL DEFAULT 'manual',   -- label | estimated | manual
  created_at  TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT food_log_slot_valid CHECK (slot IS NULL OR slot IN ('breakfast', 'lunch', 'dinner', 'snack')),
  CONSTRAINT food_log_source_valid CHECK (source IN ('label', 'estimated', 'manual')),
  CONSTRAINT food_log_kcal_sane CHECK (kcal IS NULL OR (kcal >= 0 AND kcal <= 3000))
);
CREATE INDEX IF NOT EXISTS idx_food_log_day ON food_log(house_id, eaten_on);

ALTER TABLE food_log ENABLE ROW LEVEL SECURITY;   -- policies.sql holds the policy itself

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_assistant BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION house_people(p_house_id BIGINT)
RETURNS TABLE (id BIGINT, name TEXT, is_assistant BOOLEAN,
               target_kcal NUMERIC, target_protein_g NUMERIC, target_fibre_g NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT u.id, u.name, u.is_assistant, u.target_kcal, u.target_protein_g, u.target_fibre_g
    FROM house_users hu JOIN users u ON u.id = hu.user_id
   WHERE hu.house_id = p_house_id
     AND EXISTS (SELECT 1 FROM house_users me JOIN users mu ON mu.id = me.user_id
                  WHERE me.house_id = p_house_id AND mu.auth_uid = auth.uid())
   ORDER BY u.is_assistant, u.id;
$$;
GRANT EXECUTE ON FUNCTION house_people(BIGINT) TO authenticated;
