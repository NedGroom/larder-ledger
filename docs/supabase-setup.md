Supabase setup for LarderLedger (minimal, no always-on compute)

This guide walks through creating a Supabase project, applying the schema, enabling RLS, and running the web demo.

1) Create Supabase project
- Go to https://app.supabase.com and create a new project.
- Note the project URL and anon/public API key (Settings -> API -> Project API keys).

2) Create a Storage bucket
- In the Supabase dashboard, go to Storage -> Create a new bucket named `receipts` (public or private as you choose).

3) Apply schema
- Open SQL Editor in Supabase and paste the contents of `supabase/schema.sql` from this repo. Run it.
- This will create tables and triggers. Verify tables created.

4) Enable Row Level Security (RLS) and apply policies
- In SQL Editor run the contents of `supabase/policies.sql` (or copy/paste). This enables RLS and creates example policies.
- Important: test with a test user and ensure you can insert/select rows as expected.

5) Create storage policies (optional)
- If your receipts bucket is private, create a policy to allow authenticated users to upload to `receipts` where the path starts with `${house_id}/` or similar. Example:
  - In Storage Policies add a rule that allows uploads if request.auth.uid() is set.

6) Demo: host the static demo file
- You can host `web/supabase-demo.html` on Cloudflare Pages, Netlify, or S3 + CloudFront.
- Edit the top of the HTML to set `SUPABASE_URL` and `SUPABASE_KEY` to your project values (or paste them into the fields shown in the page at runtime).

7) Test flow
- Open the demo page, sign up with an email/password, create a house, create ingredients, toggle has_any and upload a receipt file. Changes are saved immediately to Supabase.
- Other users will see changes when they refresh or navigate (since we are not using realtime subscriptions in this demo).

8) Next steps / production
- Add RLS policies hardening as needed (restrict who can create houses, add roles).
- Consider using Supabase Edge Functions for any server-side processing (OCR orchestration or heavy aggregation) triggered by storage events.
- For a production static site, use Cloudflare Pages for free hosting and point to your custom domain.

Security notes
- Never embed service_role keys in client-side JS. Use anon/public keys for client access with RLS enabled.
- Test RLS thoroughly with multiple test users to ensure no cross-house leakage.

If you want, I can now:
- Wire a Supabase Edge Function stub for receipt parsing and show how to trigger it after uploads, or
- Add minimal GitHub Actions to deploy the static site to Cloudflare Pages automatically when `main` is updated.


