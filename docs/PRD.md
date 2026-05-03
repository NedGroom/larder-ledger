LarderLedger — Product Requirements Document (PRD)

Purpose
- Define the product features, user stories, acceptance criteria, and the MVP release plan for LarderLedger.

Problem statement
- Housemates need an easy mobile‑friendly way to know what’s in the house, what meals are possible, and what to buy — with the ability to compare prices per store and spot expensive outliers.

Users & personas
- Housemate: adds ingredients and meals, toggles inventory, enters prices, uses shopping list.
- Shopper: uses shopping list on the go, checks per‑store prices and outliers.
- Tech lead / Admin: configures house settings and deploys.

Key features (MVP)
1. Ingredient management
   - Create/update/delete ingredients with name, canonical unit, unit aliases, optional quantity, and boolean `has_any`.
   - Ingredients belong to a house; default unit conversions are not required initially but multiple units accepted on entry.

2. Meal registry
   - Create meals containing name, dish type (enumeration), prep time, servings, tags, chef, list of ingredients (references to pantry items), and optional price‑per‑portion.
   - UI shows percentage of required ingredients present using `has_any` boolean.

3. Shopping list
   - Auto‑generate shopping list from ingredients with `has_any == false` (auto) and allow manual additions/removals.
   - Toggle to blend shopping list items into the full ingredient list for checklist behaviour.

4. Prices and stores
   - Stores are user‑defined at the house level.
   - For each ingredient/store pair allow manual price entry (price, unit, source).
   - Allow uploading receipts/photos to S3 and presenting candidate price entries for manual confirmation (OCR optional).

5. Price analysis
   - Views: Cupboard / Missing / Shopping list (user selectable). For the selected view, user can select a store and view per‑item prices for that store.
   - Highlight price outliers based on deviation from median across stores; compute store aggregate score on demand.

6. Collaboration & filters
   - Multi‑user house with realtime updates; chef tagging and meal filters (dish type, chef).

Non‑functional requirements
- Mobile‑first responsive UI (PWA). Simple, readable UX with bulletized lists.
- Local dev friendly: run locally with docker compose; simple CDK deployment for prod.
- Security: HTTPS, encrypted storage for sensitive data, JWT or Cognito for auth.

User stories & acceptance criteria (selected)
- US1: Add ingredient
  - Given a signed‑in user, when they add an ingredient with name and unit, it appears in the house ingredient list for all members.
- US2: Toggle inventory
  - When a user toggles `has_any` to false, the item is included in the shopping list within realtime bounds.
- US3: Register meal
  - When a meal is registered with linked ingredients, the meal list shows what fraction of ingredients are present (count of ingredients where `has_any==true` / total).
- US4: Enter price
  - Manual price entry persists and is visible when viewing the ingredient detail.
- US5: View store analysis
  - Selecting a view and a store shows prices and highlights items where the chosen store’s price deviates from the median by >25%.

MVP release plan (weeks)
- Week 0: Repo skeleton, infra skeleton (docker‑compose), basic auth.
- Week 1: Ingredient + meal CRUD, basic UI screens.
- Week 2: Shopping list generation, per‑store price fields, simple median calculation UI.
- Week 3: Realtime updates, receipts upload UI (manual review), acceptance tests.
- Week 4: Dev deploy, CI/CD, polish.

Metrics for success
- Time to complete core workflow (target <10 minutes for new user).
- Realtime propagation latency (target <5s typical).
- Basic usability feedback from 2–3 households in pilot.

Open questions (to confirm)
- Realtime approach preference (persistent backend vs serverless WebSockets).
- OCR approach for receipts (Textract vs Tesseract/local vs manual-only).


