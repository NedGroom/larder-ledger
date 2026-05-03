LarderLedger — Technical Design Document (TDD)

Goals
- Provide concrete implementation guidance for the MVP using Python + FastAPI, Postgres, and AWS CDK.

Chosen stack (MVP)
- Backend: Python 3.11, FastAPI, uvicorn
- Database: PostgreSQL (RDS for prod; dockerized Postgres for dev)
- Frontend: React + TypeScript PWA (mobile‑first)
- Storage: S3 for receipt images
- Infra: AWS CDK (Python) for prod stacks; docker‑compose for local
- Realtime: WebSockets via FastAPI (run as a persistent service on ECS Fargate / or local dev server)
- OCR (optional): AWS Textract (prod), Tesseract fallback (dev)

Database schema (core tables)
- users: id (PK), email, name, hashed_password, created_at
- houses: id, name, created_at
- house_users: house_id, user_id, role
- ingredients: id, house_id, name, canonical_unit, unit_aliases JSON, has_any boolean, quantity_value numeric, quantity_unit varchar, created_by, created_at
- meals: id, house_id, name, dish_type varchar, prep_time_min int, servings int, price_per_portion numeric, chef_user_id, created_at
- meal_ingredients: id, meal_id, ingredient_id, required_quantity numeric, required_unit varchar
- stores: id, house_id, name, created_by
- ingredient_prices: id, ingredient_id, store_id, price numeric, unit varchar, source varchar, noted_at, created_by
- shopping_list_items: id, house_id, ingredient_id, added_by, auto_generated boolean, completed boolean, created_at
- receipts: id, house_id, uploaded_by, s3_key, raw_text, parsed boolean, created_at

API surface (selected endpoints)
- POST /auth/signup, POST /auth/login -> returns JWT
- GET /houses/{id}/ingredients
- POST /houses/{id}/ingredients
- PATCH /ingredients/{id} (toggle has_any or update quantity)
- GET /houses/{id}/meals
- POST /houses/{id}/meals
- POST /ingredients/{id}/prices
- GET /houses/{id}/shopping-list?view={cupboard|missing|shopping-list}&store_id={optional}
- POST /houses/{id}/receipts (multipart upload)
- WebSocket /ws/houses/{id} for realtime events

Realtime recommendation
- MVP: Run a single persistent backend (ECS Fargate or EC2) hosting FastAPI with WebSocket endpoints for simple broadcast to connected house clients.
- Rationale: simpler to implement and debug; easy local dev; lower initial cognitive overhead than API Gateway websockets + Lambda routing.

Price outlier detection algorithm
- For a selected set of items and a selected store:
  1. For each ingredient with prices across stores, compute median_price = median(all store prices for that ingredient).
  2. For the selected store compute deviation = (store_price - median_price) / median_price.
  3. Flag as outlier if abs(deviation) > threshold (default 0.25 = 25%).
  4. Highlight high outliers (store more expensive) and low outliers (store cheaper).
- Store aggregate score (on demand):
  - median_total = sum(median_price_i for each item i)
  - store_total = sum(store_price_i for each item i)
  - raw_score = 1 - clamp((store_total - median_total) / median_total, -1, 1)
  - adjustment: multiply by (1 - fraction_of_items_with_high_outliers * 0.5) to penalize many big outliers.

Receipt processing (MVP flow)
- User uploads receipt image -> stored to S3 and a receipts row created with parsed=false.
- Background worker (or sync in MVP) calls OCR (Textract or Tesseract) to extract lines. Produce candidate entries: description + price per line.
- UI presents candidates for confirmation and linking to ingredient records.

Local dev & run instructions
- Requirements (example): Python 3.11, pip, docker, node
- Quickstart example commands:
  ```bash
  python -m venv .venv
  source .venv/bin/activate
  pip install -r requirements.txt
  docker-compose up -d postgres
  uvicorn app.main:app --reload --port 8000
  cd web && npm install && npm run dev
  ```
- Provide docker-compose with services: postgres, backend, frontend (optional).

Infra & deployment notes (CDK)
- CDK stacks: VPC, RDS Postgres (encrypted), S3 bucket (encrypted), ECS cluster (Fargate) + task definition (FastAPI container), ALB, Route53/ACM for TLS.
- CI: GitHub Actions to build container, push to ECR, run CDK synth and CDK deploy on main branch.
- Provide a "Deploy to AWS" button in README if desired.

Security & operational notes
- Use HTTPS/TLS. RDS and S3 use at‑rest encryption. JWT tokens with reasonable expiry and refresh flow.
- Limit S3 upload size, virus scanning optional later.
- Regular backups for Postgres; retention policy via CDK.

Future extensions (brief)
- Offline‑first with local SQLite/IndexedDB sync.
- Automated store scraping or aggregator integrations.
- Event streaming (Kafka) for audit/history and analytics.
- Advanced substitution engine and recipe scaling.

Appendix: next concrete tasks I can implement for you
- Generate FastAPI starter skeleton + alembic migrations for the schema above.
- Generate CDK skeleton stacks (RDS, S3, ECS) with minimal permissions.
- Create a small React PWA skeleton for the mobile views.


