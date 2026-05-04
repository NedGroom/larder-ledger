Short checklist and quick commands to set up Supabase for larder_ledger

Quick checklist
- Create a project at https://app.supabase.com
- In Supabase → SQL editor run `supabase/schema.sql` (copy/paste or upload)
- Run `supabase/policies.sql` to enable RLS (adjust policies for production)
- Create a Storage bucket named `receipts` (public/private as you prefer)
- Test upload and access with a non-admin (authenticated) user

Minimal commands (local, using Supabase CLI)

1. Install Supabase CLI: https://supabase.com/docs/guides/cli

2. Login and link to project
```
supabase login
supabase link --project-ref <your-project-ref>
```

3. Apply schema via CLI (or use SQL Editor in dashboard):
```
supabase db remote set --url <db-connection-url>
psql <your-db-connection-url> -f supabase/schema.sql
```
Or open the dashboard SQL editor and paste the contents of `supabase/schema.sql` and run it.

4. Run policies (SQL editor or psql):
```
psql <your-db-connection-url> -f supabase/policies.sql
```

5. Create Storage bucket:
 - Dashboard → Storage → New bucket
 - Name: receipts
 - Set public/private according to your needs

6. Test with a non-admin user:
 - Create an account (or invite) in Supabase Auth
 - Sign in as that user in your frontend and attempt to insert a receipt row or upload to the `receipts` bucket

Notes and next steps
- The provided `policies.sql` is permissive to make initial testing simple. For production you must:
  - Map the auth user (auth.uid()) to your integer `users.id` in the DB (store auth UID in users table)
  - Restrict policies using checks on `uploaded_by` or `house_id` membership via `house_users`
  - Consider signed URLs or server-side function when uploading private files to Storage

