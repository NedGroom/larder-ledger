LarderLedger — FastAPI starter

What is included
- Minimal FastAPI app skeleton in `app/`
- SQLAlchemy models matching the TDD core schema
- DB helper `app/db.py` that defaults to sqlite for quick local testing
- Basic endpoints: create/list houses and create/list ingredients
- `docker-compose.yml` for a local Postgres service
- `requirements.txt` with the main dependencies
- Alembic config skeleton for migrations

Quickstart (local, sqlite)
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# create sqlite DB and start server
uvicorn app.main:app --reload --port 8000
# browse http://127.0.0.1:8000/docs
```

Quickstart (with local Postgres, docker)
```bash
# start postgres
docker-compose up -d
# set DATABASE_URL env var to: postgresql+psycopg2://larder:larder@localhost:5432/larder_dev
export DATABASE_URL="postgresql+psycopg2://larder:larder@localhost:5432/larder_dev"
uvicorn app.main:app --reload --port 8000
```

Alembic
- A minimal alembic.ini and env.py are provided; run `alembic revision --autogenerate -m "init"` to create migration scripts.

WebSocket test client
- A simple test client is available at `scripts/test_ws_client.py`. Run it after starting the server:

```bash
python scripts/test_ws_client.py --house 1
```

Quick API smoke tests
- Run the shell script `scripts/quick_test.sh` to exercise common flows (create house, ingredient, store, price, shopping list). Ensure `jq` is installed for pretty output.

```bash
chmod +x scripts/quick_test.sh
./scripts/quick_test.sh
```

Supabase migration & demo
- A Supabase SQL schema and example RLS policies are provided in `supabase/schema.sql` and `supabase/policies.sql`.
- A minimal static demo that uses Supabase JS to sign in, CRUD ingredients and upload receipts is at `web/supabase-demo.html`.
- Setup instructions are in `docs/supabase-setup.md`.

Next steps I can implement
- Alembic migrations and an initial migration file.
- Additional CRUD endpoints and WebSocket realtime scaffolding.
- React PWA skeleton.

