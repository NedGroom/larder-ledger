# LarderLedger — project instructions

A household pantry, meal-planning, and price-comparison web app.
**Live:** https://nedgroom.github.io/larder-ledger/

This file governs the *code*. Durable *planning* state (decisions, roadmap,
where things stand) lives in the **brain** repo — github.com/NedGroom/brain —
under `plans/larderledger/`. This project is tracked there; treat the brain as
shared memory across every device and Claude surface.

## On session start
1. Locate the brain clone (sibling of this repo on Ned's machines; Mac:
   `~/Documents/home/brain`). `git pull` it if reachable.
2. Read the brain's `STATUS.md`, `plans/larderledger/plan.md`, and the latest
   entries in `plans/larderledger/handoff.md` for current context.
3. Then read this repo's `README.md` for the technical picture.

## On session end (or when meaningful state has changed)
Follow the brain's `CLAUDE.md` protocol for planning state:
1. Update `plans/larderledger/plan.md` and the root `STATUS.md` if reality moved.
2. Append a dated entry to `plans/larderledger/handoff.md`, written for a future
   session with zero context.
3. Record any notable decision in the brain's `decisions/YYYY-MM-DD-slug.md`.
4. Commit + push **both** repos: code here, planning state in the brain.

Never let durable planning state live only in this repo's code or a chat
transcript — the brain is the canonical store.

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite, deployed to GitHub Pages |
| Backend | Supabase — Postgres, Auth, Edge Functions (Deno) |
| Multi-tenant | Per-house row-level security via `users.auth_uid` |
| Deploy | Push to `main` → GitHub Actions builds `web/` → GitHub Pages |

## Layout

```
web/                     React SPA (Vite). Talks directly to Supabase, no server.
  src/pages/             One file per tab: Pantry, Meals, Calendar, Stores,
                         Shopping, Receipts, Settings
  src/lib/               supabase client, ai.js (receipt parsing), logger, units
supabase/
  schema.sql             Reference schema (do NOT run — use migrations)
  migrations/            Supabase CLI migrations (source of truth for DB shape)
  policies.sql           RLS policies
  functions.sql          Postgres RPC functions
  functions/             Edge functions: receipt-ocr, copilot-proxy
docs/                    PRD.md, TDD.md, supabase-setup.md
scripts/                 fetch-logs.js, test-copilot.js
.github/workflows/       deploy.yml (Pages), log-drain.yml
```

## Common commands

```bash
cd web && npm install          # first time
cd web && npm run dev          # http://localhost:5173/larder-ledger/
cd web && npm run build        # production build → dist/

# Browser tests — drive the real UI against a fake Supabase. See web/test/README.md
cd web && npm i --no-save playwright && node test/larder-and-shop.test.mjs

echo "y" | supabase db push                                   # apply migrations
supabase db query --linked -f supabase/policies.sql           # apply RLS
supabase db query --linked -f supabase/functions.sql          # apply RPCs
supabase db query --linked "SELECT * FROM houses;"            # ad-hoc query
```

## Conventions & gotchas

- **DB changes go through `supabase/migrations/`**, never by editing
  `schema.sql` (which is a read-only reference) or the live DB by hand.
- **Apply migrations before merging to `main`.** Pushing to `main` deploys the
  frontend immediately, so a merge that lands ahead of its migration leaves the
  live app querying tables that don't exist yet.
- After changing `policies.sql` or `functions.sql`, re-apply them with the
  commands above — they are not part of the migration stream.
- The anon key in `web/.env` is public and safe to commit (RLS restricts it).
- **Docs drift:** `docs/PRD.md` and `docs/TDD.md` describe an earlier
  aspirational architecture (Python/FastAPI + AWS CDK/S3/Textract). The project
  actually shipped as React + Supabase. Trust `README.md` and the code for
  stack facts; the PRD/TDD are useful for feature intent (e.g. larder staleness
  scanning), not for the current implementation.
</content>
</invoke>
