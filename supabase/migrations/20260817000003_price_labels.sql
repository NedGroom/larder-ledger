-- Name the product a price was for.
--
-- A price row could say "500g" but never "5% fat" or "large" — so two genuinely
-- different products under one ingredient were indistinguishable. The receipt
-- parser was already extracting the full line ("BEEF MINCE 5% 500G") and then
-- discarding it; this gives it somewhere to land.

ALTER TABLE ingredient_prices ADD COLUMN IF NOT EXISTS label TEXT;
