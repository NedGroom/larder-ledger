# LarderLedger — Web Frontend

React 18 SPA built with Vite. Talks directly to Supabase — no backend server.

## Commands

```bash
npm install       # install dependencies
npm run dev       # dev server at http://localhost:5173/larder-ledger/
npm run build     # production build → dist/
npm run preview   # preview the production build locally
```

## Environment

The Supabase URL and anon key are set in `web/.env`:

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

Copy `web/.env.example` to `web/.env` to get started. The anon key is safe to commit (it's public-facing and restricted by RLS).

## Deployment

Pushing to `main` triggers the GitHub Actions workflow (`.github/workflows/deploy-pages.yml`) which runs `npm run build` and deploys `dist/` to GitHub Pages.

Live URL: https://nedgroom.github.io/larder-ledger/

## Pages

| Tab | File | Description |
|-----|------|-------------|
| Pantry | `src/pages/Pantry.jsx` | Add ingredients, toggle in-stock |
| Meals | `src/pages/Meals.jsx` | Register meals + plan them on a date |
| Calendar | `src/pages/Calendar.jsx` | Monthly view of planned meals |
| Stores | `src/pages/Stores.jsx` | Add stores, record per-store prices |
| Shopping | `src/pages/Shopping.jsx` | Shopping list with meal tags |
| Receipts | `src/pages/Receipts.jsx` | AI receipt → price extraction |

## Key files

```
src/
  App.jsx           Auth, house init, tab routing
  lib/supabase.js   Supabase client singleton
  lib/ai.js         AI provider abstraction (OpenAI / Anthropic) for receipt parsing
  components/
    Layout.jsx      Header + nav tabs
    SignIn.jsx      Email/password sign-in form
```

