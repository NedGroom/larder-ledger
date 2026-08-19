-- Retiring an ingredient without erasing its past.
--
-- Deleting one cascades into recipes, past shops and past cooks — history you
-- usually want to keep even when the ingredient itself was a mistake or a
-- duplicate. Archiving hides it from browsing and the deck while leaving every
-- row that references it intact.

ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_ingredients_house_active ON ingredients(house_id) WHERE NOT archived;
