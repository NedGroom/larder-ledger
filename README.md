# LarderLedger

A household pantry, meal planning, and price comparison app built with React + Supabase.

**Live app:** https://nedgroom.github.io/larder-ledger/

## What it does

- **Pantry** — track which ingredients you have in stock (has_any toggle)
- **Meals** — register recipes with their ingredients; plan meals on a date
- **Calendar** — monthly view of planned meals
- **Stores** — record per-store prices for ingredients with package size and per-unit cost
- **Shopping list** — auto-generate from missing pantry items; tag items to a meal; check off as you shop
- **Receipts** — upload a receipt photo or paste text; AI extracts prices for you to confirm

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, deployed to GitHub Pages |
| Database + Auth | Supabase (Postgres + Auth) |
| RLS | Per-house row-level security via `users.auth_uid` |

## Repo structure

```
web/          React frontend (Vite)
supabase/
  schema.sql      Reference schema (do not run directly — use migrations)
  migrations/     Supabase CLI migration files
  policies.sql    RLS policies (apply via: supabase db query --linked -f supabase/policies.sql)
  functions.sql   Postgres RPC functions (auto-generate shopping list, meal fractions)
docs/             PRD, TDD, setup guides
.github/workflows/  GitHub Actions — deploys web/ to GitHub Pages on push to main
```

## Quick commands

**Run the frontend**
```bash
cd web && npm run dev        # http://localhost:5173/larder-ledger/
```

**Apply DB migrations**
```bash
echo "y" | supabase db push
```

**Apply RLS policies** (after any change to `supabase/policies.sql`)
```bash
supabase db query --linked -f supabase/policies.sql
```

**Apply RPC functions** (after any change to `supabase/functions.sql`)
```bash
supabase db query --linked -f supabase/functions.sql
```

**Ad-hoc DB query**
```bash
supabase db query --linked "SELECT * FROM houses;"
```

## Local development

```bash
cd web
npm install       # first time only
npm run dev       # http://localhost:5173/larder-ledger/
```

The app talks directly to the live Supabase project — no local backend needed.
Copy `web/.env.example` to `web/.env` if you need to override the Supabase URL/key.

## Deploying

Push to `main` — GitHub Actions builds `web/` and deploys to GitHub Pages automatically.

See `docs/supabase-setup.md` for full Supabase setup from scratch.
