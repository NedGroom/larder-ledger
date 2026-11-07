# The assistant: the larder as tools for Claude (larder-mcp)

Talk to the larder by voice (Siri, through Anki Life) or chat (Anki Life's `/chat`, or the Claude
apps as a custom connector): "what's in the fridge?", "I bought two tins of chickpeas at Tesco",
"how many veggie cards have I got left?", "what can I make tonight?", "I had a falafel wrap for
lunch", "how many calories today?", "undo that".

```
Siri / chat ──> Anki Life (conversation, voice style, Claude tool loop)
                    │  MCP over HTTPS, Bearer LARDER_MCP_TOKEN
                    ▼
        supabase/functions/larder-mcp  (Deno edge function)
                    │  signs in as the house's "Assistant" member: RLS applies
                    ▼
        web/src/lib/assistant.js ── larder.js · planner.js · nutrition.js · units.js
                    │  (the app's own modules: one rulebook for UI and assistant)
                    ▼
                Postgres (Supabase)
```

## The tools (`web/src/lib/assistant.js`)

| Tool | Does |
|---|---|
| `larder_stock` | Stock by search / category / in stock / missing / stale; null quantity = never counted |
| `find_ingredients` | Fuzzy name match before writing, so nothing is duplicated |
| `meal_plan` | Allocations by day and slot, who for; cooked food not yet placed |
| `deck` | The period's quota per ingredient: target, spent, pending, remaining, uncountable |
| `what_can_i_make` | Saved dishes by fraction in stock, what's missing, stale stock and quota cards they'd use |
| `nutrition_day` | A person's day: planned meals + food log vs targets, unknowns listed not zeroed |
| `shopping_list` | The list in progress |
| `record_purchase` | Same path as ticking off in the shop / a receipt: stock up, price logged, shop history |
| `set_stock` | Correct the shelf ("we've run out of milk") |
| `add_to_shopping_list` | Onto the list in progress (or a new one) |
| `log_food` | Food eaten that wasn't planned, per portion, plausibility-checked |
| `undo` | Reverses any write from its undo token |

Writes never guess between candidates: an ambiguous name comes back with the options.

## Data model additions (migration `20261106000001_assistant.sql`)
- `food_log`: extras eaten (description, per-portion kcal/macros, `source` label|estimated|manual).
  Planned meals already count through allocations, so they're never logged twice.
- `users.is_assistant`: the assistant is a real house member, attributable and bound by RLS.
- `house_people(house_id)`: members' names and daily targets for members only (RLS on `users`
  shows each user only their own row).

## Going live (Ned, once)

Prerequisite: the earlier migrations that were still waiting (see the brain handoff).

1. **Database** (repo root, on this branch or after merging it):
   ```bash
   echo "y" | supabase db push
   supabase db query --linked -f supabase/functions.sql
   supabase db query --linked -f supabase/policies.sql
   ```
2. **The assistant's user.** Supabase dashboard → Authentication → Users → *Add user* → email
   (e.g. `assistant+larder@<your domain>`), a long random password, *Auto confirm*. Copy its UUID, then:
   ```sql
   INSERT INTO users (auth_uid, email, name, is_assistant)
   VALUES ('<uuid>', '<email>', 'Assistant', true);
   INSERT INTO house_users (house_id, user_id)
   SELECT h.id, u.id FROM houses h, users u WHERE h.name = '<your house name>' AND u.auth_uid = '<uuid>';
   ```
3. **Secrets and deploy:**
   ```bash
   supabase secrets set LARDER_MCP_TOKEN=$(openssl rand -hex 24) \
     ASSISTANT_EMAIL='<email>' ASSISTANT_PASSWORD='<password>' ASSISTANT_DEFAULT_PERSON='Ned'
   node scripts/sync-mcp-lib.mjs
   supabase functions deploy larder-mcp --no-verify-jwt
   ```
   (`ASSISTANT_READ_ONLY=1` hides the write tools if you want to start read-only.)
4. **Anki Life:** set `ANKI_LIFE_LARDER_MCP_URL=https://<project-ref>.supabase.co/functions/v1/larder-mcp`
   in its `.env`, `python dev.py secrets set larder` (the same token), `python dev.py deploy`.
5. **Claude apps (optional):** Settings → Connectors → *Add custom connector*, URL
   `https://<project-ref>.supabase.co/functions/v1/larder-mcp?key=<token>`.

## Working on it
- Edit `web/src/lib/*.js`, then `node scripts/sync-mcp-lib.mjs` (the edge function deploys the copies in
  `supabase/functions/_shared/larder/`; `assistant.test.mjs` fails if they're stale).
- Tests: `node test/assistant.test.mjs` (tools against the fake, 34 checks) and
  `deno test --allow-env --allow-net --allow-read supabase/functions/larder-mcp/index.test.ts` (protocol).
  `sh scripts/run-browser-tests.sh` runs every suite in the Playwright Docker image.
- A demo server with a seeded house: `deno run --allow-env --allow-net --allow-read supabase/functions/larder-mcp/dev.ts`
  (Anki Life's `dev.py session start NAME --larder-dev --live` talks to it with live Claude).
