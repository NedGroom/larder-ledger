# Supabase Setup — LarderLedger

## Prerequisites

Install the Supabase CLI:
```bash
brew install supabase/tap/supabase   # macOS
```

## First-time setup from scratch

### 1. Create a Supabase project

Go to https://supabase.com, create a new project, and note your **project ref** (the ID in the URL).

### 2. Link the CLI to your project

```bash
supabase login
supabase link --project-ref <your-project-ref>
```

### 3. Apply migrations (schema changes)

```bash
echo "y" | supabase db push
```

Migrations live in `supabase/migrations/` and are applied in order. `schema.sql` is a reference only — do not run it directly on an existing DB.

### 4. Apply RLS policies

Policies use `auth.uid()` which requires a real user context — they must be applied via `db query`, not `db push`:

```bash
supabase db query --linked -f supabase/policies.sql
```

Re-run this any time you change `policies.sql`.

### 5. Apply RPC functions

```bash
supabase db query --linked -f supabase/functions.sql
```

### 6. Set the frontend env vars

Copy `web/.env.example` to `web/.env` and fill in your project URL and anon key (both visible in Supabase → Settings → API).

---

## Day-to-day database commands

```bash
# Check what migrations are pending
supabase db push --dry-run

# Apply pending migrations
echo "y" | supabase db push

# Re-apply policies after any change
supabase db query --linked -f supabase/policies.sql

# Re-apply functions after any change
supabase db query --linked -f supabase/functions.sql

# Run an ad-hoc query
supabase db query --linked "SELECT * FROM houses;"
```

## Adding a new migration

```bash
supabase migration new <descriptive-name>
# edit the generated file in supabase/migrations/
echo "y" | supabase db push
```

---

## Auth model

- Sign-in is handled by Supabase Auth (email + password)
- On first login, the app upserts a row into `public.users` keyed on `auth_uid` (the Supabase UUID)
- It then looks up or creates a `house_users` membership row linking the integer `users.id` to a `houses` row
- RLS policies use `is_house_member(house_id)` which joins `house_users → users` and checks `users.auth_uid = auth.uid()`

## RLS policy design

All tables are protected. The key helper function:

```sql
CREATE OR REPLACE FUNCTION is_house_member(p_house_id BIGINT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM house_users hu
    JOIN users u ON u.id = hu.user_id
    WHERE hu.house_id = p_house_id AND u.auth_uid = auth.uid()
  );
$$;
```

Tables with a direct `house_id` column use `is_house_member(house_id)` directly.
Join tables (`meal_ingredients`, `ingredient_prices`) look up the parent's `house_id` via a subquery.
